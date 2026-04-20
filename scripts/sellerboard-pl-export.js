// Sellerboard P&L Export v2
// Exports BOTH main P&L AND per-ASIN P&L for all EU markets (or a specific one).
// Also attempts CSV download for each view.
//
// Usage:
//   node sellerboard-pl-export.js              → All EU markets
//   node sellerboard-pl-export.js Amazon.co.uk  → Single market
//   node sellerboard-pl-export.js Amazon.com    → US market (switches account)
//   node sellerboard-pl-export.js all           → All EU + US markets

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, 'sellerboard-storage-state.json');
const EU_MARKETS = ['Amazon.co.uk', 'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl'];
const US_MARKETS = ['Amazon.com', 'Amazon.ca'];
const ALL_MARKETS = [...EU_MARKETS, ...US_MARKETS];

function getMarkets(arg) {
  if (!arg || arg === 'eu') return EU_MARKETS;
  if (arg === 'all') return ALL_MARKETS;
  if (arg === 'us') return US_MARKETS;
  return [arg]; // single market
}

(async () => {
  const arg = process.argv[2];
  const markets = getMarkets(arg);
  const needsUS = markets.some(m => US_MARKETS.includes(m));
  const needsEU = markets.some(m => EU_MARKETS.includes(m));

  console.log(`📊 Sellerboard P&L Export v2`);
  console.log(`   Markten: ${markets.join(', ')}`);
  console.log(`   Views: Main P&L + Per ASIN`);
  console.log(`   CSV: ja (als beschikbaar)`);
  console.log('');

  if (!fs.existsSync(COOKIE_FILE)) {
    console.error('❌ Geen cookies. Run: node sellerboard-save-cookies.js');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: COOKIE_FILE });
  const page = await context.newPage();

  // Time range: last 12 months
  const now = new Date();
  const startTs = Math.floor(new Date(now.getFullYear() - 1, now.getMonth(), 1).getTime() / 1000);
  const endTs = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime() / 1000);

  // Navigate to dashboard first
  console.log('🔄 Navigeren naar Sellerboard...');
  await page.goto('https://app.sellerboard.com/en/dashboard/?viewType=table', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  let currentAccount = 'eu'; // Track which account we're on
  const allResults = {};

  // ---- Process each market ----
  for (let mi = 0; mi < markets.length; mi++) {
    const marketplace = markets[mi];
    const isUS = US_MARKETS.includes(marketplace);
    const marketKey = marketplace.replace(/\./g, '-');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📍 [${mi + 1}/${markets.length}] ${marketplace}`);
    console.log(`${'='.repeat(60)}`);

    // ---- Switch account if needed ----
    if (isUS && currentAccount === 'eu') {
      console.log('   🔄 Switchen naar AMZ USA account...');
      try {
        // Look for account switcher — usually email or company name in top area
        const accountBtn = page.locator('[class*="account"], [class*="profile"], [class*="user"], [class*="avatar"]').first();
        await accountBtn.click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        await page.locator('text=AMZ USA').click({ timeout: 5000 });
        await page.waitForTimeout(5000);
        currentAccount = 'us';
        console.log('   ✅ AMZ USA actief');
      } catch (e) {
        console.log(`   ⚠️ Account switch mislukt: ${e.message.substring(0, 80)}`);
        console.log('   Probeer handmatig te switchen... wacht 15 sec.');
        await page.waitForTimeout(15000);
        currentAccount = 'us';
      }
    } else if (!isUS && currentAccount === 'us') {
      console.log('   🔄 Switchen terug naar EU account...');
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

    // ---- Two views: main P&L and per-ASIN ----
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

        // Find the largest table
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
                /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}.*\d{4}/i.test(c)
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

        if (result.rows.length === 0) {
          result.debug_text = document.body.innerText.substring(0, 4000);
        }

        return result;
      });

      console.log(`      Rijen: ${tableData.rows.length}, Kolommen: ${tableData.headers.length}`);

      // ---- Try CSV download ----
      let csvPath = null;
      try {
        // Approach 1: Look for .CSV text button
        const csvBtn = page.locator('button, a, span, div').filter({ hasText: /^\.?CSV$/i }).first();
        if (await csvBtn.isVisible({ timeout: 3000 })) {
          const downloadDir = path.join(__dirname, 'csv-downloads');
          if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }),
            csvBtn.click(),
          ]);
          csvPath = path.join(downloadDir, `sellerboard-${marketKey}-${view.name}.csv`);
          await download.saveAs(csvPath);
          console.log(`      ✅ CSV: ${csvPath}`);
        } else {
          // Approach 2: Icon-based download button
          const dlBtns = page.locator('[class*="download"], [class*="export"], [class*="csv"], [title*="CSV"], [title*="Export"], [aria-label*="CSV"], [aria-label*="export"]');
          const dlCount = await dlBtns.count();
          if (dlCount > 0) {
            const downloadDir = path.join(__dirname, 'csv-downloads');
            if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 15000 }),
              dlBtns.first().click(),
            ]);
            csvPath = path.join(downloadDir, `sellerboard-${marketKey}-${view.name}.csv`);
            await download.saveAs(csvPath);
            console.log(`      ✅ CSV: ${csvPath}`);
          } else {
            console.log('      ⚠️ Geen CSV knop gevonden — scrape data gebruikt');
          }
        }
      } catch (e) {
        console.log(`      ⚠️ CSV download mislukt: ${e.message.substring(0, 60)}`);
      }

      allResults[marketplace][view.name] = {
        headers: tableData.headers,
        rows: tableData.rows,
        row_count: tableData.rows.length,
        csv_file: csvPath,
      };

      if (tableData.debug_text) {
        allResults[marketplace][view.name].debug_text = tableData.debug_text;
      }
    }
  }

  // ---- Save all results ----
  const output = {
    exported_at: new Date().toISOString(),
    period: {
      start: new Date(startTs * 1000).toISOString().split('T')[0],
      end: new Date(endTs * 1000).toISOString().split('T')[0],
    },
    markets: allResults,
  };

  const outputFile = path.join(__dirname, 'sellerboard-pl-data.json');
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  // ---- Summary ----
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 SAMENVATTING');
  console.log(`${'='.repeat(60)}`);
  for (const [mkt, views] of Object.entries(allResults)) {
    const mainRows = views.main_pl?.row_count || 0;
    const asinRows = views.per_asin?.row_count || 0;
    const mainCsv = views.main_pl?.csv_file ? '✅' : '❌';
    const asinCsv = views.per_asin?.csv_file ? '✅' : '❌';
    console.log(`   ${mkt}: Main P&L ${mainRows} rijen (CSV ${mainCsv}) | Per ASIN ${asinRows} rijen (CSV ${asinCsv})`);
  }
  console.log(`\n   JSON: ${outputFile}`);
  console.log('✅ Klaar!');

  await browser.close();
})().catch(e => {
  console.error('❌ FOUT:', e.message);
  process.exit(1);
});
