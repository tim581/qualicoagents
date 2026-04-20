// Sellerboard P&L Export v7.0
// FIX: per-ASIN detection — wait for ASIN table to appear, retry loop, ASIN pattern matching
// FIX: US/CA separate markets — proper account switch with retry
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

// P&L metric keywords — if first cell contains any of these, it's a P&L row (NOT product)
const PL_METRICS = [
  'sales', 'units', 'refund', 'promo', 'ppc', 'cogs', 'cost of goods',
  'profit', 'margin', 'roi', 'fba', 'cost', 'other', 'vat', 'tax',
  'shipping', 'storage', 'disposal', 'estimated payout', 'expenses',
  'reimbursement', 'adjustment', 'organic', 'revenue', 'net profit',
  'gross profit', 'total'
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

// Check if a row looks like a product (ASIN/SKU) rather than a P&L metric
function isProductRow(firstCell) {
  const lower = firstCell.toLowerCase().trim();
  if (!lower || lower.length < 2) return false;
  // Check if it's a known P&L metric
  if (PL_METRICS.some(m => lower.includes(m))) return false;
  // ASIN pattern: starts with B0
  if (/^b0[a-z0-9]{8}/i.test(lower)) return true;
  // SKU pattern: contains dashes/underscores typical of SKUs
  if (/[a-z0-9]+-[a-z0-9]+/i.test(lower) && lower.length > 5) return true;
  // If it's not a P&L metric and has some substance, likely a product
  if (lower.length > 5) return true;
  return false;
}

(async () => {
  const arg = process.env.MARKET_SCOPE || process.argv[2];
  const markets = getMarkets(arg);

  console.log(`📊 Sellerboard P&L Export v7.0`);
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

  console.log('🔄 Navigeren naar Sellerboard...');
  await page.goto('https://app.sellerboard.com/en/dashboard/?viewType=table', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  let currentAccount = 'eu';
  const summaryResults = {};

  for (let mi = 0; mi < markets.length; mi++) {
    const marketplace = markets[mi];
    const isUS = US_MARKETS.includes(marketplace);
    const marketKey = marketplace.replace(/\./g, '_').replace(/Amazon_/i, '');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📍 [${mi + 1}/${markets.length}] ${marketplace}`);
    console.log(`${'='.repeat(60)}`);

    // ---- Switch account if needed ----
    if (isUS && currentAccount === 'eu') {
      console.log('   🔄 Switchen naar AMZ USA account...');
      try {
        // Try clicking account switcher — look for dropdown/selector near top
        // Sellerboard has an account dropdown in the top bar
        const switchSuccess = await page.evaluate(async () => {
          // Look for account switcher elements
          const allElements = document.querySelectorAll('div, span, button, a');
          for (const el of allElements) {
            const text = el.innerText?.trim();
            if (text && (text.includes('Tim@qualico.be') || text.includes('qualico')) && el.offsetParent !== null) {
              el.click();
              return 'clicked-account';
            }
          }
          return 'not-found';
        });
        console.log(`      Account element: ${switchSuccess}`);
        await page.waitForTimeout(2000);

        // Now look for AMZ USA option
        const usOption = await page.evaluate(() => {
          const allElements = document.querySelectorAll('div, span, button, a, li');
          for (const el of allElements) {
            const text = el.innerText?.trim();
            if (text && /amz\s*usa/i.test(text) && el.offsetParent !== null) {
              el.click();
              return 'clicked-usa';
            }
          }
          return 'not-found';
        });
        console.log(`      USA option: ${usOption}`);

        if (usOption === 'clicked-usa') {
          await page.waitForTimeout(5000);
          currentAccount = 'us';
          console.log('   ✅ AMZ USA actief');
        } else {
          console.log('   ⚠️ AMZ USA niet gevonden — probeer handmatige URL...');
          // Navigate with US context — the URL might force it
          await page.waitForTimeout(15000);
          currentAccount = 'us';
        }
      } catch (e) {
        console.log(`   ⚠️ Account switch mislukt: ${e.message.substring(0, 80)}`);
        console.log('   Wacht 15 sec voor handmatige switch...');
        await page.waitForTimeout(15000);
        currentAccount = 'us';
      }
    } else if (!isUS && currentAccount === 'us') {
      console.log('   🔄 Terug naar EU account...');
      try {
        const switchBack = await page.evaluate(() => {
          const allElements = document.querySelectorAll('div, span, button, a');
          for (const el of allElements) {
            const text = el.innerText?.trim();
            if (text && /amz\s*usa/i.test(text) && el.offsetParent !== null) {
              el.click();
              return 'clicked';
            }
          }
          return 'not-found';
        });
        await page.waitForTimeout(2000);

        const euOption = await page.evaluate(() => {
          const allElements = document.querySelectorAll('div, span, button, a, li');
          for (const el of allElements) {
            const text = el.innerText?.trim();
            if (text && /tim@qualico|qualico\.be/i.test(text) && el.offsetParent !== null) {
              el.click();
              return 'clicked-eu';
            }
          }
          return 'not-found';
        });
        console.log(`      EU option: ${euOption}`);

        if (euOption === 'clicked-eu') {
          await page.waitForTimeout(5000);
          currentAccount = 'eu';
          console.log('   ✅ EU account actief');
        }
      } catch (e) {
        console.log(`   ⚠️ Account switch mislukt: ${e.message.substring(0, 80)}`);
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

      const url = `https://app.sellerboard.com/en/dashboard/?viewType=table&market%5B%5D=${encodeURIComponent(marketplace)}${view.groupBy}&tablePeriod%5Bstart%5D=${startTs}&tablePeriod%5Bend%5D=${endTs}&tablePeriod%5Bforecast%5D=false&tableSorting%5Bfield%5D=margin&tableSorting%5Bdirection%5D=desc`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // ---- Wait strategy: retry until correct table appears ----
      const isPerAsin = view.name === 'per_asin';
      let tableData = { headers: [], rows: [], debug: '' };
      const maxRetries = isPerAsin ? 6 : 3; // Per-ASIN gets more retries
      const waitBetween = isPerAsin ? 5000 : 3000;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`      ⏳ Wacht op data (poging ${attempt}/${maxRetries})...`);
        await page.waitForTimeout(waitBetween);

        // For per-ASIN: scroll to trigger lazy loading
        if (isPerAsin) {
          for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollBy(0, 600));
            await page.waitForTimeout(500);
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(1000);
        }

        // ---- Extract table data ----
        tableData = await page.evaluate((perAsin, plMetrics) => {
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
            const sampleCells = [];

            for (let ri = 0; ri < trs.length; ri++) {
              const firstCell = (trs[ri].querySelector('td, th')?.innerText || '').trim();
              const lower = firstCell.toLowerCase();
              sampleCells.push(firstCell.substring(0, 40));

              if (ri === 0) continue; // Skip header

              // Check for ASIN pattern (B0...)
              if (/^B0[A-Z0-9]{8}/i.test(firstCell)) {
                asinRows++;
                productRows++;
              } else if (plMetrics.some(m => lower.includes(m))) {
                plRows++;
              } else if (firstCell.length > 3) {
                productRows++;
              }
            }

            tableAnalysis.push({
              idx: ti,
              rowCount: trs.length,
              productRows,
              plRows,
              asinRows,
              sample: sampleCells.slice(0, 5),
            });
          }

          result.debug += tableAnalysis.map(t => 
            `T${t.idx}:${t.rowCount}rows,${t.asinRows}asins,${t.productRows}prods,${t.plRows}pl`
          ).join('; ');

          // ---- Pick the right table ----
          let targetTable = null;

          if (perAsin) {
            // Strategy 1: Find table with ASIN rows (B0...)
            const asinTable = tableAnalysis.find(t => t.asinRows > 0);
            if (asinTable) {
              targetTable = tables[asinTable.idx];
              result.isRealPerAsin = true;
              result.debug += ` → ASIN table: T${asinTable.idx} (${asinTable.asinRows} ASINs)`;
            }

            // Strategy 2: Find table where products > P&L metrics
            if (!targetTable) {
              const productTable = tableAnalysis.find(t => t.productRows > t.plRows && t.productRows > 0);
              if (productTable) {
                targetTable = tables[productTable.idx];
                result.isRealPerAsin = true;
                result.debug += ` → Product table: T${productTable.idx}`;
              }
            }

            // Strategy 3: Check for table with different headers (ASIN/Product, Units sold, etc.)
            if (!targetTable) {
              for (const t of tables) {
                const headerRow = t.querySelector('tr');
                if (!headerRow) continue;
                const headerText = headerRow.innerText.toLowerCase();
                if (headerText.includes('asin') || headerText.includes('product') || headerText.includes('sku')) {
                  const trs = t.querySelectorAll('tr');
                  if (trs.length > 1) {
                    targetTable = t;
                    result.isRealPerAsin = true;
                    result.debug += ` → Header-match table`;
                    break;
                  }
                }
              }
            }

            if (!targetTable) {
              result.debug += ' → No per-ASIN table found, using largest';
            }
          }

          // Fallback: pick largest table (always for main_pl, fallback for per_asin)
          if (!targetTable) {
            let maxCells = 0;
            for (const t of tables) {
              const n = t.querySelectorAll('td, th').length;
              if (n > maxCells) { maxCells = n; targetTable = t; }
            }
          }

          if (!targetTable) {
            result.debug += ' No target table';
            return result;
          }

          // ---- Extract rows ----
          const trs = targetTable.querySelectorAll('tr');
          let headerFound = false;

          for (const tr of trs) {
            const cells = Array.from(tr.querySelectorAll('td, th')).map(c => {
              const text = c.innerText || '';
              const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
              return lines.length > 0 ? lines[0] : '';
            });

            if (cells.length < 2) continue;
            const nonEmpty = cells.filter(c => c);
            if (nonEmpty.length < 2) continue;

            if (!headerFound) {
              const looksLikeHeader = cells.some(c =>
                /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|total|\d{1,2}[\s-].*\d{4}|parameter|asin|product|sku|units\s*sold/i.test(c)
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
        }, isPerAsin, PL_METRICS);

        // Check if we got valid data
        if (isPerAsin) {
          if (tableData.isRealPerAsin && tableData.rows.length > 0) {
            console.log(`      ✅ Per-ASIN tabel gevonden! (${tableData.rows.length} producten)`);
            break;
          }
          console.log(`      ℹ️ Nog geen per-ASIN tabel... (${tableData.debug.substring(0, 120)})`);
        } else {
          if (tableData.rows.length > 0) {
            console.log(`      ✅ Main P&L tabel gevonden! (${tableData.rows.length} rijen)`);
            break;
          }
          console.log(`      ℹ️ Nog geen data...`);
        }
      }

      // ---- Log results ----
      console.log(`      Rijen: ${tableData.rows.length}, Kolommen: ${tableData.headers.length}`);
      if (tableData.debug) {
        console.log(`      Debug: ${tableData.debug.substring(0, 200)}`);
      }
      if (tableData.headers.length > 0) {
        console.log(`      Headers: ${tableData.headers.slice(0, 5).join(', ')}...`);
      }
      if (tableData.rows.length > 0) {
        console.log(`      Row 0: ${tableData.rows[0].slice(0, 3).join(', ')}...`);
      }

      // ---- Flag if per-ASIN fell back to P&L ----
      const actualViewType = (isPerAsin && !tableData.isRealPerAsin) ? 'per_asin_fallback' : view.name;
      if (isPerAsin && !tableData.isRealPerAsin) {
        console.log(`      ⚠️ Per-ASIN tabel NIET gevonden — fallback naar main P&L data`);
        console.log(`      → Opgeslagen als 'per_asin_fallback' (niet 'per_asin')`);
      }

      // ---- Write FULL data to Supabase ----
      if (tableData.headers.length > 0 && tableData.rows.length > 0) {
        await writeToSupabase(marketplace, actualViewType, tableData.headers, tableData.rows, periodStart, periodEnd);
      }

      // ---- Generate CSV ----
      const csvFilename = `sellerboard-${marketKey}-${actualViewType}.csv`;
      const csvPath = path.join(CSV_DIR, csvFilename);

      if (tableData.headers.length > 0 && tableData.rows.length > 0) {
        const csvContent = toCsv(tableData.headers, tableData.rows);
        fs.writeFileSync(csvPath, csvContent, 'utf-8');
        console.log(`      ✅ CSV: ${csvFilename}`);
      }

      // ---- Compact summary ----
      summaryResults[marketplace] = summaryResults[marketplace] || {};
      summaryResults[marketplace][view.name] = {
        row_count: tableData.rows.length,
        col_count: tableData.headers.length,
        headers: tableData.headers,
        first_rows: tableData.rows.slice(0, 3).map(r => r.slice(0, 3)),
        is_real_per_asin: isPerAsin ? tableData.isRealPerAsin : null,
        actual_view_type: actualViewType,
        supabase: tableData.rows.length > 0 ? 'written' : 'no_data',
      };
    }
  }

  // ---- Save compact summary JSON ----
  const output = {
    version: '7.0',
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
    const mainDb = views.main_pl?.supabase === 'written' ? '✅' : '❌';
    const realAsin = views.per_asin?.is_real_per_asin ? '✅' : '⚠️fallback';
    const asinDb = views.per_asin?.supabase === 'written' ? '✅' : '❌';
    console.log(`   ${mkt.padEnd(16)} Main: ${String(main).padStart(3)} rijen ${mainDb}  |  ASIN: ${String(asin).padStart(3)} rijen ${realAsin} ${asinDb}`);
  }
  console.log(`\n   Supabase: Sellerboard_Exports (volledige data)`);
  console.log(`   CSVs:     ${CSV_DIR}/`);
  console.log(`   JSON:     ${outputFile} (${(jsonSize / 1024).toFixed(1)}KB — summary only)`);
  console.log('\n✅ Klaar!');

  await browser.close();
})().catch(e => {
  console.error('❌ FOUT:', e.message);
  process.exit(1);
});
