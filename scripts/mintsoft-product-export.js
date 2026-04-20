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
    console.log('1/5 Opening Mintsoft...');
    await page.goto('https://om.mintsoft.co.uk/Product', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const url = page.url();
    if (url.includes('LogOn') || url.includes('login')) {
      console.log('COOKIES VERLOPEN — run mintsoft-save-cookies.js opnieuw');
      await browser.close();
      process.exit(1);
    }
    console.log('   Ingelogd!');

    // Handle cookie popup
    console.log('2/5 Cookie popup checken...');
    try {
      const acceptBtn = await page.locator('text=Accept all').first();
      await acceptBtn.click({ timeout: 3000 });
      console.log('   Cookie popup geaccepteerd');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('   Geen cookie popup');
    }

    // Navigate to Products > Overview
    console.log('3/5 Navigeren naar Products > Overview...');
    await page.click('text=Products');
    await page.waitForTimeout(1500);
    await page.click('text=Overview');
    await page.waitForTimeout(3000);

    // Try to show max records per page
    console.log('4/5 Probeer alle records te tonen...');
    try {
      // Mintsoft typically has a page-size dropdown (10, 25, 50, 100)
      const pageSizeSelect = await page.$('select[name*="length"], select[name*="pageSize"], .dataTables_length select, select.form-control');
      if (pageSizeSelect) {
        // Get all options and pick the largest
        const options = await pageSizeSelect.evaluate(el => {
          return Array.from(el.options).map(o => ({ value: o.value, text: o.text }));
        });
        console.log('   Paginatie opties:', options.map(o => o.text).join(', '));
        const maxOption = options[options.length - 1];
        await pageSizeSelect.selectOption(maxOption.value);
        console.log(`   Geselecteerd: ${maxOption.text} records per pagina`);
        await page.waitForTimeout(3000);
      } else {
        console.log('   Geen page-size dropdown gevonden');
      }
    } catch (e) {
      console.log('   Page-size wijzigen mislukt:', e.message);
    }

    // Scrape data
    console.log('5/5 Data uitlezen...');

    // Get headers
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
      console.log(`   ${rows.length} rijen gevonden (totaal: ${allRows.length})`);

      if (rows.length === 0) break;

      // Look for next page button — try multiple selectors
      let clicked = false;

      // Try: numbered pagination links (2, 3, 4...)
      const nextPageNum = pageNum + 1;
      const selectors = [
        `.paginate_button:not(.disabled):not(.active) a:text("${nextPageNum}")`,
        `a.paginate_button:text("${nextPageNum}")`,
        `.pagination li:not(.disabled):not(.active) a:text("${nextPageNum}")`,
        `a[data-dt-idx="${nextPageNum}"]`,
        '.paginate_button.next:not(.disabled)',
        '.pagination-next:not(.disabled) a',
        'a.next:not(.disabled)',
        'li.next:not(.disabled) a',
        'a[rel="next"]'
      ];

      for (const sel of selectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            const isDisabled = await btn.evaluate(el => {
              return el.classList.contains('disabled') || 
                     el.parentElement?.classList.contains('disabled') ||
                     el.getAttribute('aria-disabled') === 'true';
            });
            if (!isDisabled) {
              await btn.click();
              clicked = true;
              console.log(`   Next page via: ${sel}`);
              break;
            }
          }
        } catch (e) { /* try next selector */ }
      }

      if (!clicked) {
        console.log('   Geen volgende pagina gevonden — klaar');
        break;
      }

      await page.waitForTimeout(2000);
      pageNum++;
    }

    console.log(`\nTOTAAL: ${allRows.length} producten over ${pageNum} pagina(s)`);

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
