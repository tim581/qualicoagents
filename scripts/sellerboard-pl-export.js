// Sellerboard P&L Export v8.1
// Fixes from PDF analysis: exact account switch flow, marketplace dropdown, per-ASIN detection
// PDF reference: ExportingAmazonSalesDataFromSellerboard + ExportingSellerboardAnalyticsDatatoCSV

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// --- CONFIG ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_STATE = path.join(__dirname, 'sellerboard-storage-state.json');

// Account mapping — from PDF step 4
const ACCOUNTS = {
  eu: { name: 'Tim@qualico.be', label: 'EU' },
  us: { name: 'AMZ USA', label: 'US/CA' }
};

// Market → account + marketplace display name (from PDF steps 6-8)
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
function buildDashboardUrl(market, groupBy = null) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  
  const params = new URLSearchParams();
  params.set('viewType', 'table');
  params.set('market[]', market);
  params.set('tablePeriod[start]', Math.floor(start.getTime() / 1000).toString());
  params.set('tablePeriod[end]', Math.floor(end.getTime() / 1000).toString());
  params.set('tablePeriod[forecast]', 'false');
  params.set('tableSorting[field]', 'margin');
  params.set('tableSorting[direction]', 'desc');
  
  if (groupBy) params.set('groupBy', groupBy);
  
  return `https://app.sellerboard.com/en/dashboard/?${params.toString()}`;
}

async function switchAccount(page, targetAccount) {
  console.log(`   🔄 Switchen naar ${targetAccount} account...`);
  
  // PDF Step 3: Click on the avatar/account name in top-right
  // The avatar is typically the last clickable element in the top-right nav
  try {
    // Try clicking the account name/avatar area — look for the account text
    const accountBtn = await page.evaluate(() => {
      // Look for elements containing account names
      const allElements = document.querySelectorAll('span, div, button, a');
      for (const el of allElements) {
        const text = el.innerText?.trim();
        if (text === 'Tim@qualico.be' || text === 'AMZ USA' || text === 'tim@qualico.be') {
          // Check if it's in the header/nav area (top of page)
          const rect = el.getBoundingClientRect();
          if (rect.top < 80 && rect.right > window.innerWidth - 300) {
            return { found: true, text, tag: el.tagName };
          }
        }
      }
      // Fallback: look for avatar/profile image in top-right
      const avatars = document.querySelectorAll('img[class*="avatar"], img[class*="profile"], [class*="avatar"], [class*="user-menu"]');
      for (const av of avatars) {
        const rect = av.getBoundingClientRect();
        if (rect.top < 80 && rect.right > window.innerWidth - 200) {
          return { found: true, text: 'avatar', tag: av.tagName };
        }
      }
      return { found: false };
    });
    
    console.log(`      Zoek account knop: ${JSON.stringify(accountBtn)}`);
    
    // Click on the top-right area where the account selector is
    // From PDF: it's the profile icon/name at the very top-right
    // Try multiple selectors
    let clicked = false;
    
    // Method 1: Click text matching current or target account
    for (const selector of [
      'text=Tim@qualico.be', 'text=tim@qualico.be', 
      'text=AMZ USA', 'text=AMZ usa'
    ]) {
      try {
        const el = page.locator(selector).first();
        const box = await el.boundingBox({ timeout: 2000 });
        if (box && box.y < 80) {
          await el.click({ timeout: 3000 });
          clicked = true;
          console.log(`      ✅ Klikte op: ${selector}`);
          break;
        }
      } catch (e) { /* try next */ }
    }
    
    // Method 2: Click avatar/profile area in top-right corner
    if (!clicked) {
      console.log(`      Probeer avatar klik in top-right...`);
      // PDF shows avatar is at ~95% from left, ~30px from top
      const viewport = page.viewportSize();
      const x = viewport.width - 60;
      const y = 35;
      await page.mouse.click(x, y);
      clicked = true;
      console.log(`      ✅ Klikte op positie (${x}, ${y})`);
    }
    
    await page.waitForTimeout(2000);
    
    // Take screenshot of dropdown
    await takeDebugScreenshot(page, `account-dropdown-${targetAccount}`);
    
    // PDF Step 4: Click target account in dropdown
    if (targetAccount === 'us') {
      // Look for "AMZ USA" text
      let switched = false;
      for (const text of ['AMZ USA', 'AMZ usa', 'amz usa', 'AMZ USA ']) {
        try {
          await page.locator(`text="${text}"`).first().click({ timeout: 3000 });
          switched = true;
          console.log(`      ✅ Geswitcht naar: ${text}`);
          break;
        } catch (e) { /* try next */ }
      }
      
      if (!switched) {
        // Try finding it in a list/dropdown context
        try {
          const found = await page.evaluate(() => {
            const items = document.querySelectorAll('li, div[role="menuitem"], div[role="option"], a, button, span');
            for (const item of items) {
              const t = item.innerText?.trim().toLowerCase();
              if (t && (t.includes('amz usa') || t.includes('amz us'))) {
                item.click();
                return t;
              }
            }
            return null;
          });
          if (found) {
            switched = true;
            console.log(`      ✅ Geswitcht via evaluate: ${found}`);
          }
        } catch (e) { /* */ }
      }
      
      if (!switched) {
        console.log(`      ❌ Account switch gefaald — neem screenshot`);
        await takeDebugScreenshot(page, `account-switch-failed-${targetAccount}`);
        return false;
      }
    } else {
      // Switch back to EU
      for (const text of ['Tim@qualico.be', 'tim@qualico.be']) {
        try {
          await page.locator(`text="${text}"`).first().click({ timeout: 3000 });
          console.log(`      ✅ Geswitcht naar: ${text}`);
          break;
        } catch (e) { /* try next */ }
      }
    }
    
    // Wait for account to load
    await page.waitForTimeout(5000);
    console.log(`      ✅ Account switch compleet`);
    return true;
    
  } catch (err) {
    console.log(`      ❌ Account switch error: ${err.message}`);
    await takeDebugScreenshot(page, `account-switch-error-${targetAccount}`);
    return false;
  }
}

