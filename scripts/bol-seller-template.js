/**
 * bol-seller-template.js
 * ======================
 * Template for agents that need access to bol.com Partner Portal.
 * 
 * USAGE:
 * 1. Copy this file, rename to your task (e.g. bol-price-update.js)
 * 2. Replace the "YOUR LOGIC HERE" section with your own code
 * 3. Push to GitHub: tim581/qualicoagents/scripts/
 * 4. Insert a Browser_Task in Supabase with your task_type
 * 
 * IMPORTANT: This is a STANDALONE script (no module.exports)
 * The Playwright executor spawns this as a child process.
 * 
 * Version: 1.0.0
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

chromium.use(StealthPlugin());

// ─── Config ───────────────────────────────────────────────────────────────────
const PROXY = {
  server: 'http://nl.decodo.com:10001',
  username: 'spx615l7f1',
  password: 'BHrGlyvt9mRqv2=j62'
};

const SUPABASE_URL = 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // Set in executor env
const TASK_ID = process.env.BROWSER_TASK_ID;           // Injected by executor

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  let browser;
  const result = { success: false, data: null, error: null };

  try {
    // Load cookies (created via Cookie-Editor export + convert-cookies.js)
    const storageStatePath = path.join(__dirname, 'bol-storage-state.json');
    if (!fs.existsSync(storageStatePath)) {
      throw new Error('bol-storage-state.json not found. Run convert-cookies.js first.');
    }
    const storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));

    // Launch stealth browser with Decodo proxy
    browser = await chromium.launch({
      headless: true,
      proxy: PROXY,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'nl-NL',
    });

    // Inject cookies
    if (storageState.cookies && storageState.cookies.length > 0) {
      await context.addCookies(storageState.cookies);
    }

    const page = await context.newPage();

    // Navigate to Partner Portal
    console.log('[template] Navigating to partner.bol.com...');
    await page.goto('https://partner.bol.com/sdd/dashboard', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Check if still logged in
    const url = page.url();
    if (url.includes('login') || url.includes('accounts.bol.com')) {
      throw new Error('Not logged in — cookies expired. Refresh bol-storage-state.json via Cookie-Editor.');
    }
    console.log('[template] Logged in successfully ✅');

    // ─────────────────────────────────────────────────────────────────────────
    // YOUR LOGIC HERE
    // Examples:
    //
    // Navigate to offers:
    //   await page.goto('https://partner.bol.com/sdd/offers');
    //
    // Use internal API (JSON):
    //   const response = await page.evaluate(async () => {
    //     const res = await fetch('/sdd/offers/api/offers?page=1&page-size=50');
    //     return res.json();
    //   });
    //
    // Update a price via internal API:
    //   const update = await page.evaluate(async (offerId, newPrice) => {
    //     const res = await fetch(`/sdd/offers/api/offers/${offerId}/price`, {
    //       method: 'PUT',
    //       headers: { 'Content-Type': 'application/json' },
    //       body: JSON.stringify({ price: newPrice })
    //     });
    //     return { status: res.status, body: await res.json() };
    //   }, offerId, newPrice);
    //
    // ─────────────────────────────────────────────────────────────────────────

    result.success = true;
    result.data = { message: 'Template ran successfully — add your logic above' };

  } catch (err) {
    console.error('[template] Error:', err.message);
    result.error = err.message;
  } finally {
    if (browser) await browser.close();

    // Write result back to Browser_Tasks
    if (TASK_ID) {
      await supabase
        .from('Browser_Tasks')
        .update({
          status: result.success ? 'completed' : 'failed',
          result: result,
          completed_at: new Date().toISOString()
        })
        .eq('id', TASK_ID);
    }

    console.log('[template] Done:', JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  }
})();
