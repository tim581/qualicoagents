// Sellerboard P&L Export v4.0
// Exports BOTH main P&L AND per-ASIN P&L.
// COMPACT summary → JSON (for Browser_Tasks.result)
// FULL data → CSV files (local)
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

const COOKIE_FILE = path.join(__dirname, 'sellerboard-storage-state.json');
const EU_MARKETS = ['Amazon.co.uk', 'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl'];
const US_MARKETS = ['Amazon.com', 'Amazon.ca'];
const ALL_MARKETS = [...EU_MARKETS, ...US_MARKETS];
const CSV_DIR = path.join(__dirname, 'csv-downloads');

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

(async () => {
  const arg = process.env.MARKET_SCOPE || process.argv[2];
  const markets = getMarkets(arg);

  console.log(`📊 Sellerboard P&L Export v4.0`);
  console.log(`   Markten: ${markets.join(', ')}`);
  console.log(`   Views: Main P&L + Per ASIN`);
  console.log(`   Output: Compact JSON (summary) + CSV (full data)`);
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

  console.log('🔄 Navigeren naar Sellerboard...');
  await page.goto('https://app.sellerboard.com/en/dashboard/?viewType=table', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  let currentAccount = 'eu';
  const allResults = {};

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

    allResults[marketplace] = {};

    const views = [
      { name: 'main_pl', label: 'Main P&L', groupBy: '' },
      { name: 'per_asin', label: 'Per ASIN', groupBy: '&groupBy=asin' },
    ];

    for (const view of views) {
      console.log(`\n   📋 ${view.label}...`);

      const url = `https://app.sellerboard.com/en/dashboard/?viewType=table&market%5B%5D=${encodeURIComponent(marketplace)}${view.groupBy}&tablePeriod%5Bstart%5D=${startTs}&tablePeriod%5Bend%5D=${endTs}&tablePeriod%5Bforecast%5D=false&tableSorting%5Bfield%5D=margin&tableSorting%5Bdirection%5D=desc`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(8000);

      // ---- Scrape table ----
      const tableData = await page.evaluate(() => {
        const result = { headers: [], rows: [] };

        let mainTable = null;
        let maxCells = 0;
        document.querySelectorAll('table').forEach(t => {
          const n = t.querySelectorAll('td, th').length;
          if (n > maxCells) { maxCells = n; mainTable = t; }
        });

        if (mainTable) {
          const trs = mainTable.querySelectorAll('tr');
          let headerFound = false;

          trs.forEach(tr => {
            const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.textContent.trim());
            if (cells.length < 2) return;

            if (!headerFound) {
              const looksLikeHeader = cells.some(c =>
                /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|total|\d{1,2}[\s-].*\d{4}/i.test(c)
              );
              if (looksLikeHeader) {
                result.headers = cells.filter(c => c);
                headerFound = true;
                return;
              }
            }

            if (cells[0] && headerFound) {
              result.rows.push(cells);
            }
          });
        }

        return result;
      });

      console.log(`      Rijen: ${tableData.rows.length}, Kolommen: ${tableData.headers.length}`);

      // ---- Generate CSV (FULL data) ----
      const csvFilename = `sellerboard-${marketKey}-${view.name}.csv`;
      const csvPath = path.join(CSV_DIR, csvFilename);

      if (tableData.headers.length > 0 && tableData.rows.length > 0) {
        const csvContent = toCsv(tableData.headers, tableData.rows);
        fs.writeFileSync(csvPath, csvContent, 'utf-8');
        console.log(`      ✅ CSV: ${csvFilename} (${tableData.rows.length} rijen)`);
      } else {
        console.log('      ⚠️ Geen data voor CSV');
      }

      // ---- Build COMPACT summary for JSON (not full rows) ----
      const summary = {
        row_count: tableData.rows.length,
        headers: tableData.headers,
        csv_file: tableData.rows.length > 0 ? csvFilename : null,
      };

      // Include TOTAL row if it exists (last row often = totals)
      if (tableData.rows.length > 0) {
        const lastRow = tableData.rows[tableData.rows.length - 1];
        const firstCell = (lastRow[0] || '').toLowerCase();
        if (firstCell.includes('total') || firstCell.includes('sum') || firstCell === '') {
          summary.totals_row = lastRow;
        }
      }

      // For per_asin: include first 5 rows as preview
      if (view.name === 'per_asin' && tableData.rows.length > 0) {
        summary.preview_rows = tableData.rows.slice(0, 5);
        summary.preview_note = `Showing 5 of ${tableData.rows.length} ASINs. Full data in CSV.`;
      }

      // For main_pl: include ALL rows (they're just metric names, not heavy)
      if (view.name === 'main_pl' && tableData.rows.length > 0) {
        summary.rows = tableData.rows;
      }

      allResults[marketplace][view.name] = summary;
    }
  }

  // ---- Save COMPACT JSON (summary only) ----
  const output = {
    version: '4.0',
    exported_at: new Date().toISOString(),
    period: {
      start: new Date(startTs * 1000).toISOString().split('T')[0],
      end: new Date(endTs * 1000).toISOString().split('T')[0],
    },
    scope: arg || 'eu',
    markets: allResults,
  };

  const outputFile = path.join(__dirname, 'sellerboard-pl-data.json');
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  const jsonSize = fs.statSync(outputFile).size;
  console.log(`\n📦 JSON size: ${(jsonSize / 1024).toFixed(1)}KB`);

  // ---- Summary ----
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 SAMENVATTING');
  console.log(`${'='.repeat(60)}`);
  for (const [mkt, views] of Object.entries(allResults)) {
    const main = views.main_pl?.row_count || 0;
    const asin = views.per_asin?.row_count || 0;
    const mainCsv = views.main_pl?.csv_file ? '✅' : '❌';
    const asinCsv = views.per_asin?.csv_file ? '✅' : '❌';
    console.log(`   ${mkt.padEnd(16)} Main P&L: ${String(main).padStart(3)} rijen ${mainCsv}  |  Per ASIN: ${String(asin).padStart(3)} rijen ${asinCsv}`);
  }
  console.log(`\n   JSON: ${outputFile} (${(jsonSize / 1024).toFixed(1)}KB)`);
  console.log(`   CSVs: ${CSV_DIR}/`);
  console.log('\n✅ Klaar!');

  await browser.close();
})().catch(e => {
  console.error('❌ FOUT:', e.message);
  process.exit(1);
});
