/**
 * bol-price-update.js  v1.0 — Sets/removes "Tijdelijke prijs" on Bol.com Partner Portal
 *
 * USAGE:
 * INSERT INTO "Browser_Tasks" (agent_name, task_type, url, actions, credentials_key, status)
 * VALUES ('tasklet', 'bol-price-update', 'https://partner.bol.com', '[
 *   {"ean":"9300000117610237","offer_uid":"4ab15dc1-f68f-4d87-894b-b26d298c3afa",
 *    "promotional_price":48.95,"start_date":"2026-05-19","end_date":"2026-09-30","action":"set"}
 * ]'::jsonb, 'bol_seller', 'pending');
 *
 * actions[0] fields:
 *   ean              - Bol product ID
 *   offer_uid        - Offer UUID from Bol
 *   promotional_price - Price in EUR (for action "set")
 *   start_date       - YYYY-MM-DD (for action "set")
 *   end_date         - YYYY-MM-DD (for action "set")
 *   action           - "set" or "remove"
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

// ── SELF-DEBUGGING: LOG NAAR SUPABASE ─────────────────────────────────
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
  } catch (e) { /* nooit de main flow breken */ }
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
  } catch (e) { /* nooit de main flow breken */ }
}

// ── HELPERS ────────────────────────────────────────────────────────────

