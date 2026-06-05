// Sellerboard P&L Export v10 — 2026 monthly P&L per market
// Scrapes main P&L table → filters 2026 month columns → upserts monthly_pl to Supabase
// Skips per-ASIN. June (and current month) may be partial.

// CRITICAL: Load .env FIRST so SUPABASE_KEY is available
try { require('dotenv').config(); } catch (e) { /* dotenv not installed — use hardcoded fallback */ }

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// --- CONFIG ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const STORAGE_STATE = path.join(__dirname, 'sellerboard-storage-state.json');
const RUN_ID = `sb-${Date.now()}`;

// Verify key is loaded
if (SUPABASE_KEY) {
  console.log(`🔑 Supabase key geladen (${SUPABASE_KEY.substring(0, 20)}...)`);
} else {
  console.log(`⚠️ Geen Supabase key — debug logging uitgeschakeld`);
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

const EXPORT_YEAR = 2026;
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// --- HELPERS ---
function buildUrl(market) {
  const now = new Date();
  const start = new Date(EXPORT_YEAR, 0, 1);
  const endYear = now.getFullYear() >= EXPORT_YEAR ? now.getFullYear() : EXPORT_YEAR;
  const endMonth = now.getFullYear() === EXPORT_YEAR ? now.getMonth() + 1 : 12;
  const end = new Date(endYear, endMonth, 1);

  const params = new URLSearchParams();
  params.set('viewType', 'table');
  params.set('tablePeriod[start]', Math.floor(start.getTime() / 1000).toString());
  params.set('tablePeriod[end]', Math.floor(end.getTime() / 1000).toString());
  params.set('tablePeriod[forecast]', 'false');
  params.set('tableSorting[field]', 'margin');
  params.set('tableSorting[direction]', 'desc');
  params.set('market[]', market);

  return `https://app.sellerboard.com/en/dashboard/?${params.toString()}`;
}

async function freshNavigate(page, url, label) {
  console.log(`      🌐 Navigate: ${url.substring(0, 90)}...`);
  await page.goto('about:blank');
  await page.waitForTimeout(500);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  const currentUrl = page.url();
  if (!currentUrl.includes('market')) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }
  await debugLog(page, label, `Pagina geladen: ${currentUrl.substring(0, 80)}...`);
}

function monthIndexFromName(name) {
  const n = (name || '').toLowerCase().trim();
  return MONTH_NAMES.findIndex(m => n === m || n.startsWith(`${m} `));
}

function monthKeyFromHeader(header) {
  const h = (header || '').trim();
  if (!h || /^parameter/i.test(h) || /^total$/i.test(h)) return null;

  const partial = h.match(/^(\d+-\d+)\s+(\w+)\s+(20\d{2})$/i);
  if (partial) {
    const idx = monthIndexFromName(partial[2]);
    if (idx < 0 || partial[3] !== String(EXPORT_YEAR)) return null;
    return { index: idx, key: `${MONTH_ABBR[idx]}_${EXPORT_YEAR}_partial`, partial: true };
  }

  if (h.includes(String(EXPORT_YEAR))) {
    const idx = monthIndexFromName(h.replace(/\d{4}/g, '').trim());
    if (idx >= 0) return { index: idx, key: `${MONTH_ABBR[idx]}_${EXPORT_YEAR}` };
    const abbr = MONTH_ABBR.find(a => h.toLowerCase().includes(a.toLowerCase()));
    if (abbr) return { index: MONTH_ABBR.indexOf(abbr), key: `${abbr}_${EXPORT_YEAR}` };
  }

  const idx = monthIndexFromName(h);
  if (idx >= 0) return { index: idx, key: `${MONTH_ABBR[idx]}_${EXPORT_YEAR}` };

  return null;
}

function extractMonthly2026(headers, rows) {
  const keep = [{ col: 0, key: 'Parameter' }];
  let seenJanuary = false;

  for (let i = 1; i < headers.length; i++) {
    const h = (headers[i] || '').trim();
    if (/^total$/i.test(h)) break;

    const parsed = monthKeyFromHeader(h);
    if (!parsed) continue;

    if (/\d{4}/.test(h) && !h.includes(String(EXPORT_YEAR))) break;

    if (!h.includes(String(EXPORT_YEAR))) {
      if (seenJanuary && parsed.index === 11) break;
      if (parsed.index === 0) seenJanuary = true;
    }

    keep.push({ col: i, key: parsed.key });
  }

  const dataCols = keep.slice(1).sort((a, b) => {
    const order = k => {
      const m = k.match(/^(\w+)_/);
      const idx = MONTH_ABBR.indexOf(m?.[1] || '');
      return idx < 0 ? 99 : idx + (k.includes('_partial') ? 0.4 : 0);
    };
    return order(a.key) - order(b.key);
  });

  const newHeaders = ['Parameter', ...dataCols.map(c => c.key)];
  const newRows = rows.map(row => [
    row[0] ?? '',
    ...dataCols.map(c => row[c.col] ?? ''),
  ]);

  return { headers: newHeaders, rows: newRows, months: dataCols.map(c => c.key) };
}

