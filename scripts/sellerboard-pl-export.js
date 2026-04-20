// Sellerboard P&L Export v8.3
// Flow from PDF + Tim's correction: P&L tab FIRST → then marketplace dropdown
// Never use URL params for marketplace — they get lost on navigation

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// --- CONFIG ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_STATE = path.join(__dirname, 'sellerboard-storage-state.json');

// Account mapping — from PDF step 3-4
const ACCOUNTS = {
  eu: { name: 'Tim@qualico.be' },
  us: { name: 'AMZ USA' }
};

// Market → which account + how it appears in the marketplace dropdown
const MARKET_CONFIG = {
  'Amazon.de':     { account: 'eu', dropdownText: 'Amazon.de' },
  'Amazon.co.uk':  { account: 'eu', dropdownText: 'Amazon.co.uk' },
  'Amazon.fr':     { account: 'eu', dropdownText: 'Amazon.fr' },
  'Amazon.it':     { account: 'eu', dropdownText: 'Amazon.it' },
  'Amazon.es':     { account: 'eu', dropdownText: 'Amazon.es' },
  'Amazon.nl':     { account: 'eu', dropdownText: 'Amazon.nl' },
  'Amazon.com':    { account: 'us', dropdownText: 'Amazon.com' },
  'Amazon.ca':     { account: 'us', dropdownText: 'Amazon.ca' }  // May be "Amazon.com/Amazon.ca" — script tries both
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
async function takeScreenshot(page, label) {
  try {
    const dir = path.join(__dirname, 'debug-screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `sb-${label}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`      📸 ${path.basename(file)}`);
  } catch (e) { /* ignore */ }
}

async function switchAccount(page, targetAccount) {
  console.log(`   🔄 Switchen naar ${ACCOUNTS[targetAccount].name}...`);
  
  // PDF Step 3: Click on account name/avatar in top-right
  // From screenshot: "AMZ USA ∨" is at the very top-right
  try {
    // First try clicking the account text directly
    let clicked = false;
    
    for (const searchText of ['Tim@qualico.be', 'tim@qualico.be', 'AMZ USA']) {
      try {
        const el = page.locator(`text="${searchText}"`).first();
        const box = await el.boundingBox({ timeout: 2000 });
        if (box && box.y < 80) {  // Must be in header area
          await el.click({ timeout: 3000 });
          clicked = true;
          console.log(`      ✅ Opened dropdown via: "${searchText}"`);
          break;
        }
      } catch (e) { /* try next */ }
    }
    
    // Fallback: click top-right avatar area
    if (!clicked) {
      const viewport = page.viewportSize();
      await page.mouse.click(viewport.width - 60, 30);
      console.log(`      ✅ Opened dropdown via position click`);
    }
    
    await page.waitForTimeout(2000);
    await takeScreenshot(page, `dropdown-${targetAccount}`);
    
    // PDF Step 4: Click target account
    const targetName = ACCOUNTS[targetAccount].name;
    let switched = false;
    
    // Try exact text match first
    try {
      await page.locator(`text="${targetName}"`).first().click({ timeout: 3000 });
      switched = true;
      console.log(`      ✅ Geswitcht naar: ${targetName}`);
    } catch (e) {
      // Try case-insensitive via evaluate
      const found = await page.evaluate((name) => {
        const items = document.querySelectorAll('li, div[role="menuitem"], div[role="option"], a, button, span');
        const lower = name.toLowerCase();
        for (const item of items) {
          const t = item.innerText?.trim().toLowerCase();
          if (t && t.includes(lower)) {
            item.click();
            return t;
          }
        }
        return null;
      }, targetName);
      
      if (found) {
        switched = true;
        console.log(`      ✅ Geswitcht via evaluate: ${found}`);
      }
    }
    
    if (!switched) {
      console.log(`      ❌ Account "${targetName}" niet gevonden in dropdown`);
      await takeScreenshot(page, `switch-failed-${targetAccount}`);
      return false;
    }
    
    await page.waitForTimeout(5000);  // Account switch takes time
    await takeScreenshot(page, `after-switch-${targetAccount}`);
    return true;
    
  } catch (err) {
    console.log(`      ❌ Account switch error: ${err.message}`);
    return false;
  }
}

async function clickPandLTab(page) {
  console.log(`   📊 Klik P&L tab...`);
  
  // From screenshot: P&L is in the top nav bar: Dashboard | Tiles | Chart | P&L | Map | Trends
  try {
    // Try clicking P&L text/link in nav
    for (const selector of [
      'text="P&L"',
      'a:has-text("P&L")',
      'button:has-text("P&L")',
      '[href*="P&L"]',
      '[href*="p&l"]',
      '[href*="p-l"]'
    ]) {
      try {
        const el = page.locator(selector).first();
        const box = await el.boundingBox({ timeout: 2000 });
        if (box && box.y < 60) {  // Must be in nav bar
          await el.click({ timeout: 3000 });
          console.log(`      ✅ P&L tab geklikd via: ${selector}`);
          await page.waitForTimeout(3000);
          return true;
        }
      } catch (e) { /* try next */ }
    }
    
    // Fallback: navigate to P&L URL
    console.log(`      ⚠️ P&L tab niet gevonden via klik — navigeer via URL`);
    await page.goto('https://app.sellerboard.com/en/dashboard/?viewType=table', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    return true;
    
  } catch (err) {
    console.log(`      ❌ P&L tab error: ${err.message}`);
    return false;
  }
}

async function selectMarketplace(page, market) {
  const config = MARKET_CONFIG[market];
  console.log(`   🌍 Selecteer marketplace: ${market}...`);
  
  // From screenshot: "All marketplaces ∨" dropdown in the filter bar
  // PDF Step 7: Double-click "All marketplaces" opens checkbox dropdown
  
  try {
    // Click the marketplace dropdown trigger
    let dropdownOpened = false;
    
    for (const selector of [
      'text="All marketplaces"',
      'text=/all marketplace/i',
      'text=/Amazon\\./i',  // If a specific market is already selected
      '[class*="marketplace"]',
    ]) {
      try {
        const el = page.locator(selector).first();
        const box = await el.boundingBox({ timeout: 2000 });
        // Must be in the filter bar area (between nav and table)
        if (box && box.y > 50 && box.y < 150) {
          await el.click({ timeout: 3000 });
          dropdownOpened = true;
          console.log(`      ✅ Marketplace dropdown geopend via: ${selector}`);
          break;
        }
      } catch (e) { /* try next */ }
    }
    
    if (!dropdownOpened) {
      // Try finding the marketplace filter by position — it's in the center-right of filter bar
      console.log(`      Probeer marketplace dropdown via evaluate...`);
      const found = await page.evaluate(() => {
        const elements = document.querySelectorAll('span, div, button, a');
        for (const el of elements) {
          const text = el.innerText?.trim().toLowerCase() || '';
          const rect = el.getBoundingClientRect();
          if ((text.includes('marketplace') || text.includes('amazon.')) && 
              rect.y > 50 && rect.y < 150 && rect.width > 50) {
            el.click();
            return text;
          }
        }
        return null;
      });
      if (found) {
        dropdownOpened = true;
        console.log(`      ✅ Dropdown geopend via evaluate: "${found}"`);
      }
    }
    
    if (!dropdownOpened) {
      console.log(`      ❌ Marketplace dropdown niet gevonden`);
      await takeScreenshot(page, `marketplace-fail-${market}`);
      return false;
    }
    
    await page.waitForTimeout(1500);
    await takeScreenshot(page, `marketplace-open-${market}`);
    
    // Now we need to:
    // 1. Deselect "All marketplaces" if checked
    // 2. Select only our target market
    
    // Try clicking the specific marketplace
    const textsToTry = [config.dropdownText];
    // For Amazon.ca, also try "Amazon.com/Amazon.ca" variant
    if (market === 'Amazon.ca') {
      textsToTry.push('Amazon.com/Amazon.ca', 'amazon.com/amazon.ca', 'Amazon.com / Amazon.ca');
    }
    
    let selected = false;
    for (const text of textsToTry) {
      try {
        // First, find and deselect "All marketplaces" if it's a checkbox
        await page.evaluate(() => {
          const items = document.querySelectorAll('label, div[role="option"], li, span');
          for (const item of items) {
            const t = item.innerText?.trim().toLowerCase();
            if (t && t.includes('all marketplace')) {
              // Check if it has a checked checkbox
              const checkbox = item.querySelector('input[type="checkbox"]');
              if (checkbox && checkbox.checked) {
                checkbox.click();
              } else {
                item.click();  // Toggle it off
              }
              break;
            }
          }
        });
        await page.waitForTimeout(500);
        
        // Now select our target market
        const clicked = await page.evaluate((targetText) => {
          const lower = targetText.toLowerCase();
          const items = document.querySelectorAll('label, div[role="option"], li, span, div');
          for (const item of items) {
            const t = item.innerText?.trim().toLowerCase();
            if (t === lower || (t.includes(lower) && t.length < lower.length + 20)) {
              // Check if it has a checkbox
              const checkbox = item.querySelector('input[type="checkbox"]');
              if (checkbox) {
                if (!checkbox.checked) checkbox.click();
              } else {
                item.click();
              }
              return t;
            }
          }
          return null;
        }, text);
        
        if (clicked) {
          selected = true;
          console.log(`      ✅ Marketplace geselecteerd: "${clicked}"`);
          break;
        }
      } catch (e) { /* try next */ }
    }
    
    if (!selected) {
      // Log what options ARE available
      const options = await page.evaluate(() => {
        const items = document.querySelectorAll('label, div[role="option"], li');
        return Array.from(items).map(i => i.innerText?.trim()).filter(t => t && t.length < 100).slice(0, 20);
      });
      console.log(`      ❌ Marketplace "${market}" niet gevonden. Beschikbare opties:`, options);
      await takeScreenshot(page, `marketplace-miss-${market}`);
      return false;
    }
    
    // Close dropdown by clicking outside
    await page.mouse.click(10, 300);
    await page.waitForTimeout(3000);  // Wait for data to reload
    
    await takeScreenshot(page, `marketplace-selected-${market}`);
    return true;
    
  } catch (err) {
    console.log(`      ❌ Marketplace selectie error: ${err.message}`);
    return false;
  }
}

async function selectGroupByAsin(page) {
  console.log(`   🔀 Schakel naar Per-ASIN view...`);
  
  // The groupBy selector — from PDF step 1 URL has groupBy=asin
  // In the UI, this is likely a toggle or dropdown
  // Try URL approach first (add groupBy=asin to current URL)
  try {
    const currentUrl = page.url();
    const url = new URL(currentUrl);
    url.searchParams.set('groupBy', 'asin');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);  // ASIN view needs more time
    console.log(`      ✅ GroupBy=asin via URL param`);
    return true;
  } catch (e) {
    console.log(`      ⚠️ URL groupBy failed: ${e.message}`);
  }
  
  return false;
}

async function scrapeTable(page, viewType) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`      ⏳ Wacht op tabel (poging ${attempt}/3)...`);
    try {
      await page.waitForSelector('table', { timeout: 10000 });
      break;
    } catch (e) {
      if (attempt === 3) {
        console.log(`      ❌ Geen tabel na 3 pogingen`);
        return null;
      }
      await page.waitForTimeout(3000);
    }
  }
  await page.waitForTimeout(3000);
  
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
      if (rows.length > bestRows) { bestRows = rows.length; bestTable = t; }
    });
    
    if (!bestTable) return null;
    
    const result = [];
    for (const row of bestTable.querySelectorAll('tr')) {
      const rowData = [];
      for (const cell of row.querySelectorAll('th, td')) {
        rowData.push(cell.innerText?.split('\n')[0]?.trim() || '');
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
  // Scroll to trigger lazy loading
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
      let debug = `${tables.length} tables.`;
      let bestTable = null;
      let bestScore = 0;
      
      tables.forEach((t, idx) => {
        const rows = t.querySelectorAll('tr');
        let asinCount = 0, productCount = 0, plCount = 0, total = 0;
        
        rows.forEach(row => {
          const firstCell = row.querySelector('td, th');
          if (!firstCell) return;
          const text = firstCell.innerText?.split('\n')[0]?.trim().toLowerCase() || '';
          total++;
          if (asinPattern.test(text.toUpperCase())) asinCount++;
          if (plMetrics.some(m => text.includes(m))) plCount++;
          else if (text.length > 2 && !text.startsWith('€') && !text.startsWith('$') && !text.startsWith('-') && isNaN(text)) productCount++;
        });
        
        debug += ` T${idx}:${total}r,${asinCount}a,${productCount}p,${plCount}pl;`;
        
        let score = asinCount * 10 + productCount * 2 - plCount * 3;
        if (score > bestScore && asinCount > 0) { bestScore = score; bestTable = t; }
      });
      
      // Fallback: check headers
      if (!bestTable) {
        tables.forEach(t => {
          const hdr = t.querySelector('tr');
          if (!hdr) return;
          const h = hdr.innerText?.toLowerCase() || '';
          if ((h.includes('asin') || h.includes('product')) && t.querySelectorAll('tr').length > 2) bestTable = t;
        });
      }
      
      if (!bestTable) return { found: false, debug };
      
      const result = [];
      for (const row of bestTable.querySelectorAll('tr')) {
        const rowData = [];
        for (const cell of row.querySelectorAll('th, td')) {
          rowData.push(cell.innerText?.split('\n')[0]?.trim() || '');
        }
        if (rowData.some(c => c)) result.push(rowData);
      }
      return { found: true, data: result, debug };
    }, { plMetrics: P_AND_L_METRICS });
    
    if (result.found && result.data && result.data.length > 1) {
      const headers = result.data[0];
      const rows = result.data.slice(1);
      const firstCol = rows.map(r => r[0]?.toLowerCase() || '');
      const plHits = firstCol.filter(v => P_AND_L_METRICS.some(m => v.includes(m))).length;
      
      if (plHits < rows.length * 0.5) {
        console.log(`      ✅ Per-ASIN gevonden! (${rows.length} producten)`);
        console.log(`      Debug: ${result.debug}`);
        console.log(`      Headers: ${headers.slice(0, 5).join(', ')}...`);
        if (rows[0]) console.log(`      Row 0: ${rows[0].slice(0, 3).join(', ')}...`);
        return { headers, rows };
      }
    }
    
    console.log(`      ${result.debug || 'no tables'}`);
    if (attempt < 6) {
      await page.waitForTimeout(5000);
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
  
  console.log(`      ⚠️ Per-ASIN NIET gevonden`);
  return null;
}