/** Load task from Supabase */
async function loadTask() {
  if (!TASK_ID) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/Browser_Tasks?id=eq.${TASK_ID}&select=actions,credentials_key`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  const data = await res.json();
  if (!data || data.length === 0) throw new Error(`Task ${TASK_ID} not found`);
  return data[0];
}

/** Write result back to Browser_Tasks */
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

/** Format date from YYYY-MM-DD to DD-MM-YYYY (Bol.com format) */
function formatDateBol(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}

/** Format price to Dutch locale (48.95 → "48,95") */
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

    if (!ean || !offer_uid) {
      throw new Error('Missing required params: ean, offer_uid');
    }
    if (action === 'set' && (!promotional_price || !start_date || !end_date)) {
      throw new Error('For action "set": promotional_price, start_date, end_date required');
    }

    await dbLog('init', 'info', `Action: ${action} | EAN: ${ean} | Price: €${promotional_price} | ${start_date} → ${end_date}`);

    // ── 2. Launch stealth browser ─────────────────────────────────────
    await dbLog('browser', 'info', 'Launching stealth browser with proxy...');

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

    // Load saved cookies if available (cached session)
    const storageStatePath = path.join(__dirname, 'bol-storage-state.json');
    if (fs.existsSync(storageStatePath)) {
      try {
        const storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
        if (storageState.cookies && storageState.cookies.length > 0) {
          await context.addCookies(storageState.cookies);
          await dbLog('cookies', 'info', `Loaded ${storageState.cookies.length} cookies from cache`);
        }
      } catch (e) {
        await dbLog('cookies', 'warning', 'Failed to parse bol-storage-state.json — proceeding without');
      }
    } else {
      await dbLog('cookies', 'info', 'No bol-storage-state.json found — will do form login');
    }

    const page = await context.newPage();

    // ── 3. Navigate to partner portal dashboard ───────────────────────
    await dbLog('navigate', 'info', 'Going to: https://partner.bol.com/sdd/dashboard');
    await page.goto('https://partner.bol.com/sdd/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await dbShot(page, 'after-navigate', 'After dashboard navigation');

    // ── 4. Form login fallback if cookies expired/missing ─────────────
    const currentUrl = page.url();
    await dbLog('login-check', 'info', `Current URL: ${currentUrl}`);

    if (!currentUrl.startsWith('https://partner.bol.com/sdd')) {
      await dbLog('login', 'info', 'Not on partner portal — starting form login...');

      // Load credentials from Supabase Browser_Credentials
      const credRes = await fetch(
        `${SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.bol_seller&select=username,password`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const credData = await credRes.json();
      if (!credData || credData.length === 0) throw new Error('bol_seller credentials not found in Browser_Credentials');
      const { username, password } = credData[0];
      await dbLog('login', 'info', `Credentials loaded for: ${username}`);

      // Navigate to login page
      await page.goto('https://partner.bol.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      await dbShot(page, 'login-page', 'Login page');

      // Fill email
      await page.waitForSelector('input[type="email"], input[name="username"], input[name="email"]', { timeout: 15000 });
      await page.fill('input[type="email"], input[name="username"], input[name="email"]', username);
      await dbLog('login', 'info', 'Email filled');

      // Click Next / Volgende if present (two-step login)
      try {
        const nextBtn = page.locator('button:has-text("Volgende"), button:has-text("Next"), button[type="submit"]').first();
        await nextBtn.click({ timeout: 5000 });
        await page.waitForTimeout(2000);
        await dbShot(page, 'login-after-email', 'After email step');
      } catch (e) {
        await dbLog('login', 'info', 'No next button — single-step form');
      }

      // Fill password
      await page.waitForSelector('input[type="password"]', { timeout: 15000 });
      await page.fill('input[type="password"]', password);
      await dbLog('login', 'info', 'Password filled');

      // Submit
      await page.click('button[type="submit"], button:has-text("Inloggen"), button:has-text("Log in")');
      await dbLog('login', 'info', 'Submitted login form');

      // Wait for partner portal
      try {
        await page.waitForURL('**/partner.bol.com/sdd/**', { timeout: 30000 });
        await dbLog('login', 'success', `Logged in — URL: ${page.url()}`);
      } catch (e) {
        await dbShot(page, 'login-failed', 'Login failed or redirected');
        throw new Error(`Form login failed — final URL: ${page.url()}`);
      }

      // Save cookies for next run
      try {
        const cookies = await context.cookies();
        fs.writeFileSync(storageStatePath, JSON.stringify({ cookies }, null, 2));
        await dbLog('cookies', 'success', `Saved ${cookies.length} cookies to bol-storage-state.json`);
      } catch (e) {
        await dbLog('cookies', 'warning', 'Could not save cookies: ' + e.message);
      }
    } else {
      await dbLog('login', 'success', 'Already logged in via cached cookies ✅');
    }

    await dbLog('page-loaded', 'success', `Logged in — URL: ${page.url()}`);

    // ── 5. Navigate to product/offer page ──────────────────────────
    const offerUrl = `https://partner.bol.com/sdd/assortment-new/product/${ean}?offerUid=${offer_uid}`;
    await dbLog('navigate', 'info', `Going to product offer page: ${offerUrl}`);
    await page.goto(offerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await dbShot(page, 'offer-page', `Product offer page for ${ean}`);

    // Log page state for debugging
    const offerPageUrl = page.url();
    const offerTitle = await page.title();
    const offerBody = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '');
    await dbLog('offer-page-debug', 'info', `URL: ${offerPageUrl} | Title: ${offerTitle} | Body: ${offerBody.substring(0, 500)}`);

    // Wait for React to render form inputs (up to 15s)
    await dbLog('debug', 'info', 'Waiting for input elements (max 15s)...');
    await page.waitForSelector('input, textarea, [role="textbox"], [contenteditable]', { timeout: 15000 }).catch(async (e) => {
      await dbLog('debug', 'warning', `No inputs appeared after 15s: ${e.message}`);
    });

    if (action === 'set') {
      // ── 4a. SET promotional price ──────────────────────────────────
      // The product page shows "Prijs" section with:
      //   Tijdelijke prijs | Huidig: € XX,XX | Nieuw: [input €]
      // The "Nieuw" input is directly visible — no edit button needed.

      const priceStr = formatPriceBol(promotional_price);
      await dbLog('set-price', 'info', `Setting price to: ${priceStr}`);

      // Scroll to Prijs section
      const prijsHeader = page.getByText('Prijs', { exact: true }).first();
      if (await prijsHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
        await prijsHeader.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
      }

      await dbShot(page, 'prijs-section', 'Prijs section visible');

      // Find the "Nieuw" input field next to "Tijdelijke prijs"
      // It's an input with "€" prefix in the Nieuw column
      const allInputs = await page.locator('input').all();
      await dbLog('set-price', 'info', `Found ${allInputs.length} total inputs on page`);

      // Log each input for debugging
      for (let i = 0; i < Math.min(allInputs.length, 15); i++) {
        const ph = await allInputs[i].getAttribute('placeholder').catch(() => '');
        const name = await allInputs[i].getAttribute('name').catch(() => '');
        const type = await allInputs[i].getAttribute('type').catch(() => '');
        const val = await allInputs[i].inputValue().catch(() => '');
        const ariaLabel = await allInputs[i].getAttribute('aria-label').catch(() => '');
        await dbLog('set-price', 'info', `Input ${i}: type="${type}" name="${name}" placeholder="${ph}" value="${val}" aria="${ariaLabel}"`);
      }

      // Strategy: find the input in the "Nieuw" column of the Prijs table
      // The input is near "Tijdelijke prijs" row, in the "Nieuw" column
      // Try multiple selectors
      let priceField = null;
      
      // Try 1: input near € symbol in Nieuw column
      const euroInputs = await page.locator('input').all();
      for (const input of euroInputs) {
        const isVisible = await input.isVisible().catch(() => false);
        if (!isVisible) continue;
        // Check if this input is in the pricing section (near "Tijdelijke prijs" text)
        const parent = await input.evaluate(el => {
          // Walk up to find if we're in a price row
          let node = el;
          for (let i = 0; i < 10; i++) {
            if (!node.parentElement) break;
            node = node.parentElement;
            if (node.textContent && node.textContent.includes('Tijdelijke prijs')) return 'prijs-row';
          }
          return '';
        });
        if (parent === 'prijs-row') {
          priceField = input;
          await dbLog('set-price', 'success', 'Found price input in Tijdelijke prijs row');
          break;
        }
      }

      if (priceField) {
        await priceField.click({ clickCount: 3 });
        await priceField.fill('');
        await priceField.type(priceStr, { delay: 50 });
        await dbLog('set-price', 'success', `Price filled: ${priceStr}`);
      } else {
        await dbLog('set-price', 'error', 'Could not find price input in Tijdelijke prijs row');
        await dbShot(page, 'no-price-input', 'Could not locate price input');
      }

      await dbShot(page, 'fields-filled', 'After filling all fields');

      // Click save
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
          await dbLog('save', 'success', 'Clicked save button');
          break;
        }
      }

      if (!saved) {
        // Fallback: press Enter
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
        await dbLog('save', 'warning', 'No save button found — pressed Enter');
      }

      await dbShot(page, 'after-save', 'After save attempt');

      // Check for error banners
      const errorBanner = page.locator('.error, [role="alert"], .notification--error, [data-testid="error"]').first();
      if (await errorBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
        const errText = await errorBanner.textContent().catch(() => 'Unknown error');
        throw new Error(`Bol.com error after save: ${errText}`);
      }

      const result = {
        success: true,
        data: { ean, offer_uid, promotional_price, start_date, end_date, action: 'set' }
      };

      await writeResult('done', result, null);
      await dbLog('complete', 'success', JSON.stringify(result));

    } else if (action === 'remove') {
      // ── 4b. REMOVE promotional price ───────────────────────────────
      await dbLog('remove-price', 'info', 'Looking for remove/delete promo button...');

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
          await dbLog('remove-price', 'success', 'Clicked remove button');
          break;
        }
      }

      if (!removed) {
        await dbShot(page, 'no-remove-button', 'Could not find remove button');
        throw new Error('Could not find remove promo button');
      }

      // Confirm removal if dialog appears
      const confirmBtn = page.getByText('Bevestigen').first();
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(3000);
      }

      await dbShot(page, 'after-remove', 'After removing promo');

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
    await new Promise(r => setTimeout(r, 2000)); // logs flushen
  }
})();
