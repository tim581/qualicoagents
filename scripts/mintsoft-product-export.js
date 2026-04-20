const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  const context = await browser.newContext({
    storageState: 'mintsoft-storage-state.json',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  try {
    console.log('1/4 Opening Mintsoft Product Overview...');
    await page.goto('https://om.mintsoft.co.uk/Product', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const url = page.url();
    if (url.includes('LogOn') || url.includes('login')) {
      console.log('COOKIES VERLOPEN — run mintsoft-save-cookies.js opnieuw');
      await browser.close();
      process.exit(1);
    }
    console.log('   Ingelogd!');

    // Handle cookie popup
    console.log('2/4 Cookie popup checken...');
    try {
      const acceptBtn = page.locator('text=Accept all').first();
      await acceptBtn.click({ timeout: 3000 });
      console.log('   Cookie popup geaccepteerd');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('   Geen cookie popup');
    }

    // Check record count
    const recordInfo = await page.textContent('body');
    const match = recordInfo.match(/Displaying \d+ - \d+ of (\d+) records/);
    const totalRecords = match ? parseInt(match[1]) : 'onbekend';
    console.log(`   Totaal records: ${totalRecords}`);

    // Get headers
    console.log('3/4 Data uitlezen...');
    const headers = await page.evaluate(() => {
      const table = document.querySelector('table');
      if (!table) return [];
      const ths = table.querySelectorAll('thead th');
      return Array.from(ths).map(th => th.innerText.trim());
    });
    console.log('   Headers:', headers.join(' | '));

    let allRows = [];
    let pageNum = 1;

    while (true) {
      console.log(`   Pagina ${pageNum} uitlezen...`);

      const rows = await page.evaluate((hdrs) => {
        const table = document.querySelector('table');
        if (!table) return [];
        const data = [];
        const trs = table.querySelectorAll('tbody tr');
        trs.forEach(tr => {
          const cells = tr.querySelectorAll('td');
          const row = {};
          cells.forEach((cell, i) => {
            const key = hdrs[i] || `col_${i}`;
            row[key] = cell.innerText.trim();
          });
          if (Object.keys(row).length > 0) data.push(row);
        });
        return data;
      }, headers);

      allRows = allRows.concat(rows);
      console.log(`   ${rows.length} rijen (totaal: ${allRows.length})`);

      if (rows.length === 0) break;

      // Click the ">" next page button
      // Mintsoft pagination: << < 1 [2] > >>
      const nextBtn = await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const a of links) {
          if (a.textContent.trim() === '›' || a.textContent.trim() === '>') {
            const li = a.closest('li');
            if (li && li.classList.contains('disabled')) return 'disabled';
            return 'found';
          }
        }
        // Also check for "Next" text
        for (const a of links) {
          if (a.textContent.trim().toLowerCase() === 'next') {
            const li = a.closest('li');
            if (li && li.classList.contains('disabled')) return 'disabled';
            return 'found';
          }
        }
        return 'not_found';
      });

      if (nextBtn === 'disabled' || nextBtn === 'not_found') {
        console.log('   Laatste pagina bereikt');
        break;
      }

      // Click the > button
      try {
        await page.evaluate(() => {
          const links = document.querySelectorAll('a');
          for (const a of links) {
            if (a.textContent.trim() === '›' || a.textContent.trim() === '>') {
              const li = a.closest('li');
              if (!li || !li.classList.contains('disabled')) {
                a.click();
                return;
              }
            }
          }
          // Fallback: click "Next"
          for (const a of links) {
            if (a.textContent.trim().toLowerCase() === 'next') {
              a.click();
              return;
            }
          }
        });
        await page.waitForTimeout(3000);
        pageNum++;
      } catch (e) {
        console.log('   Paginatie klik mislukt:', e.message);
        break;
      }
    }

    console.log(`\n4/4 TOTAAL: ${allRows.length} producten over ${pageNum} pagina(s)`);

    // Save as JSON
    const outputPath = path.join(__dirname, 'mintsoft-product-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(allRows, null, 2));
    console.log(`Data opgeslagen: ${outputPath}`);

    // Print summary
    allRows.forEach((row, i) => {
      const vals = Object.values(row).slice(0, 5).join(' | ');
      console.log(`  ${i + 1}. ${vals}`);
    });

    console.log('\nDONE!');

  } catch (err) {
    console.error('FOUT:', err.message);
  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();
