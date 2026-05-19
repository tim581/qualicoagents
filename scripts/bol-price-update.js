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

    // ── 5. Navigate to offer pricing page ────────────────────────────
    const offerUrl = `https://partner.bol.com/sdd/offers/${offer_uid}/price`;
    await dbLog('navigate', 'info', `Going to offer pricing: ${offerUrl}`);
    await page.goto(offerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await dbShot(page, 'offer-page', `Offer pricing page for ${offer_uid}`);

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

      // Look for "Prijs aanpassen" or "Wijzig" button
      await dbLog('set-price', 'info', 'Looking for price edit button...');

      const editButtons = [
        page.getByText('Prijs aanpassen').first(),
        page.getByText('Wijzig').first(),
        page.getByText('Pas prijs aan').first(),
        page.getByText('Bewerk').first(),
        page.locator('[data-testid="edit-price-button"]').first(),
      ];

      let clicked = false;
      for (const btn of editButtons) {
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await dbLog('set-price', 'info', `Found button, clicking...`);
          await btn.click();
          await page.waitForTimeout(3000);
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        await dbShot(page, 'no-edit-button', 'Could not find edit button');
        await dbLog('set-price', 'warning', 'No edit button found — page may already be in edit mode');
      }

      await dbShot(page, 'after-edit-click', 'After clicking edit');

      // Look for promotional price / tijdelijke prijs section
      const promoToggle = [
        page.getByText('Tijdelijke prijs').first(),
        page.getByText('Tijdelijke actieprijs').first(),
        page.getByText('Promotional price').first(),
        page.locator('label:has-text("Tijdelijke")').first(),
      ];

      for (const toggle of promoToggle) {
        if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) {
          await dbLog('set-price', 'info', 'Found promotional price section');
          await toggle.click();
          await page.waitForTimeout(2000);
          break;
        }
      }

      await dbShot(page, 'promo-section', 'Promotional price section');

      // Fill in the promotional price
      const priceStr = formatPriceBol(promotional_price);
      const startStr = formatDateBol(start_date);
      const endStr = formatDateBol(end_date);

      await dbLog('set-price', 'info', `Filling: price=${priceStr}, start=${startStr}, end=${endStr}`);

      // Find price input fields — try various selectors
      const priceInputs = await page.locator('input[type="text"], input[type="number"], input[inputmode="decimal"]').all();
      await dbLog('set-price', 'info', `Found ${priceInputs.length} input fields on page`);

      // Log each input's placeholder/label for debugging
      for (let i = 0; i < priceInputs.length; i++) {
        const ph = await priceInputs[i].getAttribute('placeholder').catch(() => '');
        const name = await priceInputs[i].getAttribute('name').catch(() => '');
        const ariaLabel = await priceInputs[i].getAttribute('aria-label').catch(() => '');
        await dbLog('set-price', 'info', `Input ${i}: placeholder="${ph}" name="${name}" aria="${ariaLabel}"`);
      }

      // Try to find specific fields by label/placeholder
      const priceField = page.locator('input[name*="price"], input[placeholder*="prijs"], input[aria-label*="prijs"], input[aria-label*="price"]').first();
      if (await priceField.isVisible({ timeout: 2000 }).catch(() => false)) {
        await priceField.click({ clickCount: 3 }); // select all
        await priceField.type(priceStr, { delay: 50 });
        await dbLog('set-price', 'success', `Price filled: ${priceStr}`);
      } else {
        await dbLog('set-price', 'warning', 'Could not find price field by name/placeholder — logging all inputs for manual review');
      }

      // Date fields
      const dateInputs = await page.locator('input[type="date"], input[placeholder*="dd"], input[aria-label*="datum"], input[aria-label*="date"]').all();
      await dbLog('set-price', 'info', `Found ${dateInputs.length} date-like inputs`);

      for (let i = 0; i < dateInputs.length; i++) {
        const ph = await dateInputs[i].getAttribute('placeholder').catch(() => '');
        const ariaLabel = await dateInputs[i].getAttribute('aria-label').catch(() => '');
        await dbLog('set-price', 'info', `Date input ${i}: placeholder="${ph}" aria="${ariaLabel}"`);
      }

      if (dateInputs.length >= 2) {
        // First date = start, second = end
        await dateInputs[0].click({ clickCount: 3 });
        await dateInputs[0].type(startStr, { delay: 50 });
        await dateInputs[1].click({ clickCount: 3 });
        await dateInputs[1].type(endStr, { delay: 50 });
        await dbLog('set-price', 'success', `Dates filled: ${startStr} → ${endStr}`);
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
