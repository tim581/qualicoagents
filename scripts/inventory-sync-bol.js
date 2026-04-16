/**
 * inventory-sync-bol.js  v1.0 — Scrape Bol.com LvB stock levels
 *
 * Portal: https://partner.bol.com
 * ⚠️ Bol.com partner portal login may use 2FA / SSO
 * This is a DISCOVERY script — logs page structure to understand the portal
 *
 * LvB (Logistiek via Bol.com) stock is managed by Bol.com in their warehouses.
 * We need: product name → units available at Bol warehouse
 *
 * Prerequisites: node playwright-task-executor.js on Tim's PC
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');

const SITE_URL      = 'https://partner.bol.com';
const WAREHOUSE_NAME = 'Bol.com LvB';


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


const RUN_ID = `bol_inv_${Date.now()}`;
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


async function discoverPortal(page) {
  console.log('\n🔍 Discovering Bol.com partner portal...');
  await dbLog('discover', 'info', 'Navigating to partner.bol.com...');
  
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  await dbShot(page, 'landing', 'Partner portal landing');
  await dbLog('discover', 'info', `URL: ${page.url()}`);
  
  // Check if we need to login
  if (page.url().includes('login') || page.url().includes('auth')) {
    await dbLog('discover', 'info', 'Login page detected — Tim must authenticate manually first');
    await dbShot(page, 'login-required', 'Login page');
    
    // Log the login page structure
    const loginStructure = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      forms: document.querySelectorAll('form').length,
      inputs: Array.from(document.querySelectorAll('input')).map(i => ({ type: i.type, name: i.name, id: i.id })),
      buttons: Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => b.textContent.trim()),
      links: Array.from(document.querySelectorAll('a')).map(a => ({ text: a.textContent.trim().substring(0,30), href: a.href })).filter(l => l.text).slice(0, 20),
    }));
    await dbLog('login-structure', 'info', JSON.stringify(loginStructure).substring(0, 3000));
    
    // Wait 90s for Tim to manually log in
    console.log('\n⏳ Bol.com login detected! Waiting 90s for manual login...');
    console.log('   Tim: please log in to partner.bol.com in the browser window');
    await page.waitForTimeout(90000);
    
    await dbLog('discover', 'info', `URL after wait: ${page.url()}`);
    await dbShot(page, 'after-manual-login', 'After manual login wait');
  }
  
  // ── Discover portal structure ──
  // Look for inventory/voorraad/LvB sections
  const inventoryUrls = [
    'https://partner.bol.com/retailer/inventorymanagement',
    'https://partner.bol.com/retailer/inventory',
    'https://partner.bol.com/retailer/offers',
    'https://partner.bol.com/retailer/lvb',
    'https://partner.bol.com/retailer/products',
  ];
  
  // First, map the navigation
  const navLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('nav a, .sidebar a, [class*="menu"] a, a[href*="retailer"]'))
      .map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') }))
      .filter(l => l.text.length > 0 && l.text.length < 60)
      .slice(0, 50);
  });
  await dbLog('navigation', 'info', JSON.stringify(navLinks).substring(0, 3000));
  
  // Try inventory URLs
  for (const url of inventoryUrls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);
      if (!page.url().includes('login') && !page.url().includes('auth')) {
        await dbLog('inventory-found', 'info', `Found page at: ${url}`);
        await dbShot(page, 'inventory-page', `Page: ${url}`);
        
        
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

        
        break;
      }
    } catch (e) {
      await dbLog('url-try', 'warning', `${url} failed: ${e.message}`);
    }
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

  
  // All LvB products are NL
  for (const r of results) {
    r.region = 'Europe';
    r.channel = 'LvB NL';
    r.channel_type = 'LvB';
  }
  
  return results;
}

(async () => {
  let browser;
  try {
    console.log('🚀 inventory-sync-bol.js v1.0 starting...');
    await dbLog('start', 'info', 'Script v1.0 starting (discovery mode)');
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    const products = await discoverPortal(page);

    const result = {
      warehouse: 'bol_lvb',
      run_id: RUN_ID,
      timestamp: new Date().toISOString(),
      products,
      total_units: products.reduce((s, r) => s + r.units_on_hand, 0),
      product_count: products.length,
      note: 'Discovery run — login may require manual intervention',
    };

    await updateTaskResult(result);
    console.log(`\n✅ Discovery complete. Found ${products.length} products.`);
    await dbLog('complete', 'success', `Discovery done: ${products.length} products found`);
    await dbShot(page, 'complete', 'Final state');
  } catch (err) {
    console.error('❌ Fatal:', err.message);
    await dbLog('fatal', 'error', `${err.message}\n${err.stack}`);
    await updateTaskResult({ warehouse: 'bol_lvb', run_id: RUN_ID, error: err.message, products: [], total_units: 0 });
  } finally {
    if (browser) await browser.close();
    await new Promise(r => setTimeout(r, 2000));
  }
})();
