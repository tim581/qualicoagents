// inventory-sync-forceget.js v1.3 — CA + US 3PL (Forceget) inventory sync
// ISSUE: page.fill() fills the field but React doesn't pick up the value
// FIX v1.3: Use page.type() with delay for password input (triggers React onChange)
// ALSO: Use triple-click + type to clear and replace field content

const { chromium } = require('playwright-core');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SITE_URL = 'https://app.forceget.com/system/account/login';
const INV_URL = 'https://app.forceget.com/inventory-management/inventory';
const SITE_EMAIL = 'tim@qualico.be';
const SITE_PASSWORD = 'Sdi3vV8xl!+[z(W{OnjG]';
const TASK_ID = process.env.BROWSER_TASK_ID;

const RUN_ID = `forceget_inv_${Date.now()}`;

async function logDebug(step, status, message, screenshot = null) {
  try {
    await supabase.from('Flieber_Debug_Log').insert({
      run_id: RUN_ID, step, status, message: String(message).slice(0, 2000),
      screenshot: screenshot ? screenshot.toString('base64') : null
    });
  } catch (e) { console.error('  [DB:error]', e.message); }
  console.log(`  [DB:${status}] ${step}: ${String(message).slice(0, 200)}`);
  if (screenshot) console.log(`  📸 Screenshot → ${step}`);
}

