/**
 * inventory-sync-kamps.js  v1.0 — Scrape Kamps/Vanthiel EU 3PL inventory
 *
 * Portal: https://kampspijnacker.coraxwms.nl
 * Login: Microsoft SSO → qualico@coraxwms.nl / Jt_58bEAKP!iJyW
 * ⚠️ May require MFA — if MFA appears, script logs it and stops
 * Products: EU/NL-based Puzzlup stock at Vanthiel/Kamps Pijnacker
 *
 * NOTE: Kamps WMS tracks stock in "colli" (master cartons), not units.
 * Conversion: units = colli × units_per_master (from Puzzlup_Product_Info)
 * The agent handles this conversion after scraping — script returns raw colli.
 *
 * Prerequisites: node playwright-task-executor.js on Tim's PC
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');

const SITE_URL      = 'https://kampspijnacker.coraxwms.nl';
const SITE_EMAIL    = 'qualico@coraxwms.nl';
const SITE_PASSWORD = 'Jt_58bEAKP!iJyW';
const WAREHOUSE_NAME = 'Kamps/Vanthiel';


function matchProductName(text) {
  const t = (text || '').toUpperCase();
  if (t.includes('1000') && (t.includes('GIFT') || t.includes('MAT'))) return 'MAT 1000 GIFT';
  if (t.includes('5000') && (t.includes('GIFT') || t.includes('MAT'))) return 'MAT 5000 GIFT';
  if (t.includes('3000') && (t.includes('GIFT') || t.includes('MAT')) && !t.includes('TRAY') && !t.includes('ECO')) return 'MAT 3000 GIFT';
  if (t.includes('1500') && t.includes('LUX')) return 'MAT 1500 LUX';
  if (t.includes('1500') && t.includes('ECO')) return 'MAT 1500 ECO';
  if (t.includes('3000') && t.includes('ECO')) return 'MAT 3000 ECO';
  if (t.includes('1500') && t.includes('WHITE') && t.includes('TRAY')) return 'TRAYS 1500 WHITE';
  if (t.includes('1500') && t.includes('WHITE') && !t.includes('TRAY')) return 'MAT 1500 WHITE';
  if (t.includes('1500') && (t.includes('GIFT') || t.includes('MAT')) && !t.includes('TRAY') && !t.includes('LUX') && !t.includes('ECO') && !t.includes('WHITE')) return 'MAT 1500 GIFT';
  if (t.includes('TRAY') && t.includes('BLACK') && t.includes('1500')) return 'TRAYS 1500 BLACK';
  if (t.includes('TRAY') && (t.includes('3000') || t.includes('DOUBLE'))) return 'TRAYS 3000 BLACK';
  if (t.includes('TRAY') && t.includes('WHITE')) return 'TRAYS 1500 WHITE';
  if (t.includes('BAG') && t.includes('LUX')) return 'BAG LUX 1500';
  return null;
}


const RUN_ID = `kamps_inv_${Date.now()}`;
console.log(`🔍 Debug run ID: ${RUN_ID}`);
console.log(`   → Query: SELECT * FROM "Flieber_Debug_Log" WHERE run_id = '${RUN_ID}'\n`);


async function dbLog(step, status, message) {
  const short = (message || '').toString().substring(0, 3000);
  console.log(`  [DB:${status}] ${step}: ${short.substring(0, 200)}`);
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ run_id: RUN_ID, step, status, message: short }),
    });
  } catch (e) { /* never break the main flow */ }
}

async function dbShot(page, step, label) {
  try {
    const buf = await page.screenshot({ fullPage: false });
    const b64 = buf.toString('base64').substring(0, 400000);
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ run_id: RUN_ID, step, status: 'screenshot', message: label, screenshot: b64 }),
    });
    console.log(`  📸 Screenshot → ${step} (${label})`);
  } catch (e) { /* never break the main flow */ }
}

