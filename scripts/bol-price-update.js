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
    browser = await chromium.launch({
      headless: false,
      proxy: PROXY,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

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

      // Fill username field — try j_username first, fall back to email/text
      let usernameField = page.locator('input[name="j_username"]').first();
      if (!await usernameField.isVisible({ timeout: 3000 }).catch(() => false)) {
        usernameField = page.locator('input[type="email"], input[type="text"]').first();
        await dbLog('sso', 'info', 'j_username not found — using generic input');
      }
      await usernameField.click();
      await page.waitForTimeout(300);
      await usernameField.selectText().catch(() => {});
      await page.keyboard.type(username, { delay: 80 });
      await dbLog('sso', 'info', `Username typed: ${username}`);

      // Fill password
      let passwordField = page.locator('input[name="j_password"]').first();
      if (!await passwordField.isVisible({ timeout: 3000 }).catch(() => false)) {
        passwordField = page.locator('input[type="password"]').first();
      }
      await passwordField.click();
      await page.waitForTimeout(300);
      await passwordField.selectText().catch(() => {});
      await page.keyboard.type(password, { delay: 80 });
      await dbLog('sso', 'info', 'Password typed');

      await dbShot(page, 'sso-filled', 'SSO form filled — about to submit');

      // Submit via Enter key (most reliable — avoids button selector issues)
      await page.keyboard.press('Enter');
      await dbLog('sso', 'info', 'Enter pressed — waiting for redirect away from login.bol.com...');

      // Wait for navigation AWAY from login.bol.com (catches any redirect target)
      try {
        await page.waitForFunction(
          () => !window.location.href.includes('login.bol.com'),
          { timeout: 30000, polling: 500 }
        );
        await dbLog('sso', 'success', `SSO redirect succeeded — URL: ${page.url()}`);
        await dbShot(page, 'after-sso-redirect', 'After SSO redirect');
      } catch (e) {
        await dbShot(page, 'sso-stuck', 'SSO redirect did not happen');
        // Last resort: try clicking the submit button too
        await dbLog('sso', 'warning', `waitForFunction timeout — trying button click fallback...`);
        try {
          const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Inloggen")').first();
          if (await submitBtn.isVisible({ timeout: 3000 })) {
            await submitBtn.click();
            await dbLog('sso', 'info', 'Submit button clicked');
            await page.waitForFunction(
              () => !window.location.href.includes('login.bol.com'),
              { timeout: 20000, polling: 500 }
            );
            await dbLog('sso', 'success', `Button click worked — URL: ${page.url()}`);
          }
        } catch (e2) {
          await dbShot(page, 'sso-both-failed', 'Both Enter + button click failed');
          throw new Error(`SSO login failed after Enter + button — URL: ${page.url()} | Error: ${e2.message}`);
        }
      }

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

      const priceField = page.locator('input[name="promotions.0.price"]');
      const dateField = page.locator('input[name="promotions.0.dateRange"]');

      if (await priceField.isVisible({ timeout: 8000 }).catch(() => false)) {
        await priceField.click({ clickCount: 3 });
        await priceField.fill('');
        await priceField.type(priceStr, { delay: 50 });
        await dbLog('set-price', 'success', `Price filled: ${priceStr}`);

        const currentDateRange = await dateField.inputValue().catch(() => '');
        await dbLog('set-price', 'info', `Date range: "${currentDateRange}"`);

        if (!currentDateRange || currentDateRange === 'Kies periode') {
          await dbLog('set-price', 'warning', 'Date range empty — needs manual date setting');
        }
      } else {
        await dbLog('set-price', 'error', 'promotions.0.price NOT found — page not ready');
        const inp2 = await page.locator('input').all();
        for (let i = 0; i < Math.min(inp2.length, 15); i++) {
          const n = await inp2[i].getAttribute('name').catch(() => '');
          const v = await inp2[i].inputValue().catch(() => '');
          await dbLog('set-price', 'info', `Input[${i}]: name="${n}" value="${v}"`);
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
