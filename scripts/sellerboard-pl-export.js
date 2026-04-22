// Sellerboard P&L Export v9.2
// FIX: SPA overrides URL params after account switch
// Solution: navigate to about:blank first to force fresh state
// + HTML body logging for self-debugging
// + JPEG screenshots (smaller, fits in 50KB DB limit)
require('dotenv').config();

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// --- CONFIG ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_STATE = path.join(__dirname, 'sellerboard-storage-state.json');
const RUN_ID = `sb-${Date.now()}`;

if (SUPABASE_KEY) {
  console.log(`🔑 Supabase key geladen (${SUPABASE_KEY.substring(0, 10)}...)`);
} else {
  console.log('⚠️ Geen SUPABASE_KEY — debug logging uitgeschakeld');
}

// Market config
const MARKET_CONFIG = {
  'Amazon.de':     { account: 'eu', urlParam: 'Amazon.de' },
  'Amazon.co.uk':  { account: 'eu', urlParam: 'Amazon.co.uk' },
  'Amazon.fr':     { account: 'eu', urlParam: 'Amazon.fr' },
  'Amazon.it':     { account: 'eu', urlParam: 'Amazon.it' },
  'Amazon.es':     { account: 'eu', urlParam: 'Amazon.es' },
  'Amazon.nl':     { account: 'eu', urlParam: 'Amazon.nl' },
  'Amazon.com':    { account: 'us', urlParam: 'Amazon.com' },
  'Amazon.ca':     { account: 'us', urlParam: 'Amazon.ca' }
};

const EU_MARKETS = ['Amazon.de', 'Amazon.co.uk', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl'];
const US_MARKETS = ['Amazon.com', 'Amazon.ca'];
const ALL_MARKETS = [...EU_MARKETS, ...US_MARKETS];

const P_AND_L_METRICS = [
  'sales', 'units', 'refunds', 'promo', 'advertising', 'shipping',
  'amazon fees', 'cost of goods', 'gross profit', 'net profit',
  'refund cost', 'other', 'roi', 'margin', 'fba', 'commission',
  'variable expenses', 'fixed expenses', 'indirect expenses',
  'money back', 'storage fees', 'disposal', 'returns processing'
];

// --- HELPERS ---
function buildUrl(market, groupBy = null) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  
  const params = new URLSearchParams();
  params.set('viewType', 'table');
  params.set('tablePeriod[start]', Math.floor(start.getTime() / 1000).toString());
  params.set('tablePeriod[end]', Math.floor(end.getTime() / 1000).toString());
  params.set('tablePeriod[forecast]', 'false');
  params.set('tableSorting[field]', 'margin');
  params.set('tableSorting[direction]', 'desc');
  params.set('market[]', market);
  
  if (groupBy) params.set('groupBy', groupBy);
  
  return `https://app.sellerboard.com/en/dashboard/?${params.toString()}`;
}

// Debug: screenshot (JPEG, 40% quality to fit in 50KB) + message to Supabase
async function debugLog(page, step, message, takeScreenshot = true) {
  console.log(`      ${message}`);
  
  let screenshotBase64 = null;
  if (takeScreenshot && page) {
    try {
      const dir = path.join(__dirname, 'debug-screenshots');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Use JPEG at 40% quality — smaller, fits in DB
      const file = path.join(dir, `sb-${step}-${Date.now()}.jpg`);
      const buffer = await page.screenshot({ path: file, fullPage: false, type: 'jpeg', quality: 40 });
      screenshotBase64 = buffer.toString('base64');
      console.log(`      📸 ${path.basename(file)} (${Math.round(screenshotBase64.length / 1024)}KB b64)`);
    } catch (e) { /* ignore */ }
  }
  
  // Write to Supabase debug log
  if (SUPABASE_KEY) {
    fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Debug_Log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        run_id: RUN_ID,
        step,
        message: message.substring(0, 2000),
        screenshot: screenshotBase64,
        created_at: new Date().toISOString()
      })
    }).catch(() => {});
  }
}

