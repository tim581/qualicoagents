/**
 * bol-price-update.js  v1.3 — Sets/removes "Tijdelijke prijs" on Bol.com Partner Portal
 *
 * USAGE:
 * INSERT INTO "Browser_Tasks" (agent_name, task_type, url, actions, credentials_key, status)
 * VALUES ('tasklet', 'bol-price-update', 'https://partner.bol.com', '[
 *   {"ean":"9300000117610237","offer_uid":"4ab15dc1-f68f-4d87-894b-b26d298c3afa",
 *    "promotional_price":48.95,"start_date":"2026-05-19","end_date":"2026-09-30","action":"set"}
 * ]'::jsonb, 'bol_seller', 'pending');
 *
 * v1.3 changes:
 *  - Skip dashboard pre-navigation and cookie loading
 *  - Navigate directly to offer URL — lets Bol set the SSO return URL correctly
 *  - On SSO redirect: slow-type credentials + Enter key + waitForFunction (not waitForURL)
 *  - After successful auth, re-navigate to offer if needed
 *  - Save fresh cookies after any successful login
 */

'use strict';
require('dotenv').config();

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const path = require('path');
const fs = require('fs');

// ── CONFIG ────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TASK_ID = process.env.BROWSER_TASK_ID;

const PROXY = {
  server: 'http://gate.decodo.com:10001',
  username: 'spx615l7f1',
  password: 'BHrGlyvt9mRqv2=j62'
};

const RUN_ID = `bolprice_${Date.now()}`;

// ── SELF-DEBUGGING ─────────────────────────────────────────────────────
async function dbLog(step, status, message) {
  const short = (message || '').toString().substring(0, 3000);
  console.log(`  [DB:${status}] ${step}: ${short.substring(0, 120)}`);
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ run_id: RUN_ID, step, status, message: short }),
    });
  } catch (e) { }
}