async function takeDebugScreenshot(page, label) {
  try {
    const dir = path.join(__dirname, 'debug-screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `sellerboard-${label}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`      📸 Screenshot: ${path.basename(file)}`);
  } catch (e) { /* ignore */ }
}

async function scrapeTable(page, viewType) {
  // Wait for table to be present
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`      ⏳ Wacht op data (poging ${attempt}/3)...`);
    try {
      await page.waitForSelector('table', { timeout: 10000 });
      break;
    } catch (e) {
      if (attempt === 3) {
        console.log(`      ❌ Geen tabel gevonden na 3 pogingen`);
        return null;
      }
      await page.waitForTimeout(3000);
    }
  }
  
  await page.waitForTimeout(3000); // Extra settle time
  
  if (viewType === 'per_asin') {
    return await scrapePerAsinTable(page);
  } else {
    return await scrapeMainPlTable(page);
  }
}

async function scrapeMainPlTable(page) {
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
        // Clean HTML: take first line only, strip nested elements
        let text = cell.innerText?.split('\n')[0]?.trim() || '';
        rowData.push(text);
      }
      if (rowData.some(c => c)) result.push(rowData);
    }
    
    return result;
  });
  
  if (!data || data.length === 0) return null;
  
  const headers = data[0];
  const rows = data.slice(1);
  
  console.log(`      Rijen: ${rows.length}, Kolommen: ${headers.length}`);
  console.log(`      Headers: ${headers.slice(0, 5).join(', ')}...`);
  if (rows[0]) console.log(`      Row 0: ${rows[0].slice(0, 3).join(', ')}...`);
  
  return { headers, rows };
}

