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
    try {
      const acceptBtn = page.locator('text=Accept all').first();
      await acceptBtn.click({ timeout: 3000 });
      console.log('   Cookie popup geaccepteerd');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('   Geen cookie popup');
    }

    // Try to show all records by changing the page size dropdown
    console.log('2/4 Probeer alle records te tonen...');
    try {
      // Look for a select element near the pagination
      const changed = await page.evaluate(() => {
        // Method 1: find select with option 10 selected
        const selects = document.querySelectorAll('select');
        for (const sel of selects) {
          for (const opt of sel.options) {
            if (opt.value === '10' && opt.selected) {
              // Try to set to 100 or highest available
              for (const o of sel.options) {
                if (parseInt(o.value) >= 50) {
                  sel.value = o.value;
                  sel.dispatchEvent(new Event('change', { bubbles: true }));
                  return `Changed to ${o.value}`;
                }
              }
              // Just pick the last option
              const last = sel.options[sel.options.length - 1];
              sel.value = last.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return `Changed to ${last.value}`;
            }
          }
        }
        return null;
      });
      
      if (changed) {
        console.log(`   ${changed}`);
        await page.waitForTimeout(3000);
      } else {
        console.log('   Geen page-size dropdown gevonden, gebruik paginatie');
      }
    } catch (e) {
      console.log('   Dropdown niet gevonden:', e.message);
    }

    // Check record count
    const bodyText = await page.textContent('body');
    const match = bodyText.match(/Displaying \d+ - (\d+) of (\d+) records/);
    const showing = match ? parseInt(match[1]) : 0;
    const totalRecords = match ? parseInt(match[2]) : 0;
    console.log(`   Toont ${showing} van ${totalRecords} records`);

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
    const totalPages = Math.ceil(totalRecords / (showing || 10));

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
          if (Object.keys(row).length > 0 && Object.values(row).some(v => v !== '')) data.push(row);
        });
        return data;
      }, headers);

      allRows = allRows.concat(rows);
      console.log(`   ${rows.length} rijen (totaal: ${allRows.length})`);

      // If we got all records already, stop
      if (allRows.length >= totalRecords) {
        console.log('   Alle records verzameld!');
        break;
      }

      // Try clicking next page number directly
      pageNum++;
      const clicked = await page.evaluate((nextPage) => {
        // Find pagination links — look for the page number
        const links = document.querySelectorAll('a');
        for (const a of links) {
          if (a.textContent.trim() === String(nextPage)) {
            // Make sure it's in pagination area (has nearby page numbers)
            const parent = a.closest('ul, nav, .pagination, .paging');
            if (parent || a.closest('li')) {
              a.click();
              return true;
            }
          }
        }
        // Fallback: click any link with the page number
        for (const a of links) {
          if (a.textContent.trim() === String(nextPage) && a.href && a.href.includes('page')) {
            a.click();
            return true;
          }
        }
        return false;
      }, pageNum);

      if (!clicked) {
        console.log(`   Kon pagina ${pageNum} niet vinden — stoppen`);
        break;
      }

      console.log(`   Navigeren naar pagina ${pageNum}...`);
      await page.waitForTimeout(3000);
    }

    console.log(`\n4/4 TOTAAL: ${allRows.length} producten`);

    // Save as JSON
    const outputPath = path.join(__dirname, 'mintsoft-product-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(allRows, null, 2));
    console.log(`Data opgeslagen: ${outputPath}`);

    // Print summary
    allRows.forEach((row, i) => {
      const sku = row['SKU'] || '';
      const name = row['Name'] || '';
      const inv = row['Inventory'] || '';
      console.log(`  ${i + 1}. ${sku} — ${name} — ${inv}`);
    });

    console.log('\nDONE!');

  } catch (err) {
    console.error('FOUT:', err.message);
  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();