async function saveToSupabase(market, viewType, headers, rows) {
  if (!SUPABASE_KEY) { console.log(`      ⚠️ Geen SUPABASE key`); return; }
  
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
        market, view_type: viewType,
        headers: JSON.stringify(headers),
        rows: JSON.stringify(rows),
        row_count: rows.length,
        exported_at: new Date().toISOString()
      })
    });
    if (resp.ok) console.log(`      ✅ Supabase: ${market}/${viewType} (${rows.length} rijen)`);
    else console.log(`      ❌ Supabase: ${resp.status} ${(await resp.text()).substring(0, 200)}`);
  } catch (e) { console.log(`      ❌ Supabase: ${e.message}`); }
}

function saveCsv(market, viewType, headers, rows) {
  const dir = path.join(__dirname, 'csv-downloads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const name = market.replace('Amazon.', '').replace('.', '_').toLowerCase();
  const file = path.join(dir, `sellerboard-${name}-${viewType}.csv`);
  const esc = v => `"${(v || '').replace(/"/g, '""')}"`;
  fs.writeFileSync(file, [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n'), 'utf8');
  console.log(`      ✅ CSV: ${path.basename(file)}`);
}

// --- MAIN ---
async function main() {
  const args = process.argv.slice(2);
  let markets = [];
  
  if (args.length === 0 || args[0] === 'eu') markets = EU_MARKETS;
  else if (args[0] === 'us') markets = US_MARKETS;
  else if (args[0] === 'all') markets = ALL_MARKETS;
  else if (MARKET_CONFIG[args[0]]) markets = [args[0]];
  else { console.log(`❌ Onbekend: ${args[0]}. Gebruik: ${ALL_MARKETS.join(', ')}`); process.exit(1); }
  
  console.log(`📊 Sellerboard P&L Export v8.3`);
  console.log(`   Markten: ${markets.join(', ')}`);
  console.log(`   Supabase: ${SUPABASE_KEY ? '✅' : '❌'}\n`);
  
  if (!fs.existsSync(STORAGE_STATE)) {
    console.log(`❌ Geen cookies: ${STORAGE_STATE}\n   Run: node sellerboard-save-cookies.js`);
    process.exit(1);
  }
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  
  let currentAccount = 'eu';
  const summary = {};
  
  try {
    // Initial load
    console.log('   🌐 Laden Sellerboard dashboard...');
    await page.goto('https://app.sellerboard.com/en/dashboard/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await takeScreenshot(page, 'initial');
    
    for (let i = 0; i < markets.length; i++) {
      const market = markets[i];
      const config = MARKET_CONFIG[market];
      
      console.log(`\n📍 [${i + 1}/${markets.length}] ${market}`);
      console.log('============================================================');
      
      // 1. Switch account if needed
      if (config.account !== currentAccount) {
        const ok = await switchAccount(page, config.account);
        if (ok) { currentAccount = config.account; }
        else {
          console.log(`   ⚠️ Account switch gefaald — skip ${market}`);
          summary[market] = { main: '❌ Switch', asin: '❌' };
          continue;
        }
      }
      
      // 2. Click P&L tab FIRST (Tim's instruction!)
      await clickPandLTab(page);
      await page.waitForTimeout(3000);
      
      // 3. Select marketplace via dropdown
      const marketOk = await selectMarketplace(page, market);
      if (!marketOk) {
        console.log(`   ⚠️ Marketplace selectie gefaald — probeer URL fallback`);
        // URL fallback
        const url = `https://app.sellerboard.com/en/dashboard/?viewType=table&market[]=${encodeURIComponent(config.dropdownText)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);
      }
      
      // 4. Scrape Main P&L
      console.log(`\n   📋 Main P&L...`);
      const mainData = await scrapeTable(page, 'main_pl');
      if (mainData) {
        await saveToSupabase(market, 'main_pl', mainData.headers, mainData.rows);
        saveCsv(market, 'main_pl', mainData.headers, mainData.rows);
        summary[market] = { main: `${mainData.rows.length} rijen ✅` };
      } else {
        summary[market] = { main: '❌ Geen data' };
        await takeScreenshot(page, `no-data-${market}`);
      }
      
      // 5. Switch to Per-ASIN view (groupBy=asin)
      console.log(`\n   📋 Per ASIN...`);
      await selectGroupByAsin(page);
      await takeScreenshot(page, `per-asin-${market}`);
      
      const asinData = await scrapeTable(page, 'per_asin');
      if (asinData) {
        await saveToSupabase(market, 'per_asin', asinData.headers, asinData.rows);
        saveCsv(market, 'per_asin', asinData.headers, asinData.rows);
        summary[market].asin = `${asinData.rows.length} rijen ✅`;
      } else {
        if (mainData) {
          await saveToSupabase(market, 'per_asin_fallback', mainData.headers, mainData.rows);
          summary[market].asin = `⚠️ Fallback`;
        } else {
          summary[market].asin = '❌';
        }
      }
      
      await page.waitForTimeout(2000);
    }
    
  } catch (err) {
    console.error(`\n❌ FOUT: ${err.message}`);
    await takeScreenshot(page, 'error');
  } finally {
    await browser.close();
  }
  
  // Summary
  console.log('\n\n============================================================');
  console.log('📊 SAMENVATTING');
  console.log('============================================================');
  for (const [m, d] of Object.entries(summary)) {
    console.log(`   ${m.padEnd(18)} Main: ${(d.main||'?').padEnd(15)} |  ASIN: ${d.asin||'?'}`);
  }
  console.log(`\n   Supabase: Sellerboard_Exports`);
  console.log(`   CSVs:     ${path.join(__dirname, 'csv-downloads/')}`);
  console.log(`   Debug:    ${path.join(__dirname, 'debug-screenshots/')}`);
  
  const summaryJson = { version: 'v8.3', markets: Object.keys(summary), results: summary, exported_at: new Date().toISOString() };
  const summaryFile = path.join(__dirname, 'sellerboard-pl-data.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summaryJson, null, 2));
  console.log(`   JSON:     ${summaryFile} (${(JSON.stringify(summaryJson).length / 1024).toFixed(1)}KB)`);
  console.log('\n✅ Klaar!');
  
  return summaryJson;
}

if (require.main === module) {
  main().catch(console.error);
} else {
  module.exports = async function(browser, task) {
    const args = task.actions || [];
    if (args.length > 0) process.argv = ['node', 'sellerboard-pl-export.js', ...args];
    return main();
  };
}