// Log HTML body content when table not found (for self-debugging)
async function logPageInfo(page, step) {
  try {
    const info = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        tableCount: document.querySelectorAll('table').length,
        gridCount: document.querySelectorAll('[role="grid"]').length,
        divTableCount: document.querySelectorAll('.ag-root, .handsontable, [class*="table"]').length,
        bodyText: document.body?.innerText?.substring(0, 1500) || '(empty)',
        bodyHtml: document.body?.innerHTML?.substring(0, 2000) || '(empty)'
      };
    });
    
    const msg = `📋 Page info — URL: ${info.url}\n` +
      `Title: ${info.title}\n` +
      `Tables: ${info.tableCount}, Grids: ${info.gridCount}, DivTables: ${info.divTableCount}\n` +
      `Body text (first 1500): ${info.bodyText}`;
    
    await debugLog(page, `page-info-${step}`, msg, false);
    
    // Also log HTML separately
    if (SUPABASE_KEY) {
      fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Debug_Log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
          run_id: RUN_ID,
          step: `html-${step}`,
          message: `HTML body (first 2000): ${info.bodyHtml}`,
          created_at: new Date().toISOString()
        })
      }).catch(() => {});
    }
    
    return info;
  } catch (e) {
    console.log(`      ⚠️ Kon page info niet ophalen: ${e.message}`);
    return null;
  }
}

// CRITICAL FIX: Force fresh navigation (bypass SPA state)
// After account switch, SPA overrides URL params with saved state.
// Solution: navigate to about:blank first, then to target URL.
async function freshNavigate(page, url, label) {
  console.log(`      🌐 Fresh navigate: ${url.substring(0, 80)}...`);
  
  // Step 1: Go to blank page to clear SPA state
  await page.goto('about:blank');
  await page.waitForTimeout(500);
  
  // Step 2: Navigate to actual target
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  
  // Step 3: Check if URL matches what we expected
  const currentUrl = page.url();
  if (currentUrl !== url) {
    console.log(`      ⚠️ URL mismatch! Expected params may have been overridden by SPA`);
    console.log(`      Expected: ${url.substring(0, 80)}...`);
    console.log(`      Got:      ${currentUrl.substring(0, 80)}...`);
    
    // Try reload to force our URL
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    
    const afterReload = page.url();
    console.log(`      After reload: ${afterReload.substring(0, 80)}...`);
  }
  
  await debugLog(page, `navigated-${label}`, `Navigatie compleet. URL: ${page.url()}`);
}

async function switchAccount(page, targetAccount) {
  const targetName = targetAccount === 'us' ? 'AMZ USA' : 'Tim@qualico.be';
  await debugLog(page, 'account-switch-start', `🔄 Switchen naar ${targetAccount} (${targetName})...`);
  
  try {
    let clicked = false;
    for (const text of ['Tim@qualico.be', 'tim@qualico.be', 'AMZ USA', 'AMZ usa']) {
      try {
        const el = page.locator(`text="${text}"`).first();
        const box = await el.boundingBox({ timeout: 2000 });
        if (box && box.y < 80) {
          await el.click({ timeout: 3000 });
          clicked = true;
          console.log(`      ✅ Klikte op: ${text}`);
          break;
        }
      } catch (e) { /* try next */ }
    }
    
    if (!clicked) {
      const vp = page.viewportSize();
      await page.mouse.click(vp.width - 60, 35);
      clicked = true;
      console.log(`      ✅ Klikte op avatar positie`);
    }
    
    await page.waitForTimeout(2000);
    await debugLog(page, 'account-dropdown-open', '📋 Account dropdown geopend');
    
    let switched = false;
    try {
      await page.locator(`text="${targetName}"`).first().click({ timeout: 3000 });
      switched = true;
      console.log(`      ✅ Geswitcht naar: ${targetName}`);
    } catch (e) {
      const found = await page.evaluate((name) => {
        const items = document.querySelectorAll('li, div[role="menuitem"], a, button, span');
        for (const item of items) {
          if (item.innerText?.trim()?.includes(name)) {
            item.click();
            return true;
          }
        }
        return false;
      }, targetName);
      if (found) {
        switched = true;
        console.log(`      ✅ Geswitcht via evaluate: ${targetName}`);
      }
    }
    
    if (!switched) {
      await debugLog(page, 'account-switch-failed', `❌ Account "${targetName}" niet gevonden`);
      return false;
    }
    
    // Wait for account switch to fully complete
    await page.waitForTimeout(8000);
    await debugLog(page, 'account-switch-done', `✅ Account switch compleet. URL: ${page.url()}`);
    return true;
    
  } catch (err) {
    await debugLog(page, 'account-switch-error', `❌ Error: ${err.message}`);
    return false;
  }
}