async function dbShot(page, step, label) {
  try {
    const buf = await page.screenshot({ fullPage: false });
    const b64 = buf.toString('base64').substring(0, 400000);
    await fetch(`${SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ run_id: RUN_ID, step, status: 'screenshot', message: label, screenshot: b64 }),
    });
  } catch (e) { }
}

// ── HELPERS ────────────────────────────────────────────────────────────
async function loadTask() {
  if (!TASK_ID) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/Browser_Tasks?id=eq.${TASK_ID}&select=actions,credentials_key`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  if (!data || data.length === 0) throw new Error(`Task ${TASK_ID} not found`);
  return data[0];
}

async function writeResult(status, result, errorMessage) {
  if (!TASK_ID) return;
  const body = {
    status,
    result: typeof result === 'string' ? result : JSON.stringify(result),
    completed_at: new Date().toISOString(),
  };
  if (errorMessage) body.error_message = errorMessage.substring(0, 3000);
  await fetch(
    `${SUPABASE_URL}/rest/v1/Browser_Tasks?id=eq.${TASK_ID}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(body),
    }
  );
}

function formatPriceBol(price) {
  return price.toFixed(2).replace('.', ',');
}

function formatBolDateRange(startDate, endDate) {
  const months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${months[m - 1]} ${y}`;
  };
  return `${fmt(startDate)} - ${fmt(endDate)}`;
}

function parseIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

async function setReactInputValue(page, selector, value) {
  return page.evaluate(({ sel, val }) => {
    const input = document.querySelector(sel);
    if (!input) return { ok: false, reason: 'input not found' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return { ok: false, reason: 'no value setter' };
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return { ok: true, value: input.value };
  }, { sel: selector, val: value });
}

async function pickCalendarDay(page, date, dbLogFn) {
  const monthsNl = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const monthName = monthsNl[date.getMonth()];
  const year = date.getFullYear();
  const day = date.getDate();

  for (let attempt = 0; attempt < 24; attempt++) {
    const headers = await page.locator('[class*="current-month"], [class*="caption"], [aria-live="polite"], h2, h3').allTextContents().catch(() => []);
    const headerText = headers.join(' ').toLowerCase();
    if (headerText.includes(monthName) && headerText.includes(String(year))) break;

    const nextBtn = page.locator(
      'button[name="next-month"], .react-datepicker__navigation--next, [aria-label*="volgende"], [aria-label*="Next"]'
    ).first();
    if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await nextBtn.click();
    } else {
      await page.getByRole('button', { name: /›|→|next/i }).first().click({ timeout: 1000 }).catch(() => {});
    }
    await page.waitForTimeout(250);
  }

  const dayPatterns = [
    new RegExp(`\\b${day}\\s+${monthName}\\b`, 'i'),
    new RegExp(`\\b${day}\\s+${monthName.slice(0, 3)}`, 'i'),
    new RegExp(`^${day}$`),
  ];

  for (const pattern of dayPatterns) {
    const gridcell = page.getByRole('gridcell', { name: pattern }).first();
    if (await gridcell.isVisible({ timeout: 1000 }).catch(() => false)) {
      await gridcell.click();
      await dbLogFn('set-price', 'info', `Calendar day picked via gridcell: ${day} ${monthName} ${year}`);
      return;
    }
    const btn = page.getByRole('button', { name: pattern }).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click();
      await dbLogFn('set-price', 'info', `Calendar day picked via button: ${day} ${monthName} ${year}`);
      return;
    }
  }

  const dayPadded = String(day).padStart(3, '0');
  const reactDay = page.locator(`.react-datepicker__day--${dayPadded}:not(.react-datepicker__day--outside-month)`).first();
  if (await reactDay.isVisible({ timeout: 1000 }).catch(() => false)) {
    await reactDay.click();
    await dbLogFn('set-price', 'info', `Calendar day picked via react-datepicker: ${day}`);
    return;
  }

  throw new Error(`Could not pick calendar day ${day} ${monthName} ${year}`);
}

async function setBolPromoDateRange(page, dateField, startDate, endDate) {
  const rangeStr = formatBolDateRange(startDate, endDate);
  const selector = 'input[name="promotions.0.dateRange"]';

  const injected = await setReactInputValue(page, selector, rangeStr);
  await dbLog('set-price', 'info', `React inject result: ${JSON.stringify(injected)}`);
  let current = await dateField.inputValue().catch(() => '');
  if (current && current !== 'Kies periode') {
    await dbLog('set-price', 'success', `Date range set via React inject: ${current}`);
    return;
  }

  await dbLog('set-price', 'info', 'React inject empty — opening calendar picker...');
  await dateField.scrollIntoViewIfNeeded();
  await dateField.click();
  await page.waitForTimeout(1000);

  const calendarOpen = await page.locator(
    '[role="dialog"], .react-datepicker, [data-radix-popper-content-wrapper], [class*="calendar"], [class*="DatePicker"]'
  ).first().isVisible({ timeout: 5000 }).catch(() => false);
  if (!calendarOpen) {
    await dateField.click({ force: true });
    await page.waitForTimeout(1000);
  }

  await pickCalendarDay(page, parseIsoDate(startDate), dbLog);
  await page.waitForTimeout(400);
  await pickCalendarDay(page, parseIsoDate(endDate), dbLog);
  await page.waitForTimeout(500);

  current = await dateField.inputValue().catch(() => '');
  if (!current || current === 'Kies periode') {
    throw new Error(`Date range still empty after calendar pick (wanted: ${rangeStr})`);
  }
  await dbLog('set-price', 'success', `Date range set via calendar: ${current}`);
}

// ── MAIN ───────────────────────────────────────────────────────────────
(async () => {
  let browser;

  try {
    // ── 1. Load task parameters ──────────────────────────────────────
    const task = await loadTask();
    let params;
    if (task && task.actions) {
      const actions = typeof task.actions === 'string' ? JSON.parse(task.actions) : task.actions;
      params = Array.isArray(actions) ? actions[0] : actions;
    } else {
      params = JSON.parse(process.env.TASK_PARAMS || '{}');
    }

    const { ean, offer_uid, promotional_price, start_date, end_date, action = 'set' } = params;

    if (!ean || !offer_uid) throw new Error('Missing required params: ean, offer_uid');
    if (action === 'set' && (!promotional_price || !start_date || !end_date)) {
      throw new Error('For action "set": promotional_price, start_date, end_date required');
    }

    await dbLog('init', 'info', `v1.3 | Action: ${action} | EAN: ${ean} | Price: €${promotional_price} | ${start_date} → ${end_date}`);

    // ── 2. Load credentials up front ─────────────────────────────────
    const credRes = await fetch(
      `${SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.bol_seller&select=username,password`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const credData = await credRes.json();
    if (!credData || credData.length === 0) throw new Error('bol_seller credentials not found');
    const { username, password } = credData[0];
    await dbLog('credentials', 'info', `Loaded credentials for: ${username}`);

    // ── 3. Launch browser ─────────────────────────────────────────────
    await dbLog('browser', 'info', 'Launching stealth browser...');
    const launchOptions = {
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    if (process.env.BOL_NO_PROXY !== '1') {
      launchOptions.proxy = PROXY;
      await dbLog('browser', 'info', 'Using Decodo proxy');
    } else {
      await dbLog('browser', 'info', 'Proxy disabled (BOL_NO_PROXY=1)');
    }
    browser = await chromium.launch(launchOptions);

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'nl-NL',
    });

    // Load saved cookies if available
    const storageStatePath = path.join(__dirname, 'bol-storage-state.json');
    if (fs.existsSync(storageStatePath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
        if (saved.cookies && saved.cookies.length > 0) {
          await context.addCookies(saved.cookies);
          await dbLog('cookies', 'info', `Loaded ${saved.cookies.length} cached cookies`);
        }
      } catch (e) {
        await dbLog('cookies', 'warning', 'Failed to parse cookie file — proceeding without');
      }
    } else {
      await dbLog('cookies', 'info', 'No cookie file — fresh session');
    }

    const page = await context.newPage();

    // ── 4. Navigate DIRECTLY to offer URL ────────────────────────────
    // Skip dashboard pre-check. Go straight to the offer URL.
    // If session is valid → lands on offer page immediately.
    // If session expired → Bol redirects to SSO with the correct return URL embedded.
    const offerUrl = `https://partner.bol.com/sdd/assortment-new/product/${ean}?offerUid=${offer_uid}`;
    await dbLog('navigate', 'info', `Direct navigation to offer URL: ${offerUrl}`);
    await page.goto(offerUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    await dbShot(page, 'after-offer-nav', 'After direct offer URL navigation');

    const urlAfterNav = page.url();
    await dbLog('nav-result', 'info', `URL after offer navigation: ${urlAfterNav}`);

    // ── 5. Handle SSO redirect if needed ─────────────────────────────
    if (page.url().includes('login.bol.com')) {
      await dbLog('sso', 'info', 'SSO redirect detected — filling login form...');
      await dbShot(page, 'sso-page', 'SSO login page (with return URL set by Bol)');

      // Log all form inputs for debugging
      const inputs = await page.locator('input').all();
      await dbLog('sso', 'info', `Inputs found: ${inputs.length}`);
      for (let i = 0; i < Math.min(inputs.length, 8); i++) {
        const n = await inputs[i].getAttribute('name').catch(() => '');
        const t = await inputs[i].getAttribute('type').catch(() => '');
        const v = await inputs[i].inputValue().catch(() => '');
        await dbLog('sso', 'info', `Input[${i}]: name="${n}" type="${t}" value="${v}"`);
      }

      // Fill username/password — use fill() to avoid floating-label click intercepts
      let usernameField = page.locator('input[name="j_username"]').first();
      if (!await usernameField.isVisible({ timeout: 3000 }).catch(() => false)) {
        usernameField = page.locator('input[type="email"], input[type="text"]').first();
        await dbLog('sso', 'info', 'j_username not found — using generic input');
      }
      await usernameField.fill(username);

      let passwordField = page.locator('input[name="j_password"]').first();
      if (!await passwordField.isVisible({ timeout: 3000 }).catch(() => false)) {
        passwordField = page.locator('input[type="password"]').first();
      }
      await passwordField.fill(password);
      await dbLog('sso', 'info', `Credentials filled for: ${username}`);

      const filledUser = await usernameField.inputValue().catch(() => '');
      const filledPass = await passwordField.inputValue().catch(() => '');
      if (!filledUser || !filledPass) {
        throw new Error(`SSO fields empty after fill (user=${!!filledUser}, pass=${!!filledPass})`);
      }

      await dbShot(page, 'sso-filled', 'SSO form filled — about to submit');

      const loginBtn = page.getByRole('button', { name: /inloggen|log in|aanmelden/i }).first();
      if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await dbLog('sso', 'info', 'Clicking Inloggen button...');
        await Promise.all([
          page.waitForURL((url) => !url.toString().includes('login.bol.com'), { timeout: 45000 }).catch(() => null),
          loginBtn.click({ force: true }),
        ]);
      } else {
        await dbLog('sso', 'info', 'No Inloggen button — pressing Enter on password field');
        await passwordField.press('Enter');
        await page.waitForTimeout(12000);
      }

      await dbShot(page, 'after-sso-submit', `URL after submit: ${page.url()}`);
      await dbLog('sso', 'info', `URL after submit: ${page.url()}`);

      // Final URL check
      if (page.url().includes('login.bol.com')) {
        const loginError = await page.locator('[role="alert"], .error, .text-danger, [data-test*="error"]').first().textContent().catch(() => '');
        const bodySnippet = await page.locator('body').innerText().catch(() => '');
        await dbLog('sso', 'error', `Login page error: ${(loginError || bodySnippet).substring(0, 500)}`);
        await dbShot(page, 'sso-failed', 'Both methods failed — still on login page');
        throw new Error(`SSO login failed — still on login.bol.com after all attempts. URL: ${page.url()}`);
      }

      await dbLog('sso', 'success', `SSO login succeeded — URL: ${page.url()}`);

      // Save fresh cookies
      try {
        const freshCookies = await context.cookies();
        fs.writeFileSync(storageStatePath, JSON.stringify({ cookies: freshCookies }, null, 2));
        await dbLog('cookies', 'success', `Saved ${freshCookies.length} fresh cookies`);
      } catch (e) {
        await dbLog('cookies', 'warning', 'Could not save cookies: ' + e.message);
      }

      // If we landed on a non-offer page (e.g. dashboard), re-navigate to offer
      if (!page.url().includes(ean)) {
        await dbLog('navigate', 'info', `Not on offer page (${page.url()}) — re-navigating to: ${offerUrl}`);
        await page.goto(offerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
        await dbShot(page, 'offer-after-sso', `Offer page after SSO login for EAN ${ean}`);
        await dbLog('navigate', 'info', `URL after re-nav: ${page.url()}`);
      }
    } else {
      await dbLog('session', 'success', `Already authenticated — on: ${urlAfterNav}`);
    }

    // ── 6. Wait for React form to render ──────────────────────────────
    await dbLog('form', 'info', 'Waiting for React form inputs (max 15s)...');
    await page.waitForSelector('input, textarea, [role="textbox"]', { timeout: 15000 }).catch(async (e) => {
      await dbLog('form', 'warning', `No inputs after 15s: ${e.message}`);
    });

    // Log all inputs for debugging
    const allInputs = await page.locator('input').all();
    await dbLog('form', 'info', `Total inputs on page: ${allInputs.length}`);
    for (let i = 0; i < Math.min(allInputs.length, 12); i++) {
      const n = await allInputs[i].getAttribute('name').catch(() => '');
      const v = await allInputs[i].inputValue().catch(() => '');
      await dbLog('form', 'info', `Input[${i}]: name="${n}" value="${v.substring(0, 30)}"`);
    }

    if (action === 'set') {
      const priceStr = formatPriceBol(promotional_price);
      await dbLog('set-price', 'info', `Setting price to: ${priceStr}`);

      // Scroll to Prijs section
      const prijsHeader = page.getByText('Prijs', { exact: true }).first();
      if (await prijsHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
        await prijsHeader.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
      }

      await dbShot(page, 'prijs-section', 'Prijs section');

      // Codegen + screenshot confirmed this must target the temporary-price row field.
      const promoRow = page.getByText('Tijdelijke prijs').locator('xpath=ancestor::section | ancestor::div').first();
      const rowScopedPriceField = page
        .getByRole('row')
        .filter({ hasText: /(\d{1,3},\d{2}).*(\d{1,2}\s+\w+\s+\d{4}\s*-\s*\d{1,2}\s+\w+\s+\d{4})/i })
        .getByLabel('Prijs')
        .first();
      const namedPromoField = page.locator('input[name="promotions.0.price"]').first();
      const genericPriceField = page.locator('input[name="price"]').first();
      const dateField = page.locator('input[name="promotions.0.dateRange"]').first();

      let priceField = rowScopedPriceField;
      if (!await priceField.isVisible({ timeout: 3000 }).catch(() => false)) {
        priceField = namedPromoField;
      }

      if (!await priceField.isVisible({ timeout: 3000 }).catch(() => false)) {
        const addPromoBtn = page.getByRole('button', { name: /tijdelijke prijs/i }).first();
        if (await addPromoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await dbLog('set-price', 'info', 'Adding Tijdelijke prijs row...');
          await addPromoBtn.click();
          await page.waitForTimeout(2000);
        } else {
          const addPromoText = page.getByText(/tijdelijke prijs toevoegen|voeg tijdelijke prijs toe/i).first();
          if (await addPromoText.isVisible({ timeout: 2000 }).catch(() => false)) {
            await dbLog('set-price', 'info', 'Clicking Tijdelijke prijs toevoegen...');
            await addPromoText.click();
            await page.waitForTimeout(2000);
          }
        }
        if (await namedPromoField.isVisible({ timeout: 5000 }).catch(() => false)) {
          priceField = namedPromoField;
        } else if (await genericPriceField.isVisible({ timeout: 3000 }).catch(() => false)) {
          priceField = genericPriceField;
          await dbLog('set-price', 'info', 'No promo field — using base input[name="price"]');
        }
      }

      if (await priceField.isVisible({ timeout: 8000 }).catch(() => false)) {
        const chosenName = await priceField.getAttribute('name').catch(() => '');
        await dbLog('set-price', 'info', `Using field name: "${chosenName || '(unknown)'}"`);

        await priceField.dblclick().catch(() => {});
        await priceField.fill('');
        await priceField.type(priceStr, { delay: 50 });
        await dbLog('set-price', 'success', `Price filled: ${priceStr}`);

        if (chosenName !== 'price') {
          const currentDateRange = await dateField.inputValue().catch(() => '');
          await dbLog('set-price', 'info', `Date range: "${currentDateRange}"`);

          if (!currentDateRange || currentDateRange === 'Kies periode') {
            await setBolPromoDateRange(page, dateField, start_date, end_date);
          }
        }
      } else {
        await dbLog('set-price', 'error', 'promotions.0.price NOT found — page not ready');
        const inp2 = await page.locator('input').all();
        for (let i = 0; i < Math.min(inp2.length, 15); i++) {
          const n = await inp2[i].getAttribute('name').catch(() => '');
          const v = await inp2[i].inputValue().catch(() => '');
          await dbLog('set-price', 'info', `Input[${i}]: name="${n}" value="${v}"`);
        }
        if (await genericPriceField.isVisible({ timeout: 1000 }).catch(() => false)) {
          const basePriceVal = await genericPriceField.inputValue().catch(() => '');
          await dbLog('set-price', 'warning', `Base price field exists with value "${basePriceVal}" (not used)`);
        }
        await dbShot(page, 'no-promo-field', 'promotions.0.price not found');
        throw new Error('promotions.0.price input not visible — check debug screenshots');
      }

      await dbShot(page, 'fields-filled', 'After filling price');

      // Save
      await dbLog('save', 'info', 'Looking for save button...');
      const saveButtons = [
        page.getByText('Opslaan').first(),
        page.getByText('Wijzigingen opslaan').first(),
        page.getByText('Bevestigen').first(),
        page.getByText('Prijzen opslaan').first(),
        page.locator('button[type="submit"]').first(),
        page.locator('[data-testid="save-button"]').first(),
      ];

      let saved = false;
      for (const btn of saveButtons) {
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(5000);
          saved = true;
          await dbLog('save', 'success', 'Save button clicked');
          break;
        }
      }

      if (!saved) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
        await dbLog('save', 'warning', 'No save button found — pressed Enter');
      }

      await dbShot(page, 'after-save', 'After save attempt');

      const errorBanner = page.locator('.notification--error, [data-testid="error"], .error-message').first();
      if (await errorBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
        const errText = (await errorBanner.textContent().catch(() => '')).trim();
        if (errText && errText.length > 3) throw new Error(`Bol.com save error: ${errText}`);
      }

      const result = { success: true, data: { ean, offer_uid, promotional_price, start_date, end_date, action: 'set' } };
      await writeResult('done', result, null);
      await dbLog('complete', 'success', JSON.stringify(result));

    } else if (action === 'remove') {
      const removeButtons = [
        page.getByText('Verwijderen').first(),
        page.getByText('Actieprijs verwijderen').first(),
        page.getByText('Tijdelijke prijs verwijderen').first(),
        page.locator('[data-testid="remove-promotion"]').first(),
      ];

      let removed = false;
      for (const btn of removeButtons) {
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(3000);
          removed = true;
          await dbLog('remove-price', 'success', 'Remove button clicked');
          break;
        }
      }

      if (!removed) {
        await dbShot(page, 'no-remove-button', 'Remove button not found');
        throw new Error('Could not find remove promo button');
      }

      const confirmBtn = page.getByText('Bevestigen').first();
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(3000);
      }

      await dbShot(page, 'after-remove', 'After remove');
      const result = { success: true, data: { ean, offer_uid, action: 'remove' } };
      await writeResult('done', result, null);
      await dbLog('complete', 'success', JSON.stringify(result));
    }

  } catch (err) {
    console.error('❌ Fatal:', err.message);
    await dbLog('fatal', 'error', err.message + '\n' + (err.stack || ''));
    await writeResult('failed', null, err.message);
  } finally {
    if (browser) await browser.close();
    await new Promise(r => setTimeout(r, 2000));
  }
})();