async function run() {
  console.log(`🔍 Debug run ID: ${RUN_ID}`);
  console.log(`\n🚀 inventory-sync-forceget.js v1.3 starting...`);
  await logDebug('start', 'info', 'Script v1.3 starting');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    // === LOGIN ===
    console.log('\n🔐 Logging in...');
    await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    let ss = await page.screenshot(); await logDebug('login-page', 'screenshot', 'Initial page load', ss);
    await logDebug('login', 'info', `Current URL: ${page.url()}`);

    // Fill email — try page.type with delay (triggers React onChange)
    const emailSel = 'input[type="email"]';
    try {
      await page.click(emailSel);
      await page.fill(emailSel, ''); // clear first
      await page.type(emailSel, SITE_EMAIL, { delay: 20 });
      await logDebug('login', 'info', 'Email typed via page.type()');
    } catch (e) {
      await logDebug('login', 'error', `Email fill failed: ${e.message}`);
    }

    // Fill password — CRITICAL: use page.type with delay for React inputs
    const pwSel = 'input[type="password"]';
    try {
      await page.click(pwSel);
      await page.fill(pwSel, ''); // clear first
      // Use page.evaluate to set value + dispatch events (safest for special chars)
      await page.evaluate((opts) => {
        const el = document.querySelector(opts.sel);
        if (el) {
          // Set value natively
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          ).set;
          nativeInputValueSetter.call(el, opts.pwd);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, { sel: pwSel, pwd: SITE_PASSWORD });
      await logDebug('login', 'info', 'Password set via React-compatible evaluate');
    } catch (e) {
      await logDebug('login', 'error', `Password fill failed: ${e.message}`);
    }

    ss = await page.screenshot(); await logDebug('login-filled', 'screenshot', 'Credentials filled', ss);

    // Submit
    try {
      await page.click('button:has-text("Sign In")');
      await logDebug('login', 'info', 'Clicked Sign In button');
    } catch (e) {
      await page.keyboard.press('Enter');
      await logDebug('login', 'info', 'Pressed Enter as fallback');
    }

    await page.waitForTimeout(5000);
    const postLoginUrl = page.url();
    await logDebug('login', postLoginUrl.includes('login') ? 'error' : 'success', `Post-login URL: ${postLoginUrl}`);
    ss = await page.screenshot(); await logDebug('login-done', 'screenshot', 'After login', ss);

    // === NAVIGATE TO INVENTORY ===
    console.log('\n📦 Navigating to inventory page...');
    await page.goto(INV_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await logDebug('inventory', 'info', `On page: ${page.url()}`);

    if (page.url().includes('login')) {
      await logDebug('inventory', 'error', 'Redirected to login — authentication failed');
      // Try alternative: keyboard-based login
      await logDebug('retry', 'info', 'Attempting keyboard-based login...');
      await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      
      // Tab through form and type
      await page.keyboard.press('Tab');
      await page.keyboard.type(SITE_EMAIL, { delay: 30 });
      await page.keyboard.press('Tab');
      await page.keyboard.type(SITE_PASSWORD, { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(5000);
      
      ss = await page.screenshot(); await logDebug('retry-login', 'screenshot', 'Retry login result', ss);
      
      await page.goto(INV_URL, { waitUntil: 'networkidle', timeout: 30000 });
      if (page.url().includes('login')) {
        await logDebug('inventory', 'error', 'Retry also failed — giving up');
        await writeResult([], browser); return;
      }
    }

    ss = await page.screenshot(); await logDebug('inventory-page', 'screenshot', 'Inventory page', ss);

    // === DISCOVER PAGE STRUCTURE ===
    await page.waitForTimeout(3000);
    
    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      h1: Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.innerText.trim()).slice(0, 10),
      tables: document.querySelectorAll('table').length,
      tableHeaders: Array.from(document.querySelectorAll('table thead th, table th')).map(th => th.innerText.trim()),
      tabs: Array.from(document.querySelectorAll('[role="tab"], .tab, .nav-link')).map(t => t.innerText.trim()),
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).slice(0, 20),
    }));
    await logDebug('page-structure', 'info', JSON.stringify(pageInfo));

    // Extract table data
    const tableData = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th, table th')).map(th => th.innerText.trim());
      const rows = Array.from(document.querySelectorAll('table tbody tr')).map(row => {
        return Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
      });
      return { headers, rows: rows.filter(r => r.length > 2) };
    });
    
    await logDebug('table-data', 'info', `Headers: ${JSON.stringify(tableData.headers)}, Rows: ${tableData.rows.length}`);
    if (tableData.rows.length > 0) {
      await logDebug('sample-row', 'info', JSON.stringify(tableData.rows[0]));
    }

    // Parse products
    const products = [];
    const nameIdx = tableData.headers.findIndex(h => /product.*name|name/i.test(h));
    const skuIdx = tableData.headers.findIndex(h => /sku|barcode|ean/i.test(h));
    const qtyIdx = tableData.headers.findIndex(h => /qty|quantity|stock|units|available|inventory/i.test(h));
    const whIdx = tableData.headers.findIndex(h => /warehouse/i.test(h));
    
    await logDebug('columns', 'info', `Name=${nameIdx}, SKU=${skuIdx}, Qty=${qtyIdx}, Warehouse=${whIdx}`);

    for (const row of tableData.rows) {
      products.push({
        name: nameIdx >= 0 ? row[nameIdx] : '',
        sku: skuIdx >= 0 ? row[skuIdx] : '',
        quantity: qtyIdx >= 0 ? parseInt(row[qtyIdx]) || 0 : 0,
        warehouse: whIdx >= 0 ? row[whIdx] : ''
      });
    }

    await logDebug('results', 'info', `Parsed ${products.length} products: ${JSON.stringify(products.slice(0, 5))}`);
    
    const totalUnits = products.reduce((s, p) => s + p.quantity, 0);
    console.log(`\n✅ Found ${products.length} products, ${totalUnits} total units`);
    await logDebug('complete', 'success', `Finished: ${products.length} products, ${totalUnits} units`);
    ss = await page.screenshot(); await logDebug('complete', 'screenshot', 'Final state', ss);

    await writeResult(products, browser);
  } catch (err) {
    await logDebug('fatal', 'error', `${err.message}\n${err.stack}`);
    await writeResult([], browser);
  }
}

async function writeResult(products, browser) {
  if (TASK_ID) {
    try {
      await supabase.from('Browser_Tasks').update({
        result: { products, run_id: RUN_ID, version: 'v1.3' },
        status: 'done', completed_at: new Date().toISOString()
      }).eq('id', TASK_ID);
      console.log(`✅ Result written to Browser_Tasks id=${TASK_ID}`);
    } catch (e) { console.error('Failed to write result:', e.message); }
  }
  await browser.close();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