async function scrapePerAsinTable(page) {
  // Per-ASIN detection: 3-layer strategy from v7.0
  // 1. Look for ASIN patterns (B0XXXXXXXX)
  // 2. Look for product names (not P&L metric names)
  // 3. Look for "ASIN" / "Product" in headers
  
  // Scroll to trigger lazy loading
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  
  // Retry loop — ASIN table may take time to load
  for (let attempt = 1; attempt <= 6; attempt++) {
    console.log(`      🔍 Per-ASIN detectie (poging ${attempt}/6)...`);
    
    const result = await page.evaluate(({ plMetrics }) => {
      const tables = document.querySelectorAll('table');
      const asinPattern = /^B0[A-Z0-9]{8,}$/;
      let debugInfo = `${tables.length} tables found.`;
      
      let bestTable = null;
      let bestScore = 0;
      
      tables.forEach((t, idx) => {
        const rows = t.querySelectorAll('tr');
        let asinCount = 0;
        let productCount = 0;
        let plCount = 0;
        let totalRows = 0;
        
        rows.forEach(row => {
          const firstCell = row.querySelector('td, th');
          if (!firstCell) return;
          const text = firstCell.innerText?.split('\n')[0]?.trim().toLowerCase() || '';
          totalRows++;
          
          // Check ASIN pattern
          if (asinPattern.test(text.toUpperCase())) asinCount++;
          
          // Check if it's a P&L metric
          if (plMetrics.some(m => text.includes(m))) plCount++;
          else if (text.length > 2 && !text.startsWith('€') && !text.startsWith('-') && isNaN(text)) {
            productCount++;
          }
        });
        
        debugInfo += ` T${idx}:${totalRows}rows,${asinCount}asins,${productCount}prods,${plCount}pl;`;
        
        // Scoring: ASIN patterns are strongest signal, then product vs P&L ratio
        let score = asinCount * 10 + productCount * 2 - plCount * 3;
        if (score > bestScore && asinCount > 0) {
          bestScore = score;
          bestTable = t;
        }
      });
      
      // Fallback: look for table headers with ASIN/Product/SKU
      if (!bestTable) {
        tables.forEach(t => {
          const headerRow = t.querySelector('tr');
          if (!headerRow) return;
          const headerText = headerRow.innerText?.toLowerCase() || '';
          if (headerText.includes('asin') || headerText.includes('product')) {
            const rows = t.querySelectorAll('tr');
            if (rows.length > 2) {
              bestTable = t;
            }
          }
        });
      }
      
      if (!bestTable) return { found: false, debug: debugInfo };
      
      // Extract data
      const rows = bestTable.querySelectorAll('tr');
      const result = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        const rowData = [];
        for (const cell of cells) {
          let text = cell.innerText?.split('\n')[0]?.trim() || '';
          rowData.push(text);
        }
        if (rowData.some(c => c)) result.push(rowData);
      }
      
      return { found: true, data: result, debug: debugInfo };
    }, { plMetrics: P_AND_L_METRICS });
    
    if (result.found && result.data && result.data.length > 1) {
      const headers = result.data[0];
      const rows = result.data.slice(1);
      
      // Final check: are these actually product rows or P&L rows?
      const firstColValues = rows.map(r => r[0]?.toLowerCase() || '');
      const plHits = firstColValues.filter(v => P_AND_L_METRICS.some(m => v.includes(m))).length;
      
      if (plHits < rows.length * 0.5) {
        console.log(`      ✅ Per-ASIN tabel gevonden! (${rows.length} producten)`);
        console.log(`      Rijen: ${rows.length}, Kolommen: ${headers.length}`);
        console.log(`      Debug: ${result.debug}`);
        console.log(`      Headers: ${headers.slice(0, 5).join(', ')}...`);
        if (rows[0]) console.log(`      Row 0: ${rows[0].slice(0, 3).join(', ')}...`);
        return { headers, rows };
      } else {
        console.log(`      ⚠️ Tabel gevonden maar het zijn P&L metrics (${plHits}/${rows.length})`);
      }
    }
    
    console.log(`      Debug: ${result.debug || 'no tables'}`);
    
    if (attempt < 6) {
      await page.waitForTimeout(5000);
      // Re-scroll to trigger lazy loading
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
  
  console.log(`      ⚠️ Per-ASIN tabel NIET gevonden — skip`);
  return null;
}

async function saveToSupabase(market, viewType, headers, rows) {
  if (!SUPABASE_KEY) {
    console.log(`      ⚠️ Geen SUPABASE_SERVICE_ROLE_KEY — skip Supabase`);
    return;
  }
  
  const body = JSON.stringify({
    market,
    view_type: viewType,
    headers: JSON.stringify(headers),
    rows: JSON.stringify(rows),
    row_count: rows.length,
    exported_at: new Date().toISOString()
  });
  
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Exports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body
    });
    
    if (resp.ok) {
      console.log(`      ✅ Supabase: ${market} / ${viewType} (${rows.length} rijen)`);
    } else {
      const err = await resp.text();
      console.log(`      ❌ Supabase error: ${resp.status} ${err.substring(0, 200)}`);
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
  const csvContent = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  
  fs.writeFileSync(file, csvContent, 'utf8');
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
    // Specific market
    const market = args[0];
    if (MARKET_CONFIG[market]) {
      marketsToScrape = [market];
    } else {
      console.log(`❌ Onbekende markt: ${market}`);
      console.log(`Beschikbaar: ${ALL_MARKETS.join(', ')}`);
      process.exit(1);
    }
  }
  
  console.log(`📊 Sellerboard P&L Export v8.1`);
  console.log(`   Markten: ${marketsToScrape.join(', ')}`);
  console.log(`   Supabase: ${SUPABASE_KEY ? '✅' : '❌ Geen key'}`);
  console.log('');
  
  // Check storage state
  if (!fs.existsSync(STORAGE_STATE)) {
    console.log(`❌ Geen cookies gevonden: ${STORAGE_STATE}`);
    console.log('   Run eerst: node sellerboard-save-cookies.js');
    process.exit(1);
  }
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  
  let currentAccount = 'eu'; // Default account after cookie load
  const summary = {};
  
  try {
    // Navigate to dashboard first to establish session
    console.log('   🌐 Laden Sellerboard...');
    await page.goto('https://app.sellerboard.com/en/dashboard/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await takeDebugScreenshot(page, 'initial-load');
    
    for (let i = 0; i < marketsToScrape.length; i++) {
      const market = marketsToScrape[i];
      const config = MARKET_CONFIG[market];
      
      console.log(`\n📍 [${i + 1}/${marketsToScrape.length}] ${market}`);
      console.log('============================================================');
      
      // Switch account if needed
      if (config.account !== currentAccount) {
        const switched = await switchAccount(page, config.account);
        if (switched) {
          currentAccount = config.account;
        } else {
          console.log(`   ⚠️ Account switch gefaald — skip ${market}`);
          summary[market] = { main: '❌ Account switch', asin: '❌' };
          continue;
        }
      }
      
      // --- Main P&L ---
      console.log(`\n   📋 Main P&L...`);
      const mainUrl = buildDashboardUrl(config.urlParam);
      await page.goto(mainUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      
      const mainData = await scrapeTable(page, 'main_pl');
      if (mainData) {
        await saveToSupabase(market, 'main_pl', mainData.headers, mainData.rows);
        saveCsv(market, 'main_pl', mainData.headers, mainData.rows);
        summary[market] = { main: `${mainData.rows.length} rijen ✅` };
      } else {
        summary[market] = { main: '❌ Geen data' };
      }
      
      // --- Per ASIN ---
      console.log(`\n   📋 Per ASIN...`);
      const asinUrl = buildDashboardUrl(config.urlParam, 'asin');
      await page.goto(asinUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(8000); // ASIN view needs more time
      
      await takeDebugScreenshot(page, `per-asin-${config.urlParam}`);
      
      const asinData = await scrapeTable(page, 'per_asin');
      if (asinData) {
        await saveToSupabase(market, 'per_asin', asinData.headers, asinData.rows);
        saveCsv(market, 'per_asin', asinData.headers, asinData.rows);
        summary[market].asin = `${asinData.rows.length} rijen ✅`;
      } else {
        // Save main_pl as fallback
        if (mainData) {
          await saveToSupabase(market, 'per_asin_fallback', mainData.headers, mainData.rows);
          summary[market].asin = `⚠️ Fallback (${mainData.rows.length} rijen)`;
        } else {
          summary[market].asin = '❌ Geen data';
        }
      }
      
      // Small delay between markets
      await page.waitForTimeout(2000);
    }
    
  } catch (err) {
    console.error(`\n❌ FOUT: ${err.message}`);
    await takeDebugScreenshot(page, 'error');
  } finally {
    await browser.close();
  }
  
  // --- SUMMARY ---
  console.log('\n\n============================================================');
  console.log('📊 SAMENVATTING');
  console.log('============================================================');
  
  for (const [market, data] of Object.entries(summary)) {
    const mainStr = data.main || '?';
    const asinStr = data.asin || '?';
    console.log(`   ${market.padEnd(18)} Main: ${mainStr.padEnd(15)} |  ASIN: ${asinStr}`);
  }
  
  console.log(`\n   Supabase: Sellerboard_Exports (volledige data)`);
  console.log(`   CSVs:     ${path.join(__dirname, 'csv-downloads/')}`);
  console.log(`   Debug:    ${path.join(__dirname, 'debug-screenshots/')}`);
  
  // Write compact summary for executor/Browser_Tasks result
  const summaryJson = {
    version: 'v8.1',
    markets: Object.keys(summary),
    results: summary,
    exported_at: new Date().toISOString(),
    note: 'Full data in Supabase Sellerboard_Exports table + local CSVs'
  };
  
  const summaryFile = path.join(__dirname, 'sellerboard-pl-data.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summaryJson, null, 2));
  console.log(`   JSON:     ${summaryFile} (${(JSON.stringify(summaryJson).length / 1024).toFixed(1)}KB — summary only)`);
  
  console.log('\n✅ Klaar!');
  
  // Return summary for executor
  return summaryJson;
}

// Support both direct run and module export
if (require.main === module) {
  main().catch(console.error);
} else {
  module.exports = async function(browser, task) {
    // When called from executor, extract market scope from actions
    const args = task.actions || [];
    if (args.length > 0) {
      process.argv = ['node', 'sellerboard-pl-export.js', ...args];
    }
    return main();
  };
}
