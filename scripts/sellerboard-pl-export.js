// Sellerboard P&L Export v1
// Exports P&L overview data for a given marketplace.
//
// Usage: node sellerboard-pl-export.js [marketplace]
// Default: Amazon.co.uk
//
// EU markets: Amazon.co.uk, Amazon.de, Amazon.fr, Amazon.it, Amazon.es, Amazon.nl
// US markets: Amazon.com, Amazon.ca (switches to AMZ USA account)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, 'sellerboard-storage-state.json');
const US_MARKETS = ['Amazon.com', 'Amazon.ca'];

(async () => {
  const marketplace = process.argv[2] || 'Amazon.co.uk';
  const isUS = US_MARKETS.includes(marketplace);

  console.log(`📊 Sellerboard P&L Export — ${marketplace}`);
  console.log(`   Account: ${isUS ? 'AMZ USA' : 'Tim@qualico.be (EU)'}`);

  if (!fs.existsSync(COOKIE_FILE)) {
    console.error('❌ Geen cookies. Run: node sellerboard-save-cookies.js');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: COOKIE_FILE });
  const page = await context.newPage();

  // ---- Step 1: Navigate to dashboard ----
  console.log('1/5 Navigeren naar dashboard...');
  await page.goto('https://app.sellerboard.com/en/dashboard/?viewType=table', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  // ---- Step 2: Switch to US account if needed ----
  if (isUS) {
    console.log('2/5 Switchen naar AMZ USA account...');
    try {
      // Click profile/account area (top-right)
      const profileBtn = page.locator('text=Tim@qualico.be').first();
      if (await profileBtn.isVisible({ timeout: 5000 })) {
        await profileBtn.click();
      } else {
        // Try the user avatar/icon area
        const avatar = page.locator('[class*="avatar"], [class*="profile"], [class*="user-menu"], [class*="account"]').first();
        await avatar.click({ timeout: 5000 });
      }
      await page.waitForTimeout(1500);

      // Click AMZ USA
      await page.locator('text=AMZ USA').click({ timeout: 5000 });
      await page.waitForTimeout(5000);
      console.log('   ✅ AMZ USA account actief');
    } catch (e) {
      console.log(`   ⚠️ Account switch mislukt: ${e.message.substring(0, 80)}`);
      console.log('   Handmatig switchen? Wacht 15 sec...');
      await page.waitForTimeout(15000);
    }
  } else {
    console.log('2/5 EU account (default) — skip');
  }

  // ---- Step 3: Navigate to marketplace with URL params ----
  console.log(`3/5 ${marketplace} data laden...`);
  const now = new Date();
  const startTs = Math.floor(new Date(now.getFullYear() - 1, now.getMonth(), 1).getTime() / 1000);
  const endTs = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime() / 1000);

  // P&L overview URL (no groupBy)
  const plUrl = `https://app.sellerboard.com/en/dashboard/?viewType=table&market%5B%5D=${encodeURIComponent(marketplace)}&tablePeriod%5Bstart%5D=${startTs}&tablePeriod%5Bend%5D=${endTs}&tablePeriod%5Bforecast%5D=false&tableSorting%5Bfield%5D=margin&tableSorting%5Bdirection%5D=desc`;

  await page.goto(plUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  // ---- Step 4: Scrape the P&L table ----
  console.log('4/5 P&L tabel scrapen...');

  const plData = await page.evaluate(() => {
    const result = { months: [], rows: [] };

    // Find the largest table on the page
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

        // Detect header row (contains month/date text)
        if (!headerFound) {
          const looksLikeHeader = cells.some(c =>
            /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}.*\d{4}/i.test(c)
          );
          if (looksLikeHeader) {
            result.months = cells.slice(1).filter(c => c);
            headerFound = true;
            return;
          }
        }

        // Data row
        if (cells[0] && headerFound) {
          const row = { name: cells[0] };
          const vals = cells.slice(1);
          // Map values to month headers
          row.values = {};
          result.months.forEach((m, i) => {
            row.values[m] = vals[i] || '';
          });
          result.rows.push(row);
        }
      });
    }

    // Fallback: capture page text for debugging
    if (result.rows.length === 0) {
      result.debug_text = document.body.innerText.substring(0, 6000);
    }

    return result;
  });

  console.log(`   P&L: ${plData.rows.length} rijen, ${plData.months.length} maanden`);

  // ---- Step 5: Try CSV download ----
  console.log('5/5 CSV downloaden...');
  let csvFile = null;
  try {
    // Based on PDF: click ".CSV" button at top
    const csvBtn = page.locator('text=/.CSV/i').first();
    if (await csvBtn.isVisible({ timeout: 5000 })) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        csvBtn.click(),
      ]);
      csvFile = path.join(__dirname, `sellerboard-${marketplace.replace(/\./g, '-')}.csv`);
      await download.saveAs(csvFile);
      console.log(`   ✅ CSV: ${csvFile}`);
    } else {
      // Try clicking the CSV/export icon from the toolbar
      // PDF shows: Dashboard > Tiles > Chart > P&L > Map > Trends toolbar, then CSV button
      const exportBtns = page.locator('button, a, [role="button"]').filter({ hasText: /csv|export|download/i });
      const count = await exportBtns.count();
      if (count > 0) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 15000 }),
          exportBtns.first().click(),
        ]);
        csvFile = path.join(__dirname, `sellerboard-${marketplace.replace(/\./g, '-')}.csv`);
        await download.saveAs(csvFile);
        console.log(`   ✅ CSV: ${csvFile}`);
      } else {
        console.log('   ⚠️ Geen CSV knop gevonden');
      }
    }
  } catch (e) {
    console.log(`   ⚠️ CSV download mislukt: ${e.message.substring(0, 80)}`);
  }

  // ---- Save results ----
  const output = {
    marketplace,
    account: isUS ? 'AMZ USA' : 'Tim@qualico.be',
    exported_at: new Date().toISOString(),
    period: { start: new Date(startTs * 1000).toISOString(), end: new Date(endTs * 1000).toISOString() },
    months: plData.months,
    pl_rows: plData.rows,
    csv_file: csvFile,
  };

  if (plData.debug_text) output.debug_text = plData.debug_text;

  const outputFile = path.join(__dirname, 'sellerboard-pl-data.json');
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  console.log(`\n✅ Klaar!`);
  console.log(`   Rijen: ${plData.rows.length}`);
  console.log(`   Maanden: ${plData.months.join(', ') || '(check debug)'}`);
  console.log(`   JSON: ${outputFile}`);
  if (csvFile) console.log(`   CSV: ${csvFile}`);

  await browser.close();
})().catch(e => {
  console.error('❌ FOUT:', e.message);
  process.exit(1);
});
