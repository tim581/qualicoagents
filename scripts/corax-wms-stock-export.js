const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  const context = await browser.newContext({
    storageState: 'corax-wms-storage-state.json',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true
  });
  const page = await context.newPage();

  try {
    console.log('1/4 Opening Corax WMS...');
    await page.goto('https://kampspijnacker.coraxwms.nl/#/Dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const url = page.url();
    if (url.includes('login') || url.includes('Login')) {
      console.log('COOKIES VERLOPEN — run corax-wms-save-cookies.js opnieuw');
      await browser.close();
      process.exit(1);
    }
    console.log('   Ingelogd!');

    // Step 1: Click Voorraad
    console.log('2/4 Klik Voorraad...');
    await page.click('text=Voorraad');
    await page.waitForTimeout(1500);

    // Step 2: Click Stocks per artikel
    console.log('3/4 Klik Stocks per artikel...');
    await page.click('text=Stocks per artikel');
    await page.waitForTimeout(4000);

    // Step 3: Scrape ALL data from the table (all pages)
    console.log('4/4 Data uitlezen van pagina...');
    
    let allRows = [];
    let pageNum = 1;
    
    while (true) {
      console.log(`   Pagina ${pageNum} uitlezen...`);
      
      const rows = await page.evaluate(() => {
        const table = document.querySelector('table');
        if (!table) return [];
        const data = [];
        const trs = table.querySelectorAll('tbody tr');
        trs.forEach(tr => {
          const cells = tr.querySelectorAll('td');
          const row = {};
          cells.forEach((cell, i) => {
            row[`col_${i}`] = cell.innerText.trim();
          });
          if (Object.keys(row).length > 0) data.push(row);
        });
        return data;
      });

      // Also get headers on first page
      if (pageNum === 1) {
        const headers = await page.evaluate(() => {
          const table = document.querySelector('table');
          if (!table) return [];
          const ths = table.querySelectorAll('thead th');
          return Array.from(ths).map(th => th.innerText.trim());
        });
        console.log('   Headers:', headers.join(' | '));
      }

      allRows = allRows.concat(rows);
      console.log(`   ${rows.length} rijen gevonden`);

      // Check for next page button
      const nextBtn = await page.$('text=\u203A');
      if (!nextBtn) {
        // Try alternative next page selectors
        const nextBtn2 = await page.$('.pagination-next:not(.disabled)');
        if (!nextBtn2) break;
        await nextBtn2.click();
      } else {
        const isDisabled = await nextBtn.evaluate(el => el.closest('li')?.classList.contains('disabled') || el.disabled);
        if (isDisabled) break;
        await nextBtn.click();
      }
      await page.waitForTimeout(2000);
      pageNum++;
    }

    console.log(`\nTOTAAL: ${allRows.length} artikelen over ${pageNum} pagina(s)`);
    
    // Save scraped data as JSON
    const outputPath = path.join(__dirname, 'corax-stock-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(allRows, null, 2));
    console.log(`Data opgeslagen: ${outputPath}`);

    // Print summary
    allRows.forEach((row, i) => {
      const vals = Object.values(row).join(' | ');
      console.log(`  ${i + 1}. ${vals}`);
    });

    // Also try the XLS export
    console.log('\nBonus: XLS export proberen...');
    await page.click('text=Exporteren');
    await page.waitForTimeout(2000);
    
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.click('text=JA');
    
    try {
      const download = await downloadPromise;
      const fileName = download.suggestedFilename() || 'corax-stock-export.xls';
      const savePath = path.join(__dirname, fileName);
      await download.saveAs(savePath);
      console.log(`XLS opgeslagen: ${savePath}`);
    } catch (e) {
      console.log('XLS download niet gelukt (geen probleem, data is al gescraped)');
    }

    console.log('\nDONE!');

  } catch (err) {
    console.error('FOUT:', err.message);
  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();