async function updateTaskResult(resultData) {
  const taskId = process.env.BROWSER_TASK_ID;
  if (!taskId) { console.log('⚠️ No BROWSER_TASK_ID — skipping result update'); return; }
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/Browser_Tasks?id=eq.${taskId}`, {
      method: 'PATCH',
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ result: JSON.stringify(resultData) }),
    });
    console.log(`✅ Result written to Browser_Tasks id=${taskId}`);
  } catch (e) { console.log(`⚠️ Failed to update task result: ${e.message}`); }
}


// ── MICROSOFT SSO LOGIN ──────────────────────────────────────────────────────
// Microsoft SSO has a multi-step flow:
// 1. Redirect to login.microsoftonline.com
// 2. Enter email → Next
// 3. Enter password → Sign in
// 4. Possibly "Stay signed in?" → No/Yes
// 5. Possibly MFA prompt → script stops
// 6. Redirect back to Kamps portal

async function login(page) {
  console.log('\n🔐 Logging in via Microsoft SSO...');
  await dbLog('login', 'info', 'Navigating to Kamps portal...');
  
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  await dbShot(page, 'login-page', 'Initial page / SSO redirect');
  await dbLog('login', 'info', `Current URL: ${page.url()}`);
  
  // Check if already logged in
  if (!page.url().includes('login') && !page.url().includes('microsoftonline')) {
    await dbLog('login', 'success', 'Already logged in!');
    return;
  }
  
  // ── Step 1: Enter email ──
  try {
    const emailSel = 'input[type="email"], input[name="loginfmt"], input[name="login"]';
    await page.waitForSelector(emailSel, { timeout: 15000 });
    await page.fill(emailSel, SITE_EMAIL);
    await dbLog('login', 'info', 'Email filled on Microsoft page');
    
    // Click Next
    const nextBtn = await page.$('input[type="submit"][value="Next"], input[type="submit"], #idSIButton9');
    if (nextBtn) {
      await nextBtn.click();
      await dbLog('login', 'info', 'Clicked Next');
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(3000);
  } catch (e) {
    await dbLog('login', 'error', `Email step failed: ${e.message}`);
    await dbShot(page, 'login-email-fail', 'Email step failed');
  }
  
  await dbShot(page, 'login-after-email', 'After email entry');
  
  // ── Step 2: Enter password ──
  try {
    const pwSel = 'input[type="password"], input[name="passwd"]';
    await page.waitForSelector(pwSel, { timeout: 15000 });
    
    // page.fill() first
    try {
      await page.fill(pwSel, SITE_PASSWORD);
      await dbLog('login', 'info', 'Password filled via page.fill');
    } catch {
      // Fallback: evaluate
      await page.evaluate((opts) => {
        const el = document.querySelector(opts.sel);
        if (el) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, opts.pw);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, {sel: pwSel, pw: SITE_PASSWORD});
      await dbLog('login', 'info', 'Password filled via evaluate');
    }
    
    // Click Sign In
    const signInBtn = await page.$('input[type="submit"][value="Sign in"], input[type="submit"], #idSIButton9');
    if (signInBtn) {
      await signInBtn.click();
      await dbLog('login', 'info', 'Clicked Sign in');
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(5000);
  } catch (e) {
    await dbLog('login', 'error', `Password step failed: ${e.message}`);
    await dbShot(page, 'login-pw-fail', 'Password step failed');
  }
  
  await dbShot(page, 'login-after-pw', 'After password entry');
  
  // ── Step 3: "Stay signed in?" prompt ──
  try {
    const staySignedIn = await page.$('input[type="submit"][value="No"], #idBtn_Back, input[type="submit"][value="Yes"], #idSIButton9');
    if (staySignedIn) {
      // Click "Yes" to stay signed in (avoids this prompt next time)
      const yesBtn = await page.$('#idSIButton9, input[type="submit"][value="Yes"]');
      if (yesBtn) {
        await yesBtn.click();
        await dbLog('login', 'info', 'Clicked Yes on "Stay signed in"');
      } else {
        await staySignedIn.click();
        await dbLog('login', 'info', 'Clicked button on "Stay signed in" prompt');
      }
      await page.waitForTimeout(5000);
    }
  } catch {}
  
  // ── Step 4: Check for MFA ──
  const url = page.url();
  if (url.includes('microsoftonline') || url.includes('login')) {
    // Could be MFA
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes('Verify') || pageText.includes('authenticator') || pageText.includes('code') || pageText.includes('approve')) {
      await dbLog('login', 'error', 'MFA DETECTED — script cannot proceed. Tim must approve on phone/authenticator.');
      await dbShot(page, 'mfa-detected', 'MFA prompt');
      // Wait 60s for Tim to manually approve
      console.log('\n⏳ MFA detected! Waiting 60s for manual approval...');
      await page.waitForTimeout(60000);
      await dbLog('login', 'info', `URL after MFA wait: ${page.url()}`);
    }
  }
  
  await dbLog('login', 'success', `Post-login URL: ${page.url()}`);
  await dbShot(page, 'login-done', 'After login');
}

async function scrapeInventory(page) {
  console.log('\n📦 Navigating to stock/inventory page...');
  await dbLog('inventory', 'info', 'Looking for stock page...');
  
  // Try common Corax WMS inventory URLs
  const stockUrls = [
    SITE_URL + '/Voorraad',
    SITE_URL + '/Stock',
    SITE_URL + '/Inventory',
    SITE_URL + '/Artikelen',
    SITE_URL + '/Products',
  ];
  
  // First, discover the main navigation
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Log navigation structure
  const navLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('nav a, .sidebar a, .menu a, a[href]'))
      .map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') }))
      .filter(l => l.text.length > 0 && l.text.length < 50)
      .slice(0, 40);
  });
  await dbLog('navigation', 'info', JSON.stringify(navLinks).substring(0, 3000));
  
  // Try to find stock/voorraad link
  let stockLink = navLinks.find(l => 
    l.text.toLowerCase().includes('voorraad') || 
    l.text.toLowerCase().includes('stock') || 
    l.text.toLowerCase().includes('inventory')
  );
  
  if (stockLink && stockLink.href) {
    const fullUrl = stockLink.href.startsWith('http') ? stockLink.href : SITE_URL + stockLink.href;
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await dbLog('inventory', 'info', `Navigated to: ${fullUrl}`);
  } else {
    // Try URLs directly
    for (const url of stockUrls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
        if (!page.url().includes('login') && !page.url().includes('error')) {
          await dbLog('inventory', 'info', `Found page at: ${url}`);
          break;
        }
      } catch {}
    }
  }
  
  await dbLog('inventory', 'info', `On page: ${page.url()}`);
  await dbShot(page, 'inventory-page', 'Stock page loaded');
  
  
  // ── DISCOVERY: Log page structure ──
  const pageStructure = await page.evaluate(() => ({
    title: document.title,
    url: window.location.href,
    h1: Array.from(document.querySelectorAll('h1,h2,h3')).map(e => e.textContent.trim()).slice(0, 15),
    tables: document.querySelectorAll('table').length,
    tabs: Array.from(document.querySelectorAll('[role="tab"], .tab, [class*="tab"]')).map(e => e.textContent.trim()).slice(0, 20),
    selects: Array.from(document.querySelectorAll('select')).map(e => ({
      name: e.name || e.id, options: Array.from(e.options).map(o => o.text).slice(0, 10)
    })),
    buttons: Array.from(document.querySelectorAll('button, a.btn, input[type="button"]')).map(e => e.textContent.trim()).filter(t => t.length > 0 && t.length < 50).slice(0, 30),
    links: Array.from(document.querySelectorAll('a[href]')).map(e => ({text: e.textContent.trim().substring(0,40), href: e.getAttribute('href')})).filter(l => l.text.length > 0).slice(0, 30),
  }));
  await dbLog('page-structure', 'info', JSON.stringify(pageStructure).substring(0, 3000));

  // ── TABLE SCRAPE: Standard HTML table ──
  let tableData = await page.evaluate(() => {
    const rows = [];
    for (const table of document.querySelectorAll('table')) {
      const headers = Array.from(table.querySelectorAll('thead th, thead td')).map(h => h.textContent.trim());
      for (const row of table.querySelectorAll('tbody tr')) {
        const cells = Array.from(row.querySelectorAll('td')).map(c => c.textContent.trim());
        if (cells.length >= 2) rows.push({ headers, cells });
      }
    }
    return rows;
  });
  await dbLog('table-scan', 'info', `Found ${tableData.length} table rows`);

  // Log first 5 rows for debugging
  for (let i = 0; i < Math.min(5, tableData.length); i++) {
    await dbLog(`row-${i}`, 'info', JSON.stringify(tableData[i]).substring(0, 500));
  }

  // ── GRID FALLBACK: If no table rows ──
  if (tableData.length === 0) {
    tableData = await page.evaluate(() => {
      const rows = [];
      const items = document.querySelectorAll('[class*="row"], [class*="item"], [class*="product"], [role="row"], [role="gridcell"]');
      for (const item of items) {
        const text = item.textContent.trim();
        if (text.length > 10 && text.length < 500) rows.push({ headers: [], cells: [text] });
      }
      return rows.slice(0, 50);
    });
    await dbLog('grid-scan', 'info', `Found ${tableData.length} grid items`);
  }

  // ── TEXT FALLBACK: Dump page text ──
  if (tableData.length === 0) {
    const allText = await page.evaluate(() => document.body.innerText);
    await dbLog('page-text-1', 'info', allText.substring(0, 3000));
    await dbLog('page-text-2', 'info', allText.substring(3000, 6000));
  }

  
  
  // ── PARSE: Extract product names and quantities ──
  const results = [];
  if (tableData.length > 0) {
    for (const row of tableData) {
      const cells = row.cells;
      const headers = (row.headers || []).map(h => h.toUpperCase());
      
      let productText = '';
      let qty = 0;
      let warehouse = '';
      
      const pCol = headers.findIndex(h => h.includes('PRODUCT') || h.includes('SKU') || h.includes('NAME') || h.includes('DESCRIPTION') || h.includes('ARTICLE') || h.includes('ARTIKEL'));
      const qCol = headers.findIndex(h => h.includes('AVAILABLE') || h.includes('QTY') || h.includes('ON HAND') || h.includes('STOCK') || h.includes('QUANTITY') || h.includes('VOORRAAD') || h.includes('COLLI') || h.includes('UNITS'));
      const wCol = headers.findIndex(h => h.includes('WAREHOUSE') || h.includes('LOCATION') || h.includes('MAGAZIJN'));
      
      productText = (pCol >= 0 && pCol < cells.length) ? cells[pCol] : cells[0] || '';
      
      if (qCol >= 0 && qCol < cells.length) {
        qty = parseInt(cells[qCol].replace(/[^0-9-]/g, ''), 10) || 0;
      } else {
        for (let i = 1; i < cells.length; i++) {
          const num = parseInt(cells[i].replace(/[^0-9-]/g, ''), 10);
          if (!isNaN(num) && num >= 0) { qty = num; break; }
        }
      }
      
      if (wCol >= 0 && wCol < cells.length) warehouse = cells[wCol];
      
      const stdName = matchProductName(productText);
      if (stdName) {
        results.push({
          product_name: stdName,
          units_on_hand: qty,
          warehouse: warehouse || WAREHOUSE_NAME,
          raw_name: productText,
        });
      }
    }
  }
  
  await dbLog('results', 'info', `Scraped ${results.length} products: ${results.map(r => `${r.product_name}(${r.units_on_hand})`).join(', ')}`);

  
  // All products from Kamps are EU
  for (const r of results) {
    r.region = 'Europe';
    r.channel = '3PL EU';
    r.channel_type = '3PL';
    // NOTE: Kamps may report in "colli" (master cartons) — agent converts to units
    r.unit_type = 'unknown'; // Agent must verify if colli or units
  }
  
  return results;
}

(async () => {
  let browser;
  try {
    console.log('🚀 inventory-sync-kamps.js v1.0 starting...');
    await dbLog('start', 'info', 'Script v1.0 starting');
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await login(page);
    const products = await scrapeInventory(page);

    const result = {
      warehouse: 'kamps',
      run_id: RUN_ID,
      timestamp: new Date().toISOString(),
      products,
      total_units: products.reduce((s, r) => s + r.units_on_hand, 0),
      product_count: products.length,
      note: 'Kamps may report colli (cartons) not units — verify and multiply by units_per_master if needed',
    };

    await updateTaskResult(result);
    console.log(`\n✅ Found ${products.length} products, ${result.total_units} total`);
    for (const p of products) console.log(`   ${p.product_name}: ${p.units_on_hand}`);
    await dbLog('complete', 'success', `Finished: ${products.length} products, ${result.total_units} total`);
    await dbShot(page, 'complete', 'Final state');
  } catch (err) {
    console.error('❌ Fatal:', err.message);
    await dbLog('fatal', 'error', `${err.message}\n${err.stack}`);
    await updateTaskResult({ warehouse: 'kamps', run_id: RUN_ID, error: err.message, products: [], total_units: 0 });
  } finally {
    if (browser) await browser.close();
    await new Promise(r => setTimeout(r, 2000));
  }
})();