async function scrapeMainPlTable(page) {
  try {
    await page.evaluate(() => {
      const expandables = document.querySelectorAll('[class*="expand"], [class*="collapse"], [class*="toggle"], tr[class*="parent"]');
      expandables.forEach(el => {
        const text = el.innerText?.toLowerCase() || '';
        if (text.includes('fee') || text.includes('amazon') || text.includes('advertising')) {
          el.click();
        }
      });
    });
    await page.waitForTimeout(1000);
  } catch (e) { /* ignore */ }
  
  const data = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    let bestTable = null;
    let bestRows = 0;
    
    tables.forEach(t => {
      const rows = t.querySelectorAll('tr');
      if (rows.length > bestRows) {
        bestRows = rows.length;
        bestTable = t;
      }
    });
    
    if (!bestTable) return null;
    
    const rows = bestTable.querySelectorAll('tr');
    const result = [];
    for (const row of rows) {
      const cells = row.querySelectorAll('th, td');
      const rowData = [];
      for (const cell of cells) {
        rowData.push(cell.innerText?.split('\n')[0]?.trim() || '');
      }
      if (rowData.some(c => c)) result.push(rowData);
    }
    return result;
  });
  
  if (!data || data.length === 0) return null;
  return { headers: data[0], rows: data.slice(1) };
}

async function scrapePerAsinTable(page) {
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  
  for (let attempt = 1; attempt <= 6; attempt++) {
    console.log(`      🔍 Per-ASIN detectie (poging ${attempt}/6)...`);
    
    const result = await page.evaluate(({ plMetrics }) => {
      const tables = document.querySelectorAll('table');
      const asinPattern = /^B0[A-Z0-9]{8,}$/;
      let debugInfo = `${tables.length} tables.`;
      let bestTable = null;
      let bestScore = 0;
      
      tables.forEach((t, idx) => {
        const rows = t.querySelectorAll('tr');
        let asinCount = 0, productCount = 0, plCount = 0, totalRows = 0;
        
        rows.forEach(row => {
          const firstCell = row.querySelector('td, th');
          if (!firstCell) return;
          const text = firstCell.innerText?.split('\n')[0]?.trim().toLowerCase() || '';
          totalRows++;
          if (asinPattern.test(text.toUpperCase())) asinCount++;
          if (plMetrics.some(m => text.includes(m))) plCount++;
          else if (text.length > 2 && !text.startsWith('€') && !text.startsWith('-') && isNaN(text)) productCount++;
        });
        
        debugInfo += ` T${idx}:${totalRows}r,${asinCount}a;`;
        let score = asinCount * 10 + productCount * 2 - plCount * 3;
        if (score > bestScore && asinCount > 0) { bestScore = score; bestTable = t; }
      });
      
      if (!bestTable) {
        tables.forEach(t => {
          const headerRow = t.querySelector('tr');
          if (!headerRow) return;
          const headerText = headerRow.innerText?.toLowerCase() || '';
          if ((headerText.includes('asin') || headerText.includes('product')) && t.querySelectorAll('tr').length > 2) {
            bestTable = t;
          }
        });
      }
      
      if (!bestTable) return { found: false, debug: debugInfo };
      
      const rows = bestTable.querySelectorAll('tr');
      const data = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        const rowData = [];
        for (const cell of cells) { rowData.push(cell.innerText?.split('\n')[0]?.trim() || ''); }
        if (rowData.some(c => c)) data.push(rowData);
      }
      
      return { found: true, data, debug: debugInfo };
    }, { plMetrics: P_AND_L_METRICS });
    
    if (result.found && result.data && result.data.length > 1) {
      const headers = result.data[0];
      const rows = result.data.slice(1);
      const firstColValues = rows.map(r => r[0]?.toLowerCase() || '');
      const plHits = firstColValues.filter(v => P_AND_L_METRICS.some(m => v.includes(m))).length;
      
      if (plHits < rows.length * 0.5) {
        console.log(`      ✅ Per-ASIN tabel gevonden! (${rows.length} producten)`);
        return { headers, rows };
      }
    }
    
    if (attempt < 6) {
      await page.waitForTimeout(5000);
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
  
  console.log(`      ⚠️ Per-ASIN tabel NIET gevonden`);
  return null;
}

async function waitForTable(page, viewType, market) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    console.log(`      ⏳ Wacht op <table> (poging ${attempt}/6)...`);
    try {
      await page.waitForSelector('table', { timeout: 8000 });
      console.log(`      ✅ <table> gevonden!`);
      await page.waitForTimeout(2000); // extra settle time
      return true;
    } catch (e) {
      if (attempt === 6) {
        // TABLE NOT FOUND — log full page info for self-debugging
        console.log(`      ❌ Geen <table> na 6 pogingen`);
        await debugLog(page, `no-table-${viewType}-${market}`, 
          `❌ Geen <table> na 6 pogingen. URL: ${page.url()}`);
        await logPageInfo(page, `${viewType}-${market}`);
        return false;
      }
      await page.waitForTimeout(3000);
    }
  }
  return false;
}