// Debug: screenshot to local + Supabase
async function debugLog(page, step, message, takeScreenshot = true) {
  console.log(`      ${message}`);
  
  let screenshotBase64 = null;
  if (takeScreenshot && page) {
    try {
      const dir = path.join(__dirname, 'debug-screenshots');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `sb-${step}-${Date.now()}.png`);
      const buffer = await page.screenshot({ path: file, fullPage: false });
      screenshotBase64 = buffer.toString('base64').substring(0, 50000); // cap at 50KB for Supabase
      console.log(`      📸 ${path.basename(file)}`);
    } catch (e) { console.log(`      ⚠️ Screenshot failed: ${e.message}`); }
  }
  
  // Write to Supabase debug log
  if (SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Debug_Log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
          run_id: RUN_ID,
          step,
          message,
          screenshot: screenshotBase64,
          created_at: new Date().toISOString()
        })
      });
    } catch (e) { /* fire and forget */ }
  }
}

async function switchAccount(page, targetAccount) {
  const targetName = targetAccount === 'us' ? 'AMZ USA' : 'Tim@qualico.be';
  await debugLog(page, 'account-switch-start', `🔄 Switchen naar ${targetAccount} (${targetName})...`);
  
  try {
    // Click avatar/account button in top navigation bar
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
    
    // Fallback: top-right avatar position
    if (!clicked) {
      const vp = page.viewportSize();
      await page.mouse.click(vp.width - 60, 35);
      clicked = true;
      console.log(`      ✅ Klikte op avatar positie`);
    }
    
    await page.waitForTimeout(2000);
    await debugLog(page, 'account-dropdown-open', '📋 Account dropdown geopend');
    
    // Click target account
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
    
    // Wait for account switch to complete (page redirects + session update)
    await page.waitForTimeout(8000);
    
    // Log the current URL to verify we're on the right account
    const currentUrl = page.url();
    await debugLog(page, 'account-switch-done', `✅ Account switch compleet. URL: ${currentUrl}`);
    return true;
    
  } catch (err) {
    await debugLog(page, 'account-switch-error', `❌ Error: ${err.message}`);
    return false;
  }
}

// Enhanced table detection: supports both <table> and div-based grids
async function findTableData(page) {
  return await page.evaluate(() => {
    // Strategy 1: Regular <table> elements
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
    
    if (bestTable && bestRows > 5) {
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
      return { source: 'table', tableCount: tables.length, data: result };
    }
    
    // Strategy 2: Look for div-based grids (modern React dashboards)
    // Find containers with many rows of similarly-structured divs
    const gridContainers = document.querySelectorAll('[class*="table"], [class*="grid"], [class*="row"], [role="table"], [role="grid"]');
    
    return { source: 'none', tableCount: tables.length, gridCount: gridContainers.length, bestRows, data: null };
  });
}

async function scrapeMainPlTable(page) {
  // Try expanding fee rows
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
  
  const result = await findTableData(page);
  
  if (!result.data || result.data.length === 0) {
    console.log(`      ℹ️ Table info: ${result.tableCount} tables, ${result.gridCount || 0} grids, best: ${result.bestRows || 0} rows`);
    return null;
  }
  
  return { headers: result.data[0], rows: result.data.slice(1) };
}

async function ensurePlView(page) {
  try {
    const plTab = page.locator('a, button, [role="tab"]').filter({ hasText: /^P&L$/ }).first();
    if (await plTab.count()) {
      await plTab.click({ timeout: 3000 });
      await page.waitForTimeout(3000);
    }
  } catch {
    /* already on P&L or tab not found */
  }
}

async function scrapeTable(page, viewType, market) {
  await ensurePlView(page);

  // Enhanced retry with debug logging (attached tables — Sellerboard hides many <table> nodes)
  for (let attempt = 1; attempt <= 6; attempt++) {
    console.log(`      ⏳ Wacht op data (poging ${attempt}/6)...`);
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('table').length > 0,
        { timeout: 10000 }
      );
      break;
    } catch (e) {
      if (attempt === 3) await ensurePlView(page);
      if (attempt === 6) {
        // Take debug screenshot before giving up
        await debugLog(page, `no-table-${viewType}-${market}`, `❌ Geen <table> na 6 pogingen. URL: ${page.url()}`);
        
        // Log what IS on the page
        const pageInfo = await page.evaluate(() => ({
          title: document.title,
          url: window.location.href,
          tableCount: document.querySelectorAll('table').length,
          bodyText: document.body?.innerText?.substring(0, 500) || 'empty'
        }));
        console.log(`      ℹ️ Page: ${pageInfo.title}, Tables: ${pageInfo.tableCount}`);
        console.log(`      ℹ️ URL: ${pageInfo.url}`);
        console.log(`      ℹ️ Body preview: ${pageInfo.bodyText.substring(0, 200)}...`);
        
        return null;
      }
      await page.waitForTimeout(5000);
    }
  }
  
  await page.waitForTimeout(3000);
  await debugLog(page, `table-found-${viewType}-${market}`, `✅ Table gevonden voor ${viewType} ${market}`, true);
  
  return await scrapeMainPlTable(page);
}

