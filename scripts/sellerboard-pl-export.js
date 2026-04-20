// Sellerboard P&L Export v6.0
// FIX: per-ASIN view now properly scraped (longer wait, scroll, better table detection)
// FIX: HTML cleanup — uses innerText, splits multi-line cells, strips noise
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

// Supabase client
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

// Clean cell text — take primary value, strip noise
function cleanCell(text) {
  if (!text) return '';
  // innerText may have newlines from nested divs — take first meaningful line
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return '';
  // Return first line (primary value) — skip change indicators on subsequent lines
  return lines[0];
}

(async () => {
  const arg = process.env.MARKET_SCOPE || process.argv[2];
  const markets = getMarkets(arg);

  console.log(`📊 Sellerboard P&L Export v6.0`);
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
        const accountBtn = page.locator('[class*="account"], [class*="profile"], [class*="user"], [class*="avatar"]').first();
        await accountBtn.click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        await page.locator('text=AMZ USA').click({ timeout: 5000 });
        await page.waitForTimeout(5000);
        currentAccount = 'us';
        console.log('   ✅ AMZ USA actief');
      } catch (e) {
        console.log(`   ⚠️ Account switch mislukt: ${e.message.substring(0, 80)}`);
        console.log('   Wacht 15 sec voor handmatige switch...');
        await page.waitForTimeout(15000);
        currentAccount = 'us';
      }
    } else if (!isUS && currentAccount === 'us') {
      console.log('   🔄 Terug naar EU account...');
      try {
        const accountBtn = page.locator('[class*="account"], [class*="profile"], [class*="user"], [class*="avatar"]').first();
        await accountBtn.click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        await page.locator('text=Tim@qualico.be').first().click({ timeout: 5000 });
        await page.waitForTimeout(5000);
        currentAccount = 'eu';
        console.log('   ✅ EU account actief');
      } catch (e) {
        console.log(`   ⚠️ Account switch mislukt: ${e.message.substring(0, 80)}`);
        await page.waitForTimeout(15000);
        currentAccount = 'eu';
      }
    }

    summaryResults[marketplace] = {};

    const views = [
      { name: 'main_pl', label: 'Main P&L', groupBy: '', waitTime: 8000 },
      { name: 'per_asin', label: 'Per ASIN', groupBy: '&groupBy=asin', waitTime: 15000 },
    ];

    for (const view of views) {
      console.log(`\n   📋 ${view.label}...`);

      const url = `https://app.sellerboard.com/en/dashboard/?viewType=table&market%5B%5D=${encodeURIComponent(marketplace)}${view.groupBy}&tablePeriod%5Bstart%5D=${startTs}&tablePeriod%5Bend%5D=${endTs}&tablePeriod%5Bforecast%5D=false&tableSorting%5Bfield%5D=margin&tableSorting%5Bdirection%5D=desc`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(view.waitTime);

      // For per-ASIN: scroll down to trigger lazy loading
      if (view.name === 'per_asin') {
        console.log('      Scrolling to load all ASINs...');
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollBy(0, 800));
          await page.waitForTimeout(1000);
        }
        // Scroll back to top
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(2000);
      }

      // ---- Diagnostic: list all tables ----
      const tableDiag = await page.evaluate(() => {
        const tables = document.querySelectorAll('table');
        return Array.from(tables).map((t, i) => {
          const rows = t.querySelectorAll('tr');
          const firstRowText = rows.length > 0 ? rows[0].innerText.substring(0, 120) : '(empty)';
          const secondRowText = rows.length > 1 ? rows[1].innerText.substring(0, 120) : '(empty)';
          return {
            idx: i,
            rows: rows.length,
            cells: t.querySelectorAll('td, th').length,
            firstRow: firstRowText.replace(/\n/g, ' | '),
            secondRow: secondRowText.replace(/\n/g, ' | '),
          };
        });
      });

      console.log(`      📊 Tables found: ${tableDiag.length}`);
      tableDiag.forEach(t => {
        console.log(`         Table ${t.idx}: ${t.rows} rows, ${t.cells} cells`);
        console.log(`           Row 0: ${t.firstRow.substring(0, 100)}`);
        console.log(`           Row 1: ${t.secondRow.substring(0, 100)}`);
      });

      // ---- Scrape table with clean extraction ----
      const tableData = await page.evaluate((isPerAsin) => {
        const result = { headers: [], rows: [], debug: '' };

        const tables = document.querySelectorAll('table');
        if (tables.length === 0) {
          result.debug = 'No tables found';
          return result;
        }

        // Strategy: for per-ASIN, look for a table where rows have ASIN/product data
        // For main P&L, pick the largest table
        let targetTable = null;

        if (isPerAsin) {
          // Per-ASIN table: rows should be products, not P&L metrics
          // Look for table where first column cells look like product names/ASINs
          for (const t of tables) {
            const trs = t.querySelectorAll('tr');
            if (trs.length < 3) continue;
            
            // Check if rows look like products (not P&L metrics like "Sales", "Units", "PPC")
            const plMetrics = ['sales', 'units', 'refund', 'promo', 'ppc', 'cogs', 'profit', 'margin', 'roi', 'fba', 'cost', 'other', 'vat', 'tax'];
            let looksLikeProducts = 0;
            let looksLikePL = 0;
            
            for (let i = 1; i < Math.min(trs.length, 10); i++) {
              const firstCell = (trs[i].querySelector('td, th')?.innerText || '').trim().toLowerCase();
              if (plMetrics.some(m => firstCell.includes(m))) {
                looksLikePL++;
              } else if (firstCell.length > 3) {
                looksLikeProducts++;
              }
            }
            
            result.debug += `Table: ${trs.length} rows, products=${looksLikeProducts}, pl=${looksLikePL}; `;
            
            if (looksLikeProducts > looksLikePL && trs.length > 3) {
              targetTable = t;
              break;
            }
          }
        }

        // Fallback: pick largest table
        if (!targetTable) {
          let maxCells = 0;
          for (const t of tables) {
            const n = t.querySelectorAll('td, th').length;
            if (n > maxCells) { maxCells = n; targetTable = t; }
          }
          result.debug += `Fallback to largest table (${maxCells} cells); `;
        }

        if (!targetTable) {
          result.debug += 'No target table found';
          return result;
        }

        const trs = targetTable.querySelectorAll('tr');
        let headerFound = false;

        for (const tr of trs) {
          const cells = Array.from(tr.querySelectorAll('td, th')).map(c => {
            // Clean extraction: use innerText, take first line only
            const text = c.innerText || '';
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            return lines.length > 0 ? lines[0] : '';
          });
          
          if (cells.length < 2) continue;
          
          // Filter empty cells
          const nonEmpty = cells.filter(c => c);
          if (nonEmpty.length < 2) continue;

          if (!headerFound) {
            // Header detection: has month names, dates, or "Total"
            const looksLikeHeader = cells.some(c =>
              /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|total|\d{1,2}[\s-].*\d{4}/i.test(c)
            );
            // For per-ASIN: header might be "Product", "ASIN", "SKU", etc.
            const looksLikeProductHeader = cells.some(c =>
              /product|asin|sku|item|name/i.test(c)
            );
            
            if (looksLikeHeader || looksLikeProductHeader) {
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
      }, view.name === 'per_asin');

      console.log(`      Rijen: ${tableData.rows.length}, Kolommen: ${tableData.headers.length}`);
      if (tableData.debug) {
        console.log(`      Debug: ${tableData.debug}`);
      }
      if (tableData.headers.length > 0) {
        console.log(`      Headers: ${tableData.headers.slice(0, 5).join(', ')}...`);
      }
      if (tableData.rows.length > 0) {
        console.log(`      First row: ${tableData.rows[0].slice(0, 3).join(', ')}...`);
      }

      // ---- Write FULL data to Supabase ----
      if (tableData.headers.length > 0 && tableData.rows.length > 0) {
        await writeToSupabase(marketplace, view.name, tableData.headers, tableData.rows, periodStart, periodEnd);
      }

      // ---- Generate CSV (local backup) ----
      const csvFilename = `sellerboard-${marketKey}-${view.name}.csv`;
      const csvPath = path.join(CSV_DIR, csvFilename);

      if (tableData.headers.length > 0 && tableData.rows.length > 0) {
        const csvContent = toCsv(tableData.headers, tableData.rows);
        fs.writeFileSync(csvPath, csvContent, 'utf-8');
        console.log(`      ✅ CSV: ${csvFilename}`);
      }

      // ---- Compact summary for Browser_Tasks.result ----
      summaryResults[marketplace][view.name] = {
        row_count: tableData.rows.length,
        col_count: tableData.headers.length,
        headers: tableData.headers,
        first_rows: tableData.rows.slice(0, 3).map(r => r.slice(0, 3)),
        supabase: tableData.rows.length > 0 ? 'written' : 'no_data',
      };
    }
  }

  // ---- Save compact summary JSON ----
  const output = {
    version: '6.0',
    exported_at: new Date().toISOString(),
    period: { start: periodStart, end: periodEnd },
    scope: arg || 'eu',
    data_location: 'Supabase table: Sellerboard_Exports',
    query_example: 'SELECT * FROM "Sellerboard_Exports" WHERE market = \'Amazon.co.uk\' AND view_type = \'per_asin\';',
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
    const asinDb = views.per_asin?.supabase === 'written' ? '✅' : '❌';
    console.log(`   ${mkt.padEnd(16)} Main P&L: ${String(main).padStart(3)} rijen ${mainDb}  |  Per ASIN: ${String(asin).padStart(3)} rijen ${asinDb}`);
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
