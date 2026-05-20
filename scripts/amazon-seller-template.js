/**
 * amazon-seller-template.js
 * =========================
 * Template for agents that need access to Amazon Seller Central.
 * 
 * USAGE:
 * 1. Copy this file, rename to your task (e.g. amazon-cs-scrape.js)
 * 2. Replace the "YOUR LOGIC HERE" section with your own code
 * 3. Push to GitHub: tim581/qualicoagents/scripts/
 * 4. Insert a Browser_Task in Supabase with your task_type
 * 
 * IMPORTANT: Standalone script (no module.exports)
 * 
 * MARKETPLACE SWITCHING:
 * Amazon Seller Central = 1 account, multiple marketplaces via dropdown.
 * Use the marketplace-specific URLs or switch via the UI.
 * Marketplace URLs:
 *   NL: https://sellercentral.amazon.nl
 *   DE: https://sellercentral.amazon.de  
 *   FR: https://sellercentral.amazon.fr
 *   IT: https://sellercentral.amazon.it
 *   ES: https://sellercentral.amazon.es
 *   COM: https://sellercentral.amazon.com
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
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TASK_ID = process.env.BROWSER_TASK_ID;

// Target marketplace — change as needed
const MARKETPLACE_URL = 'https://sellercentral.amazon.nl';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  let browser;
  const result = { success: false, data: null, error: null };

  try {
    // Load cookies
    const storageStatePath = path.join(__dirname, 'amazon-storage-state.json');
    if (!fs.existsSync(storageStatePath)) {
      throw new Error('amazon-storage-state.json not found. Run convert-amazon-cookies.js first.');
    }
    const storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
    console.log(`[amazon] Loaded ${storageState.cookies.length} cookies`);

    // Launch stealth browser with Decodo proxy
    browser = await chromium.launch({
      headless: true,
      proxy: PROXY,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'nl-NL',
    });

    // Inject cookies
    await context.addCookies(storageState.cookies);

    const page = await context.newPage();

    // Navigate to Seller Central
    console.log(`[amazon] Navigating to ${MARKETPLACE_URL}...`);
    await page.goto(MARKETPLACE_URL, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Check if still logged in
    const url = page.url();
    if (url.includes('/ap/signin') || url.includes('signin') || url.includes('auth/signin')) {
      throw new Error('Not logged in — cookies expired. Refresh amazon-storage-state.json via Cookie-Editor.');
    }
    console.log('[amazon] Logged in successfully ✅');
    console.log('[amazon] Current URL:', url);

    // ─────────────────────────────────────────────────────────────────────────
    // YOUR LOGIC HERE
    // Examples:
    //
    // Go to Buyer Messages (customer service):
    //   await page.goto(`${MARKETPLACE_URL}/messaging/inbox`);
    //
    // Go to Manage Orders:
    //   await page.goto(`${MARKETPLACE_URL}/orders-v3/ref=xx_myo_dnav_xx`);
    //
    // Switch marketplace via URL (sometimes asks re-login):
    //   await page.goto('https://sellercentral.amazon.de/...');
    //
    // Fetch internal API:
    //   const data = await page.evaluate(async (url) => {
    //     const res = await fetch(url, { credentials: 'include' });
    //     return res.json();
    //   }, `${MARKETPLACE_URL}/api/your-endpoint`);
    //
    // ─────────────────────────────────────────────────────────────────────────

    result.success = true;
    result.data = { message: 'Amazon template ran successfully — add your logic above' };

  } catch (err) {
    console.error('[amazon] Error:', err.message);
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

    console.log('[amazon] Done:', JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  }
})();