async function scrapeTable(page, viewType, market) {
  const found = await waitForTable(page, viewType, market);
  if (!found) return null;
  
  return viewType === 'per_asin' ? await scrapePerAsinTable(page) : await scrapeMainPlTable(page);
}

async function saveToSupabase(market, viewType, headers, rows) {
  if (!SUPABASE_KEY) return;
  
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Exports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        market,
        view_type: viewType,
        headers: JSON.stringify(headers),
        rows: JSON.stringify(rows),
        row_count: rows.length,
        exported_at: new Date().toISOString()
      })
    });
    
    if (resp.ok) {
      console.log(`      ✅ Supabase: ${market} / ${viewType} (${rows.length} rijen)`);
    } else {
      console.log(`      ❌ Supabase error: ${resp.status}`);
    }
  } catch (e) {
    console.log(`      ❌ Supabase fetch error: ${e.message}`);
  }
}

function saveCsv(market, viewType, headers, rows) {
  const dir = path.join(__dirname, 'csv-downloads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const safeName = market.replace('Amazon.', '').replace('.', '_').toLowerCase();
  const file = path.join(dir, `sellerboard-${safeName}-${viewType}.csv`);
  
  const escape = (v) => `"${(v || '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  fs.writeFileSync(file, csv, 'utf8');
  console.log(`      ✅ CSV: ${path.basename(file)}`);
}

// --- MAIN ---
async function main() {
  const args = process.argv.slice(2);
  let marketsToScrape = [];
  
  if (args.length === 0 || args[0] === 'eu') {
    marketsToScrape = EU_MARKETS;
  } else if (args[0] === 'us') {
    marketsToScrape = US_MARKETS;
  } else if (args[0] === 'all') {
    marketsToScrape = ALL_MARKETS;
  } else {
    const market = args[0];
    if (MARKET_CONFIG[market]) {
      marketsToScrape = [market];
    } else {
      console.log(`❌ Onbekende markt: ${market}`);
      console.log(`Beschikbaar: ${ALL_MARKETS.join(', ')}`);
      process.exit(1);
    }
  }
  
  console.log(`📊 Sellerboard P&L Export v9.2`);
  console.log(`   Markten: ${marketsToScrape.join(', ')}`);
  console.log(`   Run ID: ${RUN_ID}`);
  console.log(`   Fix: about:blank before navigation (bypass SPA state)`);
  console.log('');
  
  if (!fs.existsSync(STORAGE_STATE)) {
    console.log(`❌ Geen cookies: ${STORAGE_STATE}`);
    console.log('   Run eerst: node sellerboard-save-cookies.js');
    process.exit(1);
  }
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  
  let currentAccount = 'eu';
  const summary = {};
  
  try {
    for (let i = 0; i < marketsToScrape.length; i++) {
      const market = marketsToScrape[i];
      const config = MARKET_CONFIG[market];
      
      console.log(`\n📍 [${i + 1}/${marketsToScrape.length}] ${market}`);
      console.log('============================================================');
      
      // Step 1: Switch account if needed
      if (config.account !== currentAccount) {
        console.log(`   🌐 Laden Sellerboard voor account switch...`);
        await page.goto('https://app.sellerboard.com/en/dashboard/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);
        await debugLog(page, `pre-switch-${market}`, '📋 Pre-switch pagina geladen');
        
        const switched = await switchAccount(page, config.account);
        if (switched) {
          currentAccount = config.account;
        } else {
          console.log(`   ⚠️ Account switch gefaald — skip ${market}`);
          summary[market] = { main: '❌ Switch', asin: '❌' };
          continue;
        }
      }
      
      // === MAIN P&L ===
      console.log(`\n   📋 Main P&L...`);
      const mainUrl = buildUrl(config.urlParam);
      
      // CRITICAL FIX v9.2: Use freshNavigate to bypass SPA state
      await freshNavigate(page, mainUrl, `main-pl-${market}`);
      
      const mainData = await scrapeTable(page, 'main_pl', market);
      if (mainData) {
        await saveToSupabase(market, 'main_pl', mainData.headers, mainData.rows);
        saveCsv(market, 'main_pl', mainData.headers, mainData.rows);
        summary[market] = { main: `${mainData.rows.length} rijen ✅` };
      } else {
        summary[market] = { main: '❌ Geen data' };
      }
      
      // === PER ASIN ===
      console.log(`\n   📋 Per ASIN...`);
      const asinUrl = buildUrl(config.urlParam, 'asin');
      
      // CRITICAL FIX v9.2: Use freshNavigate
      await freshNavigate(page, asinUrl, `per-asin-${market}`);
      
      const asinData = await scrapeTable(page, 'per_asin', market);
      if (asinData) {
        await saveToSupabase(market, 'per_asin', asinData.headers, asinData.rows);
        saveCsv(market, 'per_asin', asinData.headers, asinData.rows);
        summary[market] = { ...summary[market], asin: `${asinData.rows.length} rijen ✅` };
      } else {
        if (mainData) {
          await saveToSupabase(market, 'per_asin_fallback', mainData.headers, mainData.rows);
          summary[market] = { ...summary[market], asin: `⚠️ fallback (${mainData.rows.length} rijen)` };
        } else {
          summary[market] = { ...summary[market], asin: '❌ Geen data' };
        }
      }
    }
    
  } finally {
    await browser.close();
  }
  
  // Print summary
  console.log('\n\n============================================================');
  console.log('📊 SAMENVATTING');
  console.log('============================================================');
  for (const [market, data] of Object.entries(summary)) {
    const main = data.main?.padEnd(20) || '❌'.padEnd(20);
    const asin = data.asin || '❌';
    console.log(`   ${market.padEnd(18)} Main: ${main} |  ASIN: ${asin}`);
  }
  console.log(`\n   Supabase: Sellerboard_Exports (volledige data)`);
  console.log(`   Debug:    Sellerboard_Debug_Log (run_id: ${RUN_ID})`);
  console.log(`   CSVs:     ${path.join(__dirname, 'csv-downloads')}`);
  console.log(`\n✅ Klaar!`);
}

// Module export for executor
module.exports = async function(browser, context, page, task) {
  const args = task?.actions || [];
  if (args.length > 0) {
    process.argv = ['node', 'sellerboard-pl-export.js', ...args];
  }
  await main();
  return { success: true, run_id: RUN_ID };
};

// Direct run
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
