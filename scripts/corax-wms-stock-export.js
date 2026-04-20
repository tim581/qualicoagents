/**
 * corax-wms-stock-export.js v2.0
 * 
 * Scrapes Vanthiel/Kamps Corax WMS "Stocks per artikel" page.
 * Writes results to:
 *   1. Inventory_Levels in Supabase (upsert)
 *   2. Browser_Tasks.result (summary JSON)
 * 
 * Auth: Cookie-based (run corax-wms-save-cookies.js first for initial login).
 *       Falls back to credential login if cookies expired.
 * 
 * Usage via Browser_Tasks:
 *   INSERT INTO "Browser_Tasks" (agent_name, task_type, url, actions, credentials_key, status)
 *   VALUES ('PO & TO Mgr', 'corax-stock-export', 'https://kampspijnacker.coraxwms.nl', '[]'::jsonb, 'vanthiel_corax_wms', 'pending');
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ===== CONFIG =====
const SUPABASE_URL = 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const CORAX_URL = 'https://kampspijnacker.coraxwms.nl';
const COOKIE_FILE = path.join(__dirname, 'corax-wms-storage-state.json');

// Product name mapping: Corax WMS name patterns → our standard Inventory_Levels names
// Corax uses article descriptions — we match flexibly
const PRODUCT_MAP = [
  { pattern: /1000.*gift/i,              name: 'MAT 1000 GIFT',    product_id: 16 },
  { pattern: /1500.*eco/i,               name: 'MAT 1500 ECO',     product_id: 1 },
  { pattern: /1500.*gift(?!.*tray)/i,    name: 'MAT 1500 GIFT',    product_id: 12 },
  { pattern: /1500.*lux/i,               name: 'MAT 1500 LUX',     product_id: 10 },
  { pattern: /3000.*eco/i,               name: 'MAT 3000 ECO',     product_id: 5 },
  { pattern: /3000.*gift(?!.*tray)/i,    name: 'MAT 3000 GIFT',    product_id: 4 },
  { pattern: /5000.*gift/i,              name: 'MAT 5000 GIFT',    product_id: 11 },
  { pattern: /tray.*1500.*black/i,       name: 'TRAYS 1500 BLACK', product_id: 14 },
  { pattern: /tray.*1500.*white/i,       name: 'TRAYS 1500 WHITE', product_id: 3 },
  { pattern: /tray.*3000.*black/i,       name: 'TRAYS 3000 BLACK', product_id: 15 },
  // Fallback patterns for short names used in previous kamps_wms sync
  { pattern: /^trays?\s*black$/i,        name: 'TRAYS 1500 BLACK', product_id: 14 },
  { pattern: /^trays?\s*white$/i,        name: 'TRAYS 1500 WHITE', product_id: 3 },
  { pattern: /^trays?\s*double$/i,       name: 'TRAYS 3000 BLACK', product_id: 15 },
];

function matchProduct(articleName) {
  for (const entry of PRODUCT_MAP) {
    if (entry.pattern.test(articleName)) {
      return { name: entry.name, product_id: entry.product_id };
    }
  }
  return null;
}

// Supabase REST helper
async function supabaseUpsert(table, rows, onConflict) {
  if (!SUPABASE_KEY) {
    console.log('⚠️  No SUPABASE_KEY — skipping DB write');
    return null;
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': `resolution=merge-duplicates${onConflict ? '' : ''}`
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`Supabase error (${res.status}):`, errText);
  }
  return res;
}

async function updateTaskResult(taskId, result) {
  if (!SUPABASE_KEY || !taskId) return;
  const url = `${SUPABASE_URL}/rest/v1/Browser_Tasks?id=eq.${taskId}`;
  await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ result: result, status: 'done', completed_at: new Date().toISOString() })
  });
}

// Debug screenshot helper
async function dbShot(page, runId, step, message) {
  if (!SUPABASE_KEY) return;
  try {
    const buf = await page.screenshot({ fullPage: false });
    const b64 = buf.toString('base64');
    const url = `${SUPABASE_URL}/rest/v1/Flieber_Debug_Log`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ run_id: runId, step, message, screenshot: b64 })
    });
    console.log(`   📸 ${step}: ${message}`);
  } catch (e) {
    console.log(`   ⚠️ Screenshot failed: ${e.message}`);
  }
}

(async () => {
  const TASK_ID = process.env.TASK_ID || '';
  const RUN_ID = `corax-${Date.now()}`;
  
  // Load cookies if available
  const hasCookies = fs.existsSync(COOKIE_FILE);
  console.log(`Cookie file: ${hasCookies ? '✅ found' : '❌ not found'}`);
  
  const launchOpts = {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  };
  
  const contextOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true
  };
  
  if (hasCookies) {
    contextOpts.storageState = COOKIE_FILE;
  }
  
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  try {
    // ===== STEP 1: Navigate & check auth =====
    console.log('1/5 Opening Corax WMS...');
    await page.goto(`${CORAX_URL}/#/Dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await dbShot(page, RUN_ID, 'after-nav', 'Initial page load');

    const url = page.url();
    if (url.includes('login') || url.includes('Login')) {
      console.log('⚠️  Cookies expired — attempting credential login...');
      
      // Try login with credentials from env (set by executor from Browser_Credentials)
      const username = process.env.CORAX_USERNAME || '';
      const password = process.env.CORAX_PASSWORD || '';
      
      if (!username || !password) {
        console.log('❌ No credentials available. Run corax-wms-save-cookies.js first.');
        await dbShot(page, RUN_ID, 'login-fail', 'No credentials, cookies expired');
        await browser.close();
        process.exit(1);
      }
      
      // Fill login form
      console.log('   Filling credentials...');
      await page.fill('input[type="email"], input[name="email"], input[name="username"], #username, #email', username);
      await page.fill('input[type="password"], input[name="password"], #password', password);
      await dbShot(page, RUN_ID, 'login-filled', 'Credentials filled');
      
      // Submit
      await page.click('button[type="submit"], input[type="submit"], text=Login, text=Inloggen');
      await page.waitForTimeout(5000);
      await dbShot(page, RUN_ID, 'after-login', 'After login submit');
      
      // Check if MFA required
      const pageText = await page.textContent('body');
      if (pageText.includes('verificatie') || pageText.includes('MFA') || pageText.includes('2FA') || pageText.includes('code')) {
        console.log('❌ MFA required — cannot proceed automatically.');
        console.log('   Run corax-wms-save-cookies.js manually to complete MFA + save cookies.');
        await dbShot(page, RUN_ID, 'mfa-required', 'MFA screen detected');
        await browser.close();
        process.exit(1);
      }
      
      // Check if login succeeded
      const newUrl = page.url();
      if (newUrl.includes('login') || newUrl.includes('Login')) {
        console.log('❌ Login failed.');
        await dbShot(page, RUN_ID, 'login-failed', 'Still on login page');
        await browser.close();
        process.exit(1);
      }
      
      // Save cookies for next time
      const storage = await context.storageState();
      fs.writeFileSync(COOKIE_FILE, JSON.stringify(storage, null, 2));
      console.log('   ✅ Login successful! Cookies saved.');
    } else {
      console.log('   ✅ Authenticated via cookies');
    }

    // ===== STEP 2: Navigate to Stocks per artikel =====
    console.log('2/5 Navigating to Stocks per artikel...');
    await page.click('text=Voorraad');
    await page.waitForTimeout(1500);
    await page.click('text=Stocks per artikel');
    await page.waitForTimeout(4000);
    await dbShot(page, RUN_ID, 'stocks-page', 'Stocks per artikel loaded');

    // ===== STEP 3: Scrape ALL pages =====
    console.log('3/5 Scraping stock data...');
    
    let allRows = [];
    let headers = [];
    let pageNum = 1;
    
    while (true) {
      console.log(`   Page ${pageNum}...`);
      
      // Get headers on first page
      if (pageNum === 1) {
        headers = await page.evaluate(() => {
          const table = document.querySelector('table');
          if (!table) return [];
          return Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
        });
        console.log(`   Headers: ${headers.join(' | ')}`);
      }
      
      const rows = await page.evaluate(() => {
        const table = document.querySelector('table');
        if (!table) return [];
        const ths = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
        const data = [];
        table.querySelectorAll('tbody tr').forEach(tr => {
          const cells = tr.querySelectorAll('td');
          const row = {};
          cells.forEach((cell, i) => {
            row[ths[i] || `col_${i}`] = cell.innerText.trim();
          });
          if (Object.keys(row).length > 0) data.push(row);
        });
        return data;
      });
      
      allRows = allRows.concat(rows);
      console.log(`   ${rows.length} rows found`);
      
      // Check for next page
      const nextBtn = await page.$('.pagination-next:not(.disabled), text=›');
      if (!nextBtn) break;
      const isDisabled = await nextBtn.evaluate(el => 
        el.closest('li')?.classList.contains('disabled') || el.disabled || el.getAttribute('aria-disabled') === 'true'
      );
      if (isDisabled) break;
      await nextBtn.click();
      await page.waitForTimeout(2000);
      pageNum++;
    }
    
    console.log(`\n   TOTAL: ${allRows.length} articles over ${pageNum} page(s)`);
    await dbShot(page, RUN_ID, 'scrape-done', `${allRows.length} articles scraped`);

    // ===== STEP 4: Map to products & write to Inventory_Levels =====
    console.log('4/5 Mapping products & writing to Supabase...');
    
    // Save raw data locally for debugging
    fs.writeFileSync(path.join(__dirname, 'corax-stock-data.json'), JSON.stringify(allRows, null, 2));
    
    const now = new Date().toISOString();
    const inventoryRows = [];
    const unmapped = [];
    
    for (const row of allRows) {
      // Try to find article name — could be in different columns
      const articleName = row['Artikel'] || row['Artikelnummer'] || row['Article'] || row['Omschrijving'] || row['Description'] || Object.values(row)[0] || '';
      const stockStr = row['Voorraad'] || row['Stock'] || row['Beschikbaar'] || row['Available'] || row['Vrij'] || '';
      const stock = parseInt(String(stockStr).replace(/[^0-9-]/g, ''), 10) || 0;
      
      const match = matchProduct(articleName);
      
      if (match) {
        inventoryRows.push({
          channel: '3PL EU',
          warehouse: 'Van Thiel/Kamps',
          region: 'EU',
          product_name: match.name,
          on_hand: stock,
          source: 'corax_wms_v2',
          last_synced_at: now
        });
        console.log(`   ✅ ${articleName} → ${match.name}: ${stock}`);
      } else if (articleName) {
        unmapped.push({ article: articleName, stock });
        console.log(`   ❓ ${articleName}: ${stock} (unmapped)`);
      }
    }
    
    // Upsert to Inventory_Levels
    if (inventoryRows.length > 0 && SUPABASE_KEY) {
      console.log(`\n   Writing ${inventoryRows.length} products to Inventory_Levels...`);
      
      // Upsert one by one (channel + product_name is our unique key)
      for (const row of inventoryRows) {
        const url = `${SUPABASE_URL}/rest/v1/Inventory_Levels?channel=eq.${encodeURIComponent(row.channel)}&product_name=eq.${encodeURIComponent(row.product_name)}`;
        
        // Check if exists
        const checkRes = await fetch(url, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const existing = await checkRes.json();
        
        if (existing.length > 0) {
          // Update
          await fetch(url, {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ on_hand: row.on_hand, source: row.source, last_synced_at: row.last_synced_at })
          });
        } else {
          // Insert
          await fetch(`${SUPABASE_URL}/rest/v1/Inventory_Levels`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(row)
          });
        }
      }
      console.log('   ✅ Inventory_Levels updated!');
    }

    // ===== STEP 5: Summary =====
    console.log('5/5 Summary...');
    
    const summary = {
      timestamp: now,
      source: 'corax_wms_v2',
      articles_scraped: allRows.length,
      products_mapped: inventoryRows.length,
      unmapped_articles: unmapped,
      headers_found: headers,
      inventory: inventoryRows.map(r => ({ product: r.product_name, on_hand: r.on_hand })),
      raw_data: allRows
    };
    
    // Update Browser_Tasks result
    if (TASK_ID) {
      await updateTaskResult(TASK_ID, summary);
      console.log('   ✅ Browser_Tasks result updated');
    }
    
    // Print summary
    console.log('\n===== VANTHIEL STOCK SUMMARY =====');
    inventoryRows.forEach(r => console.log(`  ${r.product_name.padEnd(20)} ${r.on_hand}`));
    if (unmapped.length > 0) {
      console.log('\n  UNMAPPED:');
      unmapped.forEach(u => console.log(`  ❓ ${u.article}: ${u.stock}`));
    }
    console.log('==================================\n');
    
    // Save updated cookies
    const storage = await context.storageState();
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(storage, null, 2));
    console.log('Cookies refreshed ✅');
    
    console.log('DONE!');

  } catch (err) {
    console.error('FOUT:', err.message);
    await dbShot(page, RUN_ID, 'error', err.message);
    
    if (TASK_ID) {
      await updateTaskResult(TASK_ID, { error: err.message });
    }
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
})();
