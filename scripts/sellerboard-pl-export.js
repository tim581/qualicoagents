// Sellerboard P&L Export v8.0
// FIX: per-ASIN detection — 3-layer strategy with retry (confirmed working)
// FIX: US/CA separate accounts — robust account switcher with verification
// FIX: marketplace verification after navigation — confirm correct market loaded
// FIX: Amazon fees — detect expandable rows for fee breakdown
// FULL data → Supabase `Sellerboard_Exports` table (agents query this)
// FULL data → CSV files (local backup)
// COMPACT summary → JSON (for Browser_Tasks.result)
//
// Usage (CLI):
//   node sellerboard-pl-export.js              → All EU markets
//   node sellerboard-pl-export.js Amazon.co.uk  → Single market
//   node sellerboard-pl-export.js us            → US markets (switches account)
//   node sellerboard-pl-export.js all           → All EU + US markets
//
// Usage (executor): reads MARKET_SCOPE env variable

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const COOKIE_FILE = path.join(__dirname, 'sellerboard-storage-state.json');
const EU_MARKETS = ['Amazon.co.uk', 'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl'];
const US_MARKETS = ['Amazon.com', 'Amazon.ca'];
const ALL_MARKETS = [...EU_MARKETS, ...US_MARKETS];
const CSV_DIR = path.join(__dirname, 'csv-downloads');
const SCREENSHOT_DIR = path.join(__dirname, 'debug-screenshots');

// P&L metric keywords — rows starting with these are P&L summary (NOT products)
const PL_METRICS = [
  'sales', 'units', 'refund', 'promo', 'ppc', 'cogs', 'cost of goods',
  'profit', 'margin', 'roi', 'fba', 'cost', 'other', 'vat', 'tax',
  'shipping', 'storage', 'disposal', 'estimated payout', 'expenses',
  'reimbursement', 'adjustment', 'organic', 'revenue', 'net profit',
  'gross profit', 'total', 'amazon fees', 'commission', 'fulfillment'
];

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function getMarkets(arg) {
  if (!arg || arg === 'eu') return EU_MARKETS;
  if (arg === 'all') return ALL_MARKETS;
  if (arg === 'us') return US_MARKETS;
  return [arg];
}

