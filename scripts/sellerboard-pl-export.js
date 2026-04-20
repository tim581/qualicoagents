// Sellerboard P&L Export v8.6
// Flow from PDF: navigate to P&L → marketplace dropdown → scrape
// NEVER use market[] URL param — always use on-page dropdown

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// --- CONFIG ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_STATE = path.join(__dirname, 'sellerboard-storage-state.json');

// Account mapping — from PDF step 3-4
const ACCOUNTS = {
  eu: { name: 'Tim@qualico.be', label: 'EU' },
  us: { name: 'AMZ USA', label: 'US/CA' }
};

// Market → which account it belongs to + exact dropdown text
const MARKET_CONFIG = {
  'Amazon.de':     { account: 'eu', dropdownText: 'Amazon.de' },
  'Amazon.co.uk':  { account: 'eu', dropdownText: 'Amazon.co.uk' },
  'Amazon.fr':     { account: 'eu', dropdownText: 'Amazon.fr' },
  'Amazon.it':     { account: 'eu', dropdownText: 'Amazon.it' },
  'Amazon.es':     { account: 'eu', dropdownText: 'Amazon.es' },
  'Amazon.nl':     { account: 'eu', dropdownText: 'Amazon.nl' },
  'Amazon.com':    { account: 'us', dropdownText: 'Amazon.com' },
  'Amazon.ca':     { account: 'us', dropdownText: 'Amazon.ca' }
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
function buildDashboardUrl(groupBy = null) {
  // NO market param — marketplace is selected via on-page dropdown
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
  
  if (groupBy) params.set('groupBy', groupBy);
  
  return `https://app.sellerboard.com/en/dashboard/?${params.toString()}`;
}

async function switchAccount(page, targetAccount) {
  console.log(`   🔄 Switchen naar ${targetAccount} account...`);
  
  try {
    // Step 1: Click the avatar/account button in the top-right
    let clicked = false;
    
    // Look for account text in top navigation
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
    
    // Fallback: click position in top-right where avatar is
    if (!clicked) {
      const viewport = page.viewportSize();
      const x = viewport.width - 60;
      const y = 35;
      await page.mouse.click(x, y);
      clicked = true;
      console.log(`      ✅ Klikte op positie (${x}, ${y})`);
    }
    
    await page.waitForTimeout(2000);
    await takeDebugScreenshot(page, `account-dropdown-${targetAccount}`);
    
    // Step 2: Click target account in dropdown
    const targetName = ACCOUNTS[targetAccount].name;
    let switched = false;
    
    // Try exact text match
    for (const text of [targetName, targetName.toLowerCase(), targetName.toUpperCase()]) {
      try {
        await page.locator(`text="${text}"`).first().click({ timeout: 3000 });
        switched = true;
        console.log(`      ✅ Geswitcht naar: ${text}`);
        break;
      } catch (e) { /* try next */ }
    }
    
    // Fallback: evaluate to find and click
    if (!switched) {
      const found = await page.evaluate((target) => {
        const items = document.querySelectorAll('li, div[role="menuitem"], div[role="option"], a, button, span');
        for (const item of items) {
          const t = item.innerText?.trim();
          if (t && t.toLowerCase().includes(target.toLowerCase())) {
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
      console.log(`      ❌ Account switch gefaald`);
      await takeDebugScreenshot(page, `account-switch-failed-${targetAccount}`);
      return false;
    }
    
    await page.waitForTimeout(5000);
    console.log(`      ✅ Account switch compleet`);
    return true;
    
  } catch (err) {
    console.log(`      ❌ Account switch error: ${err.message}`);
    await takeDebugScreenshot(page, `account-switch-error-${targetAccount}`);
    return false;
  }
}

async function selectMarketplace(page, marketDropdownText) {
  console.log(`      🌍 Selecteer marketplace: ${marketDropdownText}...`);
  
  try {
    // CRITICAL: Multi-select checkbox dropdown ON the P&L page.
    // Strategy: open dropdown → use COORDINATES to click checkboxes → Escape to close
    // NEVER use text selectors for clicking (they match sidebar items!)
    
    // Step 1: Find the marketplace dropdown trigger in the FILTER BAR (top area, y < 200)
    // Use evaluate to find the exact element and its coordinates
    const trigger = await page.evaluate(() => {
      const allElements = document.querySelectorAll('button, div, span, a');
      const marketKeywords = ['all marketplace', 'alle markt', 'amazon.', 'marketplace'];
      
      for (const el of allElements) {
        const text = el.innerText?.trim()?.toLowerCase() || '';
        const rect = el.getBoundingClientRect();
        
        // Must be in the top filter area (y < 200) and visible
        if (rect.width === 0 || rect.height === 0 || rect.top > 200) continue;
        // Must be in the main content area (not sidebar, x > 200)
        if (rect.left < 180) continue;
        
        if (marketKeywords.some(kw => text.includes(kw))) {
          return {
            text: text.substring(0, 40),
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2)
          };
        }
      }
      return null;
    });
    
    if (!trigger) {
      console.log(`      ❌ Marketplace dropdown niet gevonden in filter bar`);
      await takeDebugScreenshot(page, `marketplace-dropdown-miss`);
      return false;
    }
    
    console.log(`      🎯 Dropdown trigger: "${trigger.text}" at (${trigger.x}, ${trigger.y})`);
    await page.mouse.click(trigger.x, trigger.y);
    await page.waitForTimeout(1500);
    await takeDebugScreenshot(page, `marketplace-dropdown-open`);
    
    // Step 2: Find all options in the POPUP overlay with their coordinates
    // Look for a popup/dropdown overlay that appeared AFTER the click
    const options = await page.evaluate(() => {
      const results = [];
      
      // Strategy: find elements that contain "Amazon" text and are in a popup/overlay
      // Popups typically have high z-index, position:absolute/fixed, or are in a portal
      const allElements = document.querySelectorAll('*');
      
      for (const el of allElements) {
        const text = el.innerText?.trim();
        if (!text) continue;
        
        // Only look at leaf-level or near-leaf elements with Amazon text
        const directText = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent.trim())
          .join('');
        const hasAmazonDirect = directText.toLowerCase().includes('amazon');
        const textLower = text.toLowerCase();
        
        if (!hasAmazonDirect && !textLower.startsWith('amazon')) continue;
        if (el.children.length > 3) continue; // Skip container divs
        
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        // Must NOT be in sidebar (x > 180)
        if (rect.left < 180) continue;
        
        // Check for checkbox/checked state
        const checkbox = el.querySelector('input[type="checkbox"]');
        const parentLabel = el.closest('label');
        const parentCheckbox = parentLabel?.querySelector('input[type="checkbox"]');
        const cb = checkbox || parentCheckbox;
        
        // Also check for visual indicators (SVG checkmark, data attributes, classes)
        const hasCheckSvg = el.querySelector('svg') !== null || el.closest('label')?.querySelector('svg') !== null;
        const classList = (el.className?.toString?.() || '') + ' ' + (el.closest('label')?.className?.toString?.() || '');
        const hasActiveClass = classList.includes('selected') || classList.includes('active') || classList.includes('checked');
        
        const isChecked = cb ? cb.checked : (hasActiveClass || false);
        
        // Get the clickable center (click the checkbox area, usually left side)
        const clickTarget = parentLabel || el;
        const clickRect = clickTarget.getBoundingClientRect();
        
        results.push({
          text: text.substring(0, 30).split('\n')[0].trim(),
          checked: isChecked,
          x: Math.round(clickRect.left + 15), // Click left side where checkbox is
          y: Math.round(clickRect.top + clickRect.height / 2),
          width: Math.round(clickRect.width)
        });
      }
      
      // Deduplicate by similar y-position (within 5px)
      const deduped = [];
      for (const opt of results) {
        const exists = deduped.some(d => Math.abs(d.y - opt.y) < 5);
        if (!exists) deduped.push(opt);
      }
      
      return deduped;
    });
    
    console.log(`      Opties (${options.length}): ${JSON.stringify(options)}`);
    
    if (options.length === 0) {
      console.log(`      ❌ Geen marketplace opties gevonden in dropdown`);
      await page.keyboard.press('Escape');
      return false;
    }
    
    // Step 3: Click by COORDINATES — first uncheck all, then check only target
    const targetLower = marketDropdownText.toLowerCase();
    
    // First: uncheck all non-target that are checked
    for (const opt of options) {
      const isTarget = opt.text.toLowerCase().includes(targetLower) || 
                       targetLower.includes(opt.text.toLowerCase().replace(/\s/g, ''));
      
      if (!isTarget && opt.checked) {
        await page.mouse.click(opt.x, opt.y);
        console.log(`      ❎ Unchecked: "${opt.text}" at (${opt.x}, ${opt.y})`);
        await page.waitForTimeout(400);
      }
    }
    
    // Then: ensure target IS checked
    for (const opt of options) {
      const isTarget = opt.text.toLowerCase().includes(targetLower) || 
                       targetLower.includes(opt.text.toLowerCase().replace(/\s/g, ''));
      
      if (isTarget && !opt.checked) {
        await page.mouse.click(opt.x, opt.y);
        console.log(`      ☑️ Checked: "${opt.text}" at (${opt.x}, ${opt.y})`);
        await page.waitForTimeout(400);
      } else if (isTarget) {
        console.log(`      ✅ "${opt.text}" was al geselecteerd`);
      }
    }
    
    // Step 4: Close dropdown with ESCAPE (NOT by clicking — sidebar click = navigation!)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    
    await takeDebugScreenshot(page, `marketplace-selected-${marketDropdownText}`);
    
    // Wait for data to reload
    console.log(`      ⏳ Wacht op data reload...`);
    await page.waitForTimeout(5000);
    
    return true;
    
  } catch (err) {
    console.log(`      ❌ Marketplace selectie error: ${err.message}`);
    await takeDebugScreenshot(page, `marketplace-error-${marketDropdownText}`);
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
  // Wait for table
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
  
  await page.waitForTimeout(3000);
  
  if (viewType === 'per_asin') {
    return await scrapePerAsinTable(page);
  } else {
    return await scrapeMainPlTable(page);
  }
}

async function scrapeMainPlTable(page) {
  // Try expanding fee rows (click expandable/collapsible rows)
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
  // Scroll to trigger lazy loading
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  
  // Retry loop — ASIN table may need time
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
          
          if (asinPattern.test(text.toUpperCase())) asinCount++;
          if (plMetrics.some(m => text.includes(m))) plCount++;
          else if (text.length > 2 && !text.startsWith('€') && !text.startsWith('-') && isNaN(text)) {
            productCount++;
          }
        });
        
        debugInfo += ` T${idx}:${totalRows}rows,${asinCount}asins,${productCount}prods,${plCount}pl;`;
        
        let score = asinCount * 10 + productCount * 2 - plCount * 3;
        if (score > bestScore && asinCount > 0) {
          bestScore = score;
          bestTable = t;
        }
      });
      
      // Fallback: header check
      if (!bestTable) {
        tables.forEach(t => {
          const headerRow = t.querySelector('tr');
          if (!headerRow) return;
          const headerText = headerRow.innerText?.toLowerCase() || '';
          if (headerText.includes('asin') || headerText.includes('product')) {
            const rows = t.querySelectorAll('tr');
            if (rows.length > 2) bestTable = t;
          }
        });
      }
      
      if (!bestTable) return { found: false, debug: debugInfo };
      
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
      
      const firstColValues = rows.map(r => r[0]?.toLowerCase() || '');
      const plHits = firstColValues.filter(v => P_AND_L_METRICS.some(m => v.includes(m))).length;
      
      if (plHits < rows.length * 0.5) {
        console.log(`      ✅ Per-ASIN tabel gevonden! (${rows.length} producten)`);
        console.log(`      Rijen: ${rows.length}, Kolommen: ${headers.length}`);
        console.log(`      Debug: ${result.debug.substring(0, 200)}`);
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
    const market = args[0];
    if (MARKET_CONFIG[market]) {
      marketsToScrape = [market];
    } else {
      console.log(`❌ Onbekende markt: ${market}`);
      console.log(`Beschikbaar: ${ALL_MARKETS.join(', ')}`);
      process.exit(1);
    }
  }
  
  console.log(`📊 Sellerboard P&L Export v8.6`);
  console.log(`   Markten: ${marketsToScrape.join(', ')}`);
  console.log(`   Supabase: ${SUPABASE_KEY ? '✅' : '❌ Geen key'}`);
  console.log('');
  
  if (!fs.existsSync(STORAGE_STATE)) {
    console.log(`❌ Geen cookies gevonden: ${STORAGE_STATE}`);
    console.log('   Run eerst: node sellerboard-save-cookies.js');
    process.exit(1);
  }
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  
  let currentAccount = 'eu'; // Default after cookie load
  const summary = {};
  
  try {
    // Initial load — go to dashboard/P&L page
    console.log('   🌐 Laden Sellerboard...');
    await page.goto(buildDashboardUrl(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await takeDebugScreenshot(page, 'initial-load');
    
    for (let i = 0; i < marketsToScrape.length; i++) {
      const market = marketsToScrape[i];
      const config = MARKET_CONFIG[market];
      
      console.log(`\n📍 [${i + 1}/${marketsToScrape.length}] ${market}`);
      console.log('============================================================');
      
      // Step 1: Switch account if needed
      if (config.account !== currentAccount) {
        const switched = await switchAccount(page, config.account);
        if (switched) {
          currentAccount = config.account;
          // After account switch, navigate to P&L again (account switch may redirect)
          await page.goto(buildDashboardUrl(), { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(5000);
        } else {
          console.log(`   ⚠️ Account switch gefaald — skip ${market}`);
          summary[market] = { main: '❌ Account switch', asin: '❌' };
          continue;
        }
      }
      
      // === MAIN P&L ===
      console.log(`\n   📋 Main P&L...`);
      
      // Step 2: Navigate to P&L page (no market param — fresh load)
      await page.goto(buildDashboardUrl(), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      
      // Step 3: Select marketplace via on-page dropdown
      const marketSelected = await selectMarketplace(page, config.dropdownText);
      if (!marketSelected) {
        console.log(`   ⚠️ Marketplace selectie gefaald — probeer toch te scrapen`);
      }
      
      // Step 4: Scrape main P&L
      const mainData = await scrapeTable(page, 'main_pl');
      if (mainData) {
        await saveToSupabase(market, 'main_pl', mainData.headers, mainData.rows);
        saveCsv(market, 'main_pl', mainData.headers, mainData.rows);
        summary[market] = { main: `${mainData.rows.length} rijen ✅` };
      } else {
        summary[market] = { main: '❌ Geen data' };
      }
      
      // === PER ASIN ===
      console.log(`\n   📋 Per ASIN...`);
      
      // Step 5: Navigate to P&L with groupBy=asin (fresh load, no market param)
      await page.goto(buildDashboardUrl('asin'), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      
      // Step 6: Select marketplace again via dropdown
      const marketSelectedAsin = await selectMarketplace(page, config.dropdownText);
      if (!marketSelectedAsin) {
        console.log(`   ⚠️ Marketplace selectie gefaald voor per-ASIN`);
      }
      
      // Step 7: Extra wait for ASIN data to load
      await page.waitForTimeout(5000);
      await takeDebugScreenshot(page, `per-asin-${config.dropdownText}`);
      
      const asinData = await scrapeTable(page, 'per_asin');
      if (asinData) {
        await saveToSupabase(market, 'per_asin', asinData.headers, asinData.rows);
        saveCsv(market, 'per_asin', asinData.headers, asinData.rows);
        summary[market].asin = `${asinData.rows.length} rijen ✅`;
      } else {
        if (mainData) {
          await saveToSupabase(market, 'per_asin_fallback', mainData.headers, mainData.rows);
          summary[market].asin = `⚠️ Fallback (${mainData.rows.length} rijen)`;
        } else {
          summary[market] = summary[market] || {};
          summary[market].asin = '❌ Geen data';
        }
      }
      
      // Delay between markets
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
  
  const summaryJson = {
    version: 'v8.4',
    markets: Object.keys(summary),
    results: summary,
    exported_at: new Date().toISOString(),
    note: 'Full data in Supabase Sellerboard_Exports table + local CSVs'
  };
  
  const summaryFile = path.join(__dirname, 'sellerboard-pl-data.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summaryJson, null, 2));
  console.log(`   JSON:     ${summaryFile} (${(JSON.stringify(summaryJson).length / 1024).toFixed(1)}KB — summary only)`);
  
  console.log('\n✅ Klaar!');
}

// Handle module export for executor
if (require.main === module) {
  main().catch(console.error);
} else {
  module.exports = async function(task, context, page) {
    // When called from executor, use the provided page
    // Parse actions for market selection
    const actions = task.actions || [];
    const arg = actions[0] || 'eu';
    
    // Override process.argv for main()
    process.argv = ['node', 'sellerboard-pl-export.js', arg];
    await main();
    
    return { success: true, message: `Sellerboard export complete for: ${arg}` };
  };
}
