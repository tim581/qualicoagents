/**
 * inventory-sync-mintsoft.js  v1.0 — Scrape Mintsoft/WePrepFBA UK 3PL inventory
 *
 * Portal: https://om.mintsoft.co.uk
 * Login: tim@qualico.be / password (special chars — use page.fill)
 * Products: UK-based Puzzlup stock at WePrepFBA Ipswich
 *
 * Prerequisites: node playwright-task-executor.js on Tim's PC
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');

const SITE_URL      = 'https://om.mintsoft.co.uk/UserAccount/LogOn';
const SITE_EMAIL    = 'tim@qualico.be';
const SITE_PASSWORD = ':(=efV\\5CzI[-KJYtoHA';
const WAREHOUSE_NAME = 'Mintsoft/WePrepFBA';


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


const RUN_ID = `mintsoft_inv_${Date.now()}`;
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



async function login(page) {
  console.log('\n🔐 Logging in...');
  await dbLog('login', 'info', 'Navigating to site...');
  await page.goto('https://om.mintsoft.co.uk/UserAccount/LogOn', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await dbShot(page, 'login-page', 'Initial page load');
  await dbLog('login', 'info', `Current URL: ${page.url()}`);

  // Check if already logged in
  if (!page.url().includes('/LogOn') && !page.url().includes('/login')) {
    await dbLog('login', 'success', 'Already logged in!');
    return;
  }

  // Fill email — try multiple selectors
  const emailSels = ['input[type="email"]', 'input[name="email"]', 'input[name="username"]', 
                     'input[name="UserName"]', 'input[id*="mail" i]', 'input[id*="user" i]',
                     'input[placeholder*="email" i]', 'input[placeholder*="user" i]'];
  let emailFilled = false;
  for (const sel of emailSels) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        await page.fill(sel, SITE_EMAIL);
        await dbLog('login', 'info', `Email filled via ${sel}`);
        emailFilled = true;
        break;
      }
    } catch {}
  }
  if (!emailFilled) {
    await dbLog('login', 'error', 'Could not find email field!');
    await dbShot(page, 'login-no-email', 'Email field not found');
  }

  // Fill password — page.fill() first (handles special chars well)
  const pwSels = ['input[type="password"]', 'input[name="password"]', 'input[name="Password"]',
                  'input[id*="pass" i]'];
  let pwFilled = false;
  for (const sel of pwSels) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        // Method 1: page.fill() — best for most forms
        try {
          await page.fill(sel, SITE_PASSWORD);
          pwFilled = true;
          await dbLog('login', 'info', `Password filled via page.fill(${sel})`);
          break;
        } catch (fillErr) {
          await dbLog('login', 'warning', `page.fill failed: ${fillErr.message}`);
          // Method 2: evaluate with native setter
          try {
            await page.evaluate((opts) => {
              const el = document.querySelector(opts.sel);
              if (el) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(el, opts.pw);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, {sel, pw: SITE_PASSWORD});
            pwFilled = true;
            await dbLog('login', 'info', 'Password filled via evaluate()');
            break;
          } catch (evalErr) {
            await dbLog('login', 'warning', `evaluate() failed: ${evalErr.message}`);
            // Method 3: click + type
            try {
              await page.click(sel);
              await page.keyboard.type(SITE_PASSWORD, { delay: 30 });
              pwFilled = true;
              await dbLog('login', 'info', 'Password filled via keyboard.type()');
              break;
            } catch {}
          }
        }
      }
    } catch {}
  }
  if (!pwFilled) {
    await dbLog('login', 'error', 'Could not fill password!');
    await dbShot(page, 'login-no-pw', 'Password not filled');
  }

  await dbShot(page, 'login-filled', 'Credentials filled');

  // Click submit
  const btnSels = ['button[type="submit"]', 'input[type="submit"]',
                   'button:has-text("Sign In")', 'button:has-text("Log In")',
                   'button:has-text("Login")', 'button:has-text("Inloggen")',
                   'input[value="Log On"]', 'input[value="Login"]'];
  let clicked = false;
  for (const sel of btnSels) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        await el.click();
        clicked = true;
        await dbLog('login', 'info', `Clicked ${sel}`);
        break;
      }
    } catch {}
  }
  if (!clicked) {
    await page.keyboard.press('Enter');
    await dbLog('login', 'info', 'Pressed Enter as fallback');
  }

  await page.waitForTimeout(6000);
  await dbLog('login', 'success', `Post-login URL: ${page.url()}`);
  await dbShot(page, 'login-done', 'After login');
}


async function scrapeInventory(page) {
  console.log('\n📦 Looking for inventory/stock page...');
  await dbLog('inventory', 'info', 'Looking for inventory page...');
  
  // Mintsoft: try common inventory/products URLs
  const inventoryUrls = [
    'https://om.mintsoft.co.uk/Product',
    'https://om.mintsoft.co.uk/Inventory',
    'https://om.mintsoft.co.uk/Stock',
    'https://om.mintsoft.co.uk/Product/Index',
  ];
  
  let foundPage = false;
  for (const url of inventoryUrls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      if (!page.url().includes('/LogOn')) {
        await dbLog('inventory', 'info', `Found page at: ${url}`);
        foundPage = true;
        break;
      }
    } catch {}
  }
  
  if (!foundPage) {
    // Look for navigation links
    await dbLog('inventory', 'warning', 'No direct URL worked, discovering navigation...');
    await page.goto('https://om.mintsoft.co.uk', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  }
  
  await dbLog('inventory', 'info', `On page: ${page.url()}`);
  await dbShot(page, 'inventory-page', 'Inventory/products page');
  
  
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

  
  // All products from Mintsoft are UK
  for (const r of results) {
    r.region = 'UK';
    r.channel = '3PL UK';
    r.channel_type = '3PL';
  }
  
  return results;
}

(async () => {
  let browser;
  try {
    console.log('🚀 inventory-sync-mintsoft.js v1.0 starting...');
    await dbLog('start', 'info', 'Script v1.0 starting');
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await login(page);
    const products = await scrapeInventory(page);

    const result = {
      warehouse: 'mintsoft',
      run_id: RUN_ID,
      timestamp: new Date().toISOString(),
      products,
      total_units: products.reduce((s, r) => s + r.units_on_hand, 0),
      product_count: products.length,
    };

    await updateTaskResult(result);
    console.log(`\n✅ Found ${products.length} products, ${result.total_units} total units`);
    for (const p of products) console.log(`   ${p.product_name}: ${p.units_on_hand}`);
    await dbLog('complete', 'success', `Finished: ${products.length} products, ${result.total_units} units`);
    await dbShot(page, 'complete', 'Final state');
  } catch (err) {
    console.error('❌ Fatal:', err.message);
    await dbLog('fatal', 'error', `${err.message}\n${err.stack}`);
    await updateTaskResult({ warehouse: 'mintsoft', run_id: RUN_ID, error: err.message, products: [], total_units: 0 });
  } finally {
    if (browser) await browser.close();
    await new Promise(r => setTimeout(r, 2000));
  }
})();
