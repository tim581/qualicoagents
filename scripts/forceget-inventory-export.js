const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  const context = await browser.newContext({
    storageState: 'forceget-storage-state.json',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  try {
    console.log('1/4 Opening Forceget...');
    await page.goto('https://app.forceget.com', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const url = page.url();
    if (url.includes('login')) {
      console.log('COOKIES VERLOPEN — run forceget-save-cookies.js opnieuw');
      await browser.close();
      process.exit(1);
    }
    console.log('   Ingelogd!');

    // Navigate: Inventory at Forceget WH
    console.log('2/4 Klik Inventory at Forceget WH...');
    try {
      await page.getByText('Inventory at Forceget WH').first().click({ timeout: 10000 });
      await page.waitForTimeout(2000);
    } catch (e) {
      // Try alternative: look for partial match
      await page.locator('text=/Inventory.*Forceget/i').first().click({ timeout: 10000 });
      await page.waitForTimeout(2000);
    }

    // Click Live Inventory
    console.log('3/4 Klik Live Inventory...');
    try {
      await page.getByText('Live Inventory').first().click({ timeout: 10000 });
      await page.waitForTimeout(3000);
    } catch (e) {
      await page.locator('text=/Live.*Inventory/i').first().click({ timeout: 10000 });
      await page.waitForTimeout(3000);
    }

    // Scrape the table
    console.log('4/4 Data uitlezen...');

    // Get total records
    const bodyText = await page.textContent('body');
    const totalMatch = bodyText.match(/Total Records[:\s]*(\d+)/i);
    console.log(`   Totaal records: ${totalMatch ? totalMatch[1] : 'onbekend'}`);

    // Get headers
    const headers = await page.evaluate(() => {
      const table = document.querySelector('table');
      if (!table) return [];
      const ths = table.querySelectorAll('thead th');
      return Array.from(ths).map(th => th.innerText.trim()).filter(h => h !== '');
    });
    console.log('   Headers:', headers.join(' | '));

    // Get all rows
    const rows = await page.evaluate((hdrs) => {
      const table = document.querySelector('table');
      if (!table) return [];
      const data = [];
      const trs = table.querySelectorAll('tbody tr');
      trs.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        const row = {};
        let colIdx = 0;
        cells.forEach((cell) => {
          const text = cell.innerText.trim();
          // Skip checkbox/action columns
          if (cell.querySelector('input[type=checkbox]')) return;
          const key = hdrs[colIdx] || `col_${colIdx}`;
          row[key] = text;
          colIdx++;
        });
        if (Object.keys(row).length > 0 && Object.values(row).some(v => v !== '')) data.push(row);
      });
      return data;
    }, headers);

    console.log(`\n   ${rows.length} producten gevonden:`);
    rows.forEach((row, i) => {
      const sku = row['Sku'] || row['SKU'] || '';
      const name = row['Product Name'] || '';
      const warehouse = row['Warehouse Name'] || '';
      const onHand = row['Stock On Hand Unit'] || '';
      const available = row['Available Unit'] || '';
      console.log(`   ${i + 1}. ${sku} — ${name} — ${warehouse} — OnHand: ${onHand}, Available: ${available}`);
    });

    // Save as JSON
    const outputPath = path.join(__dirname, 'forceget-inventory-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2));
    console.log(`\nData opgeslagen: ${outputPath}`);
    console.log('\nDONE!');

  } catch (err) {
    console.error('FOUT:', err.message);
  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();