async function saveToSupabase(market, viewType, headers, rows) {
  if (!SUPABASE_KEY) {
    console.log(`      ⚠️ Skip Supabase save (geen key)`);
    return false;
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };

  const payload = {
    headers: JSON.stringify(headers),
    rows: JSON.stringify(rows),
    row_count: rows.length,
    exported_at: new Date().toISOString(),
  };

  const filter = `market=eq.${encodeURIComponent(market)}&view_type=eq.${encodeURIComponent(viewType)}`;

  try {
    const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Exports?${filter}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    if (patchResp.ok) {
      const updated = await patchResp.json();
      if (Array.isArray(updated) && updated.length > 0) {
        console.log(`      ✅ Supabase updated: ${market} / ${viewType} (${rows.length} rijen)`);
        return true;
      }
    }

    const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Exports`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ market, view_type: viewType, ...payload }),
    });

    if (insertResp.ok) {
      console.log(`      ✅ Supabase inserted: ${market} / ${viewType} (${rows.length} rijen)`);
      return true;
    }

    const body = await insertResp.text();
    console.log(`      ❌ Supabase error: ${insertResp.status} ${body.substring(0, 200)}`);
    return false;
  } catch (e) {
    console.log(`      ❌ Supabase fetch error: ${e.message}`);
    return false;
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
  
  console.log(`📊 Sellerboard P&L Export v10 — ${EXPORT_YEAR} monthly`);
  console.log(`   Markten: ${marketsToScrape.join(', ')}`);
  console.log(`   View: monthly_pl (per-ASIN overgeslagen)`);
  console.log(`   Run ID: ${RUN_ID}`);
  console.log(`   Debug: ${SUPABASE_KEY ? 'Supabase logging AAN' : 'GEEN logging (geen key)'}`);
  console.log('');
  
  if (!fs.existsSync(STORAGE_STATE)) {
    console.log(`❌ Geen cookies: ${STORAGE_STATE}`);
    console.log('   Run eerst: node sellerboard-save-cookies.js');
    process.exit(1);
  }
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  page.setDefaultTimeout(20000); // increased from 15s
  
  let currentAccount = 'eu'; // Default after cookie load
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
        await debugLog(page, `pre-switch-${market}`, `📋 Pre-switch pagina geladen`);
        
        const switched = await switchAccount(page, config.account);
        if (switched) {
          currentAccount = config.account;
        } else {
          console.log(`   ⚠️ Account switch gefaald — skip ${market}`);
          summary[market] = '❌ Account switch';
          continue;
        }
      }

      console.log(`\n   📋 ${EXPORT_YEAR} Monthly P&L...`);
      const mainUrl = buildUrl(config.urlParam);
      await freshNavigate(page, mainUrl, `monthly-pl-${market}`);

      const mainData = await scrapeTable(page, 'main_pl', market);
      if (!mainData) {
        summary[market] = '❌ Geen data';
        continue;
      }

      const monthly = extractMonthly2026(mainData.headers, mainData.rows);
      console.log(`      📅 Maanden: ${monthly.months.join(', ')}`);

      await saveToSupabase(market, 'monthly_pl', monthly.headers, monthly.rows);
      saveCsv(market, 'monthly_pl', monthly.headers, monthly.rows);
      summary[market] = `${monthly.rows.length} metrics × ${monthly.months.length} months ✅`;
    }
    
  } finally {
    await browser.close();
  }
  
  // Print summary
  console.log('\n\n============================================================');
  console.log('📊 SAMENVATTING');
  console.log('============================================================');
  for (const [market, data] of Object.entries(summary)) {
    console.log(`   ${market.padEnd(18)} ${data}`);
  }
  console.log(`\n   Supabase: Sellerboard_Exports (view_type = monthly_pl, ${EXPORT_YEAR})`);
  console.log(`   CSVs:     ${path.join(__dirname, 'csv-downloads')}`);
  console.log(`   Debug:    ${path.join(__dirname, 'debug-screenshots')}`);
  
  // Save lightweight JSON summary
  const jsonFile = path.join(__dirname, 'sellerboard-pl-data.json');
  fs.writeFileSync(jsonFile, JSON.stringify(summary, null, 2));
  console.log(`   JSON:     ${jsonFile} (${(fs.statSync(jsonFile).size / 1024).toFixed(1)}KB — summary only)`);
  
  console.log('\n✅ Klaar!');
}

module.exports = async function (browser, context, page, task) {
  const args = task?.actions || [];
  if (args.length > 0) {
    process.argv = ['node', 'sellerboard-pl-export.js', ...args];
  }
  await main();
  return { success: true, run_id: RUN_ID };
};

if (require.main === module) {
  main().catch(err => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    process.exit(1);
  });
}