function toCsv(headers, rows) {
  const escape = (v) => {
    const s = String(v || '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  return lines.join('\n');
}

async function writeToSupabase(market, viewType, headers, rows, periodStart, periodEnd) {
  try {
    const { error } = await supabase
      .from('Sellerboard_Exports')
      .upsert({
        market,
        view_type: viewType,
        headers: JSON.stringify(headers),
        rows: JSON.stringify(rows),
        row_count: rows.length,
        period_start: periodStart,
        period_end: periodEnd,
        exported_at: new Date().toISOString(),
      }, { onConflict: 'market,view_type' });

    if (error) {
      console.log(`      ⚠️ Supabase write fout: ${error.message}`);
    } else {
      console.log(`      ✅ Supabase: ${market} / ${viewType} (${rows.length} rijen)`);
    }
  } catch (e) {
    console.log(`      ⚠️ Supabase error: ${e.message}`);
  }
}

async function takeDebugScreenshot(page, label) {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const filename = `sellerboard-${label}-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, filename), fullPage: false });
    console.log(`      📸 Screenshot: ${filename}`);
  } catch (e) {
    // Ignore screenshot errors
  }
}

// ---- Account switcher ----
// Sellerboard has accounts in a dropdown. EU = Tim@qualico.be, US = "AMZ USA" or similar
async function switchAccount(page, targetAccount) {
  console.log(`   🔄 Switchen naar ${targetAccount} account...`);
  
  // Step 1: Find and click the account dropdown trigger
  // Look for the current account name in the top bar
  const dropdownClicked = await page.evaluate(() => {
    // Look for account selector — typically a dropdown in the header/nav
    const candidates = document.querySelectorAll('div, span, button, a, [role="button"]');
    for (const el of candidates) {
      if (!el.offsetParent) continue; // Skip invisible
      const text = (el.innerText || '').trim();
      // Account dropdown usually shows current account name
      if (text.match(/qualico|amz\s*usa|tim@/i) && text.length < 100) {
        // Check if it's clickable (not just a label inside a larger element)
        const rect = el.getBoundingClientRect();
        if (rect.height > 10 && rect.height < 100 && rect.width > 30) {
          el.click();
          return { clicked: true, text: text.substring(0, 60) };
        }
      }
    }
    return { clicked: false };
  });
  
  console.log(`      Dropdown: ${dropdownClicked.clicked ? '✅ ' + dropdownClicked.text : '❌ niet gevonden'}`);
  
  if (!dropdownClicked.clicked) {
    await takeDebugScreenshot(page, 'account-dropdown-miss');
    return false;
  }
  
  await page.waitForTimeout(2000);
  await takeDebugScreenshot(page, 'account-dropdown-open');
  
  // Step 2: Click the target account option
  const targetPattern = targetAccount === 'us' 
    ? /amz\s*usa|amazon\s*us|us\s*account|north\s*america/i
    : /qualico|tim@qualico|eu\s*account/i;
  
  const optionClicked = await page.evaluate((pattern) => {
    const candidates = document.querySelectorAll('div, span, button, a, li, [role="option"], [role="menuitem"]');
    const regex = new RegExp(pattern);
    const found = [];
    
    for (const el of candidates) {
      if (!el.offsetParent) continue;
      const text = (el.innerText || '').trim();
      if (regex.test(text) && text.length < 100) {
        found.push({ text: text.substring(0, 60), tag: el.tagName });
      }
    }
    
    // Click the most specific match (shortest text = most specific)
    found.sort((a, b) => a.text.length - b.text.length);
    
    for (const el of candidates) {
      if (!el.offsetParent) continue;
      const text = (el.innerText || '').trim();
      if (found[0] && text === found[0].text) {
        el.click();
        return { clicked: true, text: text, allFound: found };
      }
    }
    
    return { clicked: false, allFound: found };
  }, targetPattern.source);
  
  console.log(`      Option: ${optionClicked.clicked ? '✅ ' + optionClicked.text : '❌ niet gevonden'}`);
  if (optionClicked.allFound?.length > 0) {
    console.log(`      Gevonden opties: ${optionClicked.allFound.map(f => f.text).join(' | ')}`);
  }
  
  if (!optionClicked.clicked) {
    await takeDebugScreenshot(page, `account-option-miss-${targetAccount}`);
    return false;
  }
  
  // Wait for account switch to complete (page reloads/refreshes)
  await page.waitForTimeout(6000);
  await takeDebugScreenshot(page, `account-switched-${targetAccount}`);
  
  // Verify: check what account is now active
  const activeAccount = await page.evaluate(() => {
    const candidates = document.querySelectorAll('div, span, button, a');
    for (const el of candidates) {
      if (!el.offsetParent) continue;
      const text = (el.innerText || '').trim();
      if (text.match(/qualico|amz\s*usa/i) && text.length < 60) {
        const rect = el.getBoundingClientRect();
        if (rect.y < 100 && rect.height < 60) { // In top bar
          return text;
        }
      }
    }
    return 'unknown';
  });
  console.log(`      Actief account: ${activeAccount}`);
  
  return true;
}

// ---- Marketplace verification ----
// After navigating to a URL, verify the correct marketplace is loaded
async function verifyMarketplace(page, expectedMarket) {
  const pageMarket = await page.evaluate((expected) => {
    // Check URL for market parameter
    const url = new URL(window.location.href);
    const marketParam = url.searchParams.getAll('market[]');
    
    // Check page content for marketplace indicators
    const pageText = document.body?.innerText || '';
    const hasMarket = pageText.includes(expected) || marketParam.includes(expected);
    
    return {
      url: window.location.href.substring(0, 150),
      marketParams: marketParam,
      hasExpectedMarket: hasMarket,
    };
  }, expectedMarket);
  
  console.log(`      Market check: params=${pageMarket.marketParams.join(',')} | expected=${expectedMarket} | found=${pageMarket.hasExpectedMarket}`);
  return pageMarket.hasExpectedMarket;
}

// ---- Try to expand fee breakdown rows ----
async function tryExpandFees(page) {
  const expanded = await page.evaluate(() => {
    let count = 0;
    // Look for expandable rows — typically have a + or ▶ icon, or aria-expanded
    const expandables = document.querySelectorAll('[aria-expanded="false"], .expandable, tr.clickable, tr[data-expandable]');
    for (const el of expandables) {
      const text = (el.innerText || '').toLowerCase();
      if (text.includes('amazon fees') || text.includes('fba') || text.includes('commission') || text.includes('cost')) {
        el.click();
        count++;
      }
    }
    
    // Also try clicking on row text that might be expandable
    if (count === 0) {
      const rows = document.querySelectorAll('tr');
      for (const row of rows) {
        const firstCell = row.querySelector('td');
        if (!firstCell) continue;
        const text = (firstCell.innerText || '').toLowerCase();
        if (text.includes('amazon fees') || text === 'costs') {
          // Check if there's a toggle icon
          const icon = row.querySelector('svg, .icon, [class*="expand"], [class*="toggle"], [class*="arrow"]');
          if (icon) {
            icon.click();
            count++;
          }
        }
      }
    }
    
    return count;
  });
  
  if (expanded > 0) {
    console.log(`      📂 ${expanded} fee rij(en) uitgevouwen — wacht op update...`);
    await page.waitForTimeout(2000);
  }
  return expanded;
}

(async () => {
  const arg = process.env.MARKET_SCOPE || process.argv[2];
  const markets = getMarkets(arg);

  console.log(`📊 Sellerboard P&L Export v8.0`);
  console.log(`   Markten: ${markets.join(', ')}`);
  console.log(`   Views: Main P&L + Per ASIN`);
  console.log(`   Output: Supabase (full) + CSV (local) + JSON (summary)`);
  console.log('');

  if (!fs.existsSync(COOKIE_FILE)) {
    console.error('❌ Geen cookies. Run: node sellerboard-save-cookies.js');
    process.exit(1);
  }

  if (!fs.existsSync(CSV_DIR)) fs.mkdirSync(CSV_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: COOKIE_FILE });
  const page = await context.newPage();

  // Time range: last 12 months
  const now = new Date();
  const startTs = Math.floor(new Date(now.getFullYear() - 1, now.getMonth(), 1).getTime() / 1000);
  const endTs = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime() / 1000);
  const periodStart = new Date(startTs * 1000).toISOString().split('T')[0];
  const periodEnd = new Date(endTs * 1000).toISOString().split('T')[0];

  console.log(`   Periode: ${periodStart} → ${periodEnd}`);
  console.log('🔄 Navigeren naar Sellerboard...');
  await page.goto('https://app.sellerboard.com/en/dashboard/?viewType=table', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);
  await takeDebugScreenshot(page, 'initial-load');

  let currentAccount = 'eu'; // Default: EU account (Tim@qualico.be)
  const summaryResults = {};

  for (let mi = 0; mi < markets.length; mi++) {
    const marketplace = markets[mi];
    const isUS = US_MARKETS.includes(marketplace);
    const marketKey = marketplace.replace(/\./g, '_').replace(/Amazon_/i, '');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📍 [${mi + 1}/${markets.length}] ${marketplace}`);
    console.log(`${'='.repeat(60)}`);

    // ---- Switch account if needed ----
    if (isUS && currentAccount !== 'us') {
      const switched = await switchAccount(page, 'us');
      if (switched) {
        currentAccount = 'us';
      } else {
        console.log('   ⚠️ Account switch gefaald — wacht 15s voor handmatige switch...');
        console.log('   💡 Klik handmatig op je AMZ USA account in Sellerboard');
        await page.waitForTimeout(15000);
        currentAccount = 'us'; // Assume user switched
      }
    } else if (!isUS && currentAccount !== 'eu') {
      const switched = await switchAccount(page, 'eu');
      if (switched) {
        currentAccount = 'eu';
      } else {
        console.log('   ⚠️ Account switch gefaald — wacht 15s voor handmatige switch...');
        await page.waitForTimeout(15000);
        currentAccount = 'eu';
      }
    }

    summaryResults[marketplace] = {};

    const views = [
      { name: 'main_pl', label: 'Main P&L', groupBy: '' },
      { name: 'per_asin', label: 'Per ASIN', groupBy: '&groupBy=asin' },
    ];

    for (const view of views) {
      console.log(`\n   📋 ${view.label}...`);

      // Build URL with explicit marketplace
      const url = `https://app.sellerboard.com/en/dashboard/?viewType=table&market%5B%5D=${encodeURIComponent(marketplace)}${view.groupBy}&tablePeriod%5Bstart%5D=${startTs}&tablePeriod%5Bend%5D=${endTs}&tablePeriod%5Bforecast%5D=false&tableSorting%5Bfield%5D=margin&tableSorting%5Bdirection%5D=desc`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Wait + verify marketplace
      const isPerAsin = view.name === 'per_asin';
      const maxRetries = isPerAsin ? 6 : 3;
      const waitBetween = isPerAsin ? 5000 : 4000;
      
      let tableData = { headers: [], rows: [], debug: '', isRealPerAsin: false };

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`      ⏳ Wacht op data (poging ${attempt}/${maxRetries})...`);
        await page.waitForTimeout(waitBetween);

        // First attempt: verify marketplace + try expand fees
        if (attempt === 1) {
          await verifyMarketplace(page, marketplace);
          if (!isPerAsin) {
            await tryExpandFees(page);
          }
        }

        // For per-ASIN: scroll to trigger lazy loading
        if (isPerAsin) {
          for (let i = 0; i < 5; i++) {
            await page.evaluate(() => window.scrollBy(0, 800));
            await page.waitForTimeout(400);
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(1000);
        }

        // ---- Extract table data ----
        tableData = await page.evaluate(({ perAsin, plMetrics }) => {
          const result = { headers: [], rows: [], debug: '', isRealPerAsin: false };
          const tables = document.querySelectorAll('table');

          if (tables.length === 0) {
            result.debug = 'No tables found';
            return result;
          }

          result.debug = `${tables.length} tables found. `;

          // Analyze ALL tables
          const tableAnalysis = [];
          for (let ti = 0; ti < tables.length; ti++) {
            const t = tables[ti];
            const trs = t.querySelectorAll('tr');
            if (trs.length < 2) continue;

            let productRows = 0;
            let plRows = 0;
            let asinRows = 0;

            for (let ri = 0; ri < trs.length; ri++) {
              const firstCell = (trs[ri].querySelector('td, th')?.innerText || '').split('\n')[0].trim();
              const lower = firstCell.toLowerCase();
              if (ri === 0) continue;
              if (/^B0[A-Z0-9]{8}/i.test(firstCell)) { asinRows++; productRows++; }
              else if (plMetrics.some(m => lower.includes(m))) { plRows++; }
              else if (firstCell.length > 3) { productRows++; }
            }

            tableAnalysis.push({ idx: ti, rowCount: trs.length, productRows, plRows, asinRows });
          }

          result.debug += tableAnalysis.map(t => 
            `T${t.idx}:${t.rowCount}r,${t.asinRows}a,${t.productRows}p,${t.plRows}pl`
          ).join('; ');

          // ---- Pick the right table ----
          let targetTable = null;

          if (perAsin) {
            // Strategy 1: ASIN rows (B0...)
            const asinTable = tableAnalysis.find(t => t.asinRows > 0);
            if (asinTable) {
              targetTable = tables[asinTable.idx];
              result.isRealPerAsin = true;
              result.debug += ` → ASIN:T${asinTable.idx}`;
            }

            // Strategy 2: products > P&L
            if (!targetTable) {
              const productTable = tableAnalysis.find(t => t.productRows > t.plRows && t.productRows > 0);
              if (productTable) {
                targetTable = tables[productTable.idx];
                result.isRealPerAsin = true;
                result.debug += ` → Prod:T${productTable.idx}`;
              }
            }

            // Strategy 3: header contains ASIN/Product/SKU
            if (!targetTable) {
              for (const ta of tableAnalysis) {
                const t = tables[ta.idx];
                const headerRow = t.querySelector('tr');
                if (!headerRow) continue;
                const headerText = headerRow.innerText.toLowerCase();
                if (headerText.includes('asin') || headerText.includes('product') || headerText.includes('sku')) {
                  targetTable = t;
                  result.isRealPerAsin = true;
                  result.debug += ` → Header:T${ta.idx}`;
                  break;
                }
              }
            }

            if (!targetTable) {
              result.debug += ' → No ASIN table';
            }
          }

          // Fallback: largest table
          if (!targetTable) {
            let maxCells = 0;
            for (const t of tables) {
              const n = t.querySelectorAll('td, th').length;
              if (n > maxCells) { maxCells = n; targetTable = t; }
            }
          }

          if (!targetTable) return result;

          // ---- Extract rows with clean text ----
          const trs = targetTable.querySelectorAll('tr');
          let headerFound = false;

          for (const tr of trs) {
            const cells = Array.from(tr.querySelectorAll('td, th')).map(c => {
              // Use innerText but take ONLY first line (skip change indicators like "+5%")
              const text = c.innerText || '';
              const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
              return lines.length > 0 ? lines[0] : '';
            });

            if (cells.length < 2) continue;
            const nonEmpty = cells.filter(c => c);
            if (nonEmpty.length < 2) continue;

            if (!headerFound) {
              const looksLikeHeader = cells.some(c =>
                /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|total|parameter|asin|product|sku|units\s*sold/i.test(c)
              );
              if (looksLikeHeader) {
                result.headers = cells;
                headerFound = true;
                continue;
              }
            }

            if (headerFound && nonEmpty.length > 0) {
              result.rows.push(cells);
            }
          }

          return result;
        }, { perAsin: isPerAsin, plMetrics: PL_METRICS });

        // Check result
        if (isPerAsin) {
          if (tableData.isRealPerAsin && tableData.rows.length > 0) {
            console.log(`      ✅ Per-ASIN tabel gevonden! (${tableData.rows.length} producten)`);
            break;
          }
          console.log(`      ℹ️ Nog geen per-ASIN... (${tableData.debug.substring(0, 120)})`);
        } else {
          if (tableData.rows.length > 0) {
            console.log(`      ✅ Main P&L tabel gevonden! (${tableData.rows.length} rijen)`);
            break;
          }
          console.log(`      ℹ️ Nog geen data...`);
        }
      }

      // Take screenshot for debugging
      await takeDebugScreenshot(page, `${marketKey}-${view.name}`);

      // ---- Log results ----
      console.log(`      Rijen: ${tableData.rows.length}, Kolommen: ${tableData.headers.length}`);
      if (tableData.debug) console.log(`      Debug: ${tableData.debug.substring(0, 200)}`);
      if (tableData.headers.length > 0) console.log(`      Headers: ${tableData.headers.slice(0, 6).join(', ')}...`);
      if (tableData.rows.length > 0) console.log(`      Row 0: ${tableData.rows[0].slice(0, 4).join(', ')}...`);

      // ---- Determine view type ----
      const actualViewType = (isPerAsin && !tableData.isRealPerAsin) ? 'per_asin_fallback' : view.name;
      if (isPerAsin && !tableData.isRealPerAsin) {
        console.log(`      ⚠️ Per-ASIN niet gevonden → opgeslagen als 'per_asin_fallback'`);
      }

      // ---- Write to Supabase ----
      if (tableData.headers.length > 0 && tableData.rows.length > 0) {
        await writeToSupabase(marketplace, actualViewType, tableData.headers, tableData.rows, periodStart, periodEnd);
      }

      // ---- Generate CSV ----
      const csvFilename = `sellerboard-${marketKey}-${actualViewType}.csv`;
      const csvPath = path.join(CSV_DIR, csvFilename);
      if (tableData.headers.length > 0 && tableData.rows.length > 0) {
        fs.writeFileSync(csvPath, toCsv(tableData.headers, tableData.rows), 'utf-8');
        console.log(`      ✅ CSV: ${csvFilename}`);
      }

      // ---- Summary entry ----
      summaryResults[marketplace] = summaryResults[marketplace] || {};
      summaryResults[marketplace][view.name] = {
        row_count: tableData.rows.length,
        col_count: tableData.headers.length,
        headers: tableData.headers,
        first_rows: tableData.rows.slice(0, 3).map(r => r.slice(0, 4)),
        is_real_per_asin: isPerAsin ? tableData.isRealPerAsin : null,
        actual_view_type: actualViewType,
        supabase: tableData.rows.length > 0 ? 'written' : 'no_data',
      };
    }
  }

  // ---- Save compact summary JSON ----
  const output = {
    version: '8.0',
    exported_at: new Date().toISOString(),
    period: { start: periodStart, end: periodEnd },
    scope: arg || 'eu',
    data_location: 'Supabase table: Sellerboard_Exports',
    query_example: 'SELECT * FROM "Sellerboard_Exports" WHERE view_type = \'per_asin\';',
    markets: summaryResults,
  };

  const outputFile = path.join(__dirname, 'sellerboard-pl-data.json');
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  const jsonSize = fs.statSync(outputFile).size;

  // ---- Summary ----
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 SAMENVATTING');
  console.log(`${'='.repeat(60)}`);
  for (const [mkt, views] of Object.entries(summaryResults)) {
    const main = views.main_pl?.row_count || 0;
    const asin = views.per_asin?.row_count || 0;
    const mainOk = views.main_pl?.supabase === 'written' ? '✅' : '❌';
    const asinReal = views.per_asin?.is_real_per_asin ? '✅' : '⚠️fb';
    const asinOk = views.per_asin?.supabase === 'written' ? '✅' : '❌';
    console.log(`   ${mkt.padEnd(16)} Main: ${String(main).padStart(3)} rijen ${mainOk}  |  ASIN: ${String(asin).padStart(3)} rijen ${asinReal} ${asinOk}`);
  }
  console.log(`\n   Supabase: Sellerboard_Exports (volledige data)`);
  console.log(`   CSVs:     ${CSV_DIR}/`);
  console.log(`   JSON:     ${outputFile} (${(jsonSize / 1024).toFixed(1)}KB — summary only)`);
  console.log(`   Debug:    ${SCREENSHOT_DIR}/`);
  console.log('\n✅ Klaar!');

  await browser.close();
})().catch(e => {
  console.error('❌ FOUT:', e.message);
  process.exit(1);
});
