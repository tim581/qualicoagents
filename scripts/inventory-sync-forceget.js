/**
 * inventory-sync-forceget.js  v1.0 — Scrape Forceget CA/US 3PL inventory
 *
 * Prerequisites (on Tim's machine):
 *   cd C:\Users\Tim\playwright-render-service
 *   node playwright-task-executor.js
 *
 * .env must contain:
 *   SUPABASE_URL=https://zlteahycfmpiaxdbnlvr.supabase.co
 *   SUPABASE_KEY=<service_role key>
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const SITE_URL      = 'https://app.forceget.com';
const INVENTORY_URL = 'https://app.forceget.com/inventory-management/inventory';
const SITE_EMAIL    = 'tim@qualico.be';
const SITE_PASSWORD = 'Sdi3vV8xl!+[z(W{OnjG';

// ── PRODUCT NAME MAPPING ──────────────────────────────────────────────────────

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
  if (t.includes('QUALICO') && t.includes('1500')) return 'QUALICO 1500';
  if (t.includes('QUALICO') && t.includes('3000')) return 'QUALICO 3000';
  if (t.includes('BOARD')) return 'BOARD 1500';
  return null;
}

// ── SELF-DEBUGGING: SUPABASE LOG ──────────────────────────────────────────────

const RUN_ID = `forceget_inv_${Date.now()}`;
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

// ── UPDATE BROWSER_TASKS RESULT ───────────────────────────────────────────────

async function updateTaskResult(resultData) {
  const taskId = process.env.BROWSER_TASK_ID;
  if (!taskId) {
    console.log('⚠️ No BROWSER_TASK_ID — skipping result update');
    return;
  }
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
  } catch (e) {
    console.log(`⚠️ Failed to update task result: ${e.message}`);
  }
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────

async function login(page) {
  console.log('\n🔐 Logging in to Forceget...');
  await dbLog('login', 'info', 'Navigating to Forceget...');

  // ⚠️ ALWAYS use 'domcontentloaded' — NEVER 'networkidle' (SPAs hang forever)
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  await dbShot(page, 'login-page', 'Initial page load');

  const url = page.url();
  await dbLog('login', 'info', `Current URL: ${url}`);

  // Check if already logged in
  if (url.includes('/dashboard') || url.includes('/inventory')) {
    await dbLog('login', 'success', 'Already logged in!');
    return;
  }

  // Find and fill email
  try {
    const emailSel = 'input[type="email"], input[name="email"], input[name="username"], input[placeholder*="email" i], input[placeholder*="Email" i]';
    await page.waitForSelector(emailSel, { timeout: 15000 });
    await page.fill(emailSel, SITE_EMAIL);
    await dbLog('login', 'info', 'Email filled');
  } catch (e) {
    await dbLog('login', 'warning', `Email field not found: ${e.message}`);
    await dbShot(page, 'login-no-email', 'Cannot find email field');
  }

  // Fill password via clipboard paste (special chars!)
  try {
    const pwSel = 'input[type="password"], input[name="password"]';
    await page.waitForSelector(pwSel, { timeout: 10000 });
    
    // Method 1: Try evaluate to set value directly (most reliable for special chars)
    await page.evaluate((sel, pw) => {
      const el = document.querySelector(sel);
      if (el) {
        // Use native input value setter to bypass React/Vue controlled inputs
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(el, pw);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, pwSel, SITE_PASSWORD);

    // Verify it was set
    const pwVal = await page.$eval(pwSel, el => el.value);
    if (!pwVal || pwVal.length < 5) {
      await dbLog('login', 'warning', 'Direct value set failed, trying type()...');
      await page.click(pwSel);
      await page.keyboard.type(SITE_PASSWORD, { delay: 30 });
    }
    
    await dbLog('login', 'info', `Password filled (${pwVal ? pwVal.length : '?'} chars)`);
  } catch (e) {
    await dbLog('login', 'error', `Password field issue: ${e.message}`);
    await dbShot(page, 'login-no-pw', 'Cannot find password field');
  }

  await dbShot(page, 'login-filled', 'Credentials filled');

  // Click login/submit button
  try {
    const btnSel = 'button[type="submit"], button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Login"), input[type="submit"]';
    await page.click(btnSel);
    await dbLog('login', 'info', 'Login button clicked');
  } catch (e) {
    // Try pressing Enter as fallback
    await page.keyboard.press('Enter');
    await dbLog('login', 'info', 'Pressed Enter as login fallback');
  }

  // Wait for navigation after login
  await page.waitForTimeout(5000);
  await dbLog('login', 'success', `Post-login URL: ${page.url()}`);
  await dbShot(page, 'login-done', 'After login');
}

// ── SCRAPE INVENTORY ──────────────────────────────────────────────────────────

async function scrapeInventory(page) {
  console.log('\n📦 Navigating to inventory page...');
  await dbLog('inventory', 'info', 'Navigating to inventory page...');

  await page.goto(INVENTORY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  await dbLog('inventory', 'info', `On page: ${page.url()}`);
  await dbShot(page, 'inventory-page', 'Inventory page loaded');

  const results = [];

  // ── STEP 1: Understand the page structure ──
  // Take inventory of what we see: tabs, dropdowns, tables
  const pageStructure = await page.evaluate(() => {
    const info = {
      title: document.title,
      h1: Array.from(document.querySelectorAll('h1,h2,h3')).map(e => e.textContent.trim()).slice(0, 10),
      tables: document.querySelectorAll('table').length,
      tabs: Array.from(document.querySelectorAll('[role="tab"], .tab, [class*="tab"]')).map(e => e.textContent.trim()).slice(0, 20),
      selects: Array.from(document.querySelectorAll('select')).map(e => ({
        name: e.name || e.id,
        options: Array.from(e.options).map(o => o.text).slice(0, 10)
      })),
      buttons: Array.from(document.querySelectorAll('button')).map(e => e.textContent.trim()).filter(t => t.length > 0 && t.length < 50).slice(0, 20),
    };
    return info;
  });
  
  await dbLog('inventory-structure', 'info', JSON.stringify(pageStructure).substring(0, 3000));

  // ── STEP 2: Look for warehouse/location selector ──
  // Forceget may have tabs or a dropdown for Toronto (CA) vs US warehouse
  const warehouseNames = ['Toronto', 'Canada', 'CA', 'United States', 'US', 'USA', 'Los Angeles', 'LA', 'Fontana'];
  
  // Check for clickable warehouse tabs/buttons
  for (const wh of warehouseNames) {
    try {
      const tab = await page.$(`button:has-text("${wh}"), a:has-text("${wh}"), [role="tab"]:has-text("${wh}"), div[class*="tab"]:has-text("${wh}")`);
      if (tab) {
        await dbLog('warehouse-tab', 'info', `Found warehouse tab: ${wh}`);
      }
    } catch {}
  }

  // ── STEP 3: Scrape the inventory table ──
  // Try multiple approaches to find product data

  // Approach A: Standard HTML table
  let tableData = await page.evaluate(() => {
    const rows = [];
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('thead th, thead td')).map(h => h.textContent.trim());
      const bodyRows = table.querySelectorAll('tbody tr');
      for (const row of bodyRows) {
        const cells = Array.from(row.querySelectorAll('td')).map(c => c.textContent.trim());
        if (cells.length >= 2) {
          rows.push({ headers, cells });
        }
      }
    }
    return rows;
  });

  await dbLog('table-scan-a', 'info', `Found ${tableData.length} table rows via <table>`);

  // Approach B: If no table rows, try grid/div-based layouts
  if (tableData.length === 0) {
    tableData = await page.evaluate(() => {
      const rows = [];
      // Try common grid selectors
      const gridRows = document.querySelectorAll('[class*="row"], [class*="item"], [class*="product"], [role="row"]');
      for (const row of gridRows) {
        const text = row.textContent.trim();
        if (text.length > 10 && text.length < 500) {
          rows.push({ headers: [], cells: [text] });
        }
      }
      return rows.slice(0, 50);
    });
    await dbLog('table-scan-b', 'info', `Found ${tableData.length} items via grid selectors`);
  }

  // Approach C: Extract ALL visible text for analysis
  if (tableData.length === 0) {
    const allText = await page.evaluate(() => document.body.innerText);
    await dbLog('page-text', 'info', allText.substring(0, 3000));
    await dbLog('page-text-2', 'info', allText.substring(3000, 6000));
  }

  // ── STEP 4: Parse table data into products ──
  if (tableData.length > 0) {
    await dbLog('parsing', 'info', `Headers: ${JSON.stringify(tableData[0]?.headers)}`);
    // Log first 3 rows for debugging
    for (let i = 0; i < Math.min(3, tableData.length); i++) {
      await dbLog(`row-${i}`, 'info', JSON.stringify(tableData[i].cells));
    }

    for (const row of tableData) {
      const cells = row.cells;
      const headers = row.headers.map(h => h.toUpperCase());

      // Find the product name cell and quantity cell
      let productText = '';
      let qty = 0;
      let warehouse = '';

      // Try to identify columns by headers
      const productCol = headers.findIndex(h => h.includes('PRODUCT') || h.includes('SKU') || h.includes('NAME') || h.includes('DESCRIPTION'));
      const qtyCol = headers.findIndex(h => h.includes('AVAILABLE') || h.includes('QTY') || h.includes('ON HAND') || h.includes('STOCK'));
      const whCol = headers.findIndex(h => h.includes('WAREHOUSE') || h.includes('LOCATION') || h.includes('FACILITY'));

      if (productCol >= 0 && productCol < cells.length) {
        productText = cells[productCol];
      } else {
        productText = cells[0] || '';
      }

      if (qtyCol >= 0 && qtyCol < cells.length) {
        qty = parseInt(cells[qtyCol].replace(/[^0-9-]/g, ''), 10) || 0;
      } else {
        // Find first numeric cell
        for (let i = 1; i < cells.length; i++) {
          const num = parseInt(cells[i].replace(/[^0-9-]/g, ''), 10);
          if (!isNaN(num) && num >= 0) {
            qty = num;
            break;
          }
        }
      }

      if (whCol >= 0 && whCol < cells.length) {
        warehouse = cells[whCol];
      }

      const stdName = matchProductName(productText);
      if (stdName) {
        // Determine region from warehouse name or default to CA
        let region = 'Canada';
        let channel = '3PL CA';
        const whLower = (warehouse || '').toLowerCase();
        if (whLower.includes('us') || whLower.includes('united states') || whLower.includes('fontana') || whLower.includes('la') || whLower.includes('los angeles')) {
          region = 'US';
          channel = '3PL US';
        }

        results.push({
          product_name: stdName,
          units_on_hand: qty,
          warehouse: warehouse || 'Forceget',
          region,
          channel,
          channel_type: '3PL',
          raw_name: productText,
        });
      }
    }
  }

  await dbLog('results', 'info', `Scraped ${results.length} products: ${results.map(r => `${r.product_name}(${r.units_on_hand})`).join(', ')}`);

  // ── STEP 5: Check for pagination ──
  try {
    const nextBtn = await page.$('button:has-text("Next"), a:has-text("Next"), [aria-label="Next page"]');
    if (nextBtn) {
      await dbLog('pagination', 'warning', 'Pagination detected — only first page scraped. May need to handle multiple pages.');
    }
  } catch {}

  return results;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

(async () => {
  let browser;
  try {
    console.log('🚀 inventory-sync-forceget.js v1.0 starting...');
    await dbLog('start', 'info', 'Script starting');

    // ⚠️ Keep headless: false until stable (Tim wants to watch)
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await login(page);
    const products = await scrapeInventory(page);

    const result = {
      warehouse: 'forceget',
      run_id: RUN_ID,
      timestamp: new Date().toISOString(),
      products,
      total_units: products.reduce((s, r) => s + r.units_on_hand, 0),
      product_count: products.length,
    };

    // Write full result to Browser_Tasks
    await updateTaskResult(result);

    // Also print summary to stdout (executor captures this)
    console.log('\n✅ RESULT SUMMARY:');
    console.log(`   Products found: ${products.length}`);
    console.log(`   Total units: ${result.total_units}`);
    for (const p of products) {
      console.log(`   ${p.product_name} @ ${p.region}: ${p.units_on_hand}`);
    }

    await dbLog('complete', 'success', `Finished: ${products.length} products, ${result.total_units} units`);
    await dbShot(page, 'complete', 'Final state');

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    await dbLog('fatal', 'error', `${err.message}\n${err.stack}`);
    
    // Still try to write error result
    await updateTaskResult({
      warehouse: 'forceget',
      run_id: RUN_ID,
      error: err.message,
      products: [],
      total_units: 0,
    });
  } finally {
    if (browser) await browser.close();
    // Give logs time to flush
    await new Promise(r => setTimeout(r, 2000));
  }
})();
