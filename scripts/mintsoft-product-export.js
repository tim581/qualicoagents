/**
 * mintsoft-product-export.js — v4.0
 * Based on Playwright Codegen recording (Apr 23, 2026)
 * 
 * CRITICAL FIX: Must click "Customer / Client sign In" before login form appears!
 * Previous versions failed because they skipped this account type selector.
 * 
 * Flow: Login page → Customer sign in → credentials → Products → Overview → scrape all pages → write to Inventory_Levels
 */
module.exports = async function({ page, supabase, dbShot, credentials }) {
  const TIMEOUT = 60000;

  // Product name mapping: Mintsoft name → standard name
  // Mintsoft may use old naming (UK_1500_MAT) or new (PUZZLUP 1500 GIFT)
  const PRODUCT_MAP = {
    'PUZZLUP 1000 GIFT':  'MAT 1000 GIFT',
    'PUZZLUP 1500 ECO':   'MAT 1500 ECO',
    'PUZZLUP 1500 GIFT':  'MAT 1500 GIFT',
    'PUZZLUP 1500 LUX':   'MAT 1500 LUX',
    'PUZZLUP 3000 ECO':   'MAT 3000 ECO',
    'PUZZLUP 3000 GIFT':  'MAT 3000 GIFT',
    'PUZZLUP 5000 GIFT':  'MAT 5000 GIFT',
    'TRAYS 1500 BLACK':   'TRAYS 1500 BLACK',
    'TRAYS 1500 WHITE':   'TRAYS 1500 WHITE',
    'TRAYS 3000 BLACK':   'TRAYS 3000 BLACK',
    // Old naming aliases used in Mintsoft
    'UK_1000_MAT':        'MAT 1000 GIFT',
    'UK_1500_MAT':        'MAT 1500 GIFT',
    'UK_1500_ECO':        'MAT 1500 ECO',
    'UK_1500_LUX':        'MAT 1500 LUX',
    'UK_3000_MAT':        'MAT 3000 GIFT',
    'UK_3000_ECO':        'MAT 3000 ECO',
    'UK_5000_MAT':        'MAT 5000 GIFT',
    'UK_TRAYS_1500_BLACK':'TRAYS 1500 BLACK',
    'UK_TRAYS_1500_WHITE':'TRAYS 1500 WHITE',
    'UK_TRAYS_3000_BLACK':'TRAYS 3000 BLACK',
  };

  function matchProduct(text) {
    const upper = text.toUpperCase().trim();
    // Try exact match first
    for (const [key, mapped] of Object.entries(PRODUCT_MAP)) {
      if (upper.includes(key.toUpperCase())) return mapped;
    }
    return null;
  }

  try {
    // ─── Step 1: Navigate to Mintsoft login ───
    await dbShot?.('step1', 'Navigating to Mintsoft login...');
    await page.goto('https://om.mintsoft.co.uk/UserAccount/LogOn?ReturnUrl=%2fProduct%2f', { 
      waitUntil: 'networkidle', timeout: TIMEOUT 
    });
    await page.waitForTimeout(2000);
    await dbShot?.('step1_landed', 'On login page');

    // ─── Step 2: Click "Customer / Client sign In" (THIS WAS THE MISSING STEP!) ───
    await page.getByRole('link', { name: 'Customer / Client sign In' }).click();
    await page.waitForTimeout(1000);
    await dbShot?.('step2_customer', 'Selected Customer login type');

    // ─── Step 3: Fill credentials (exact from Codegen) ───
    await page.getByRole('textbox', { name: 'UserName' }).click();
    await page.getByRole('textbox', { name: 'UserName' }).fill(credentials?.username || 'Tim@qualico.be');
    
    await page.getByRole('textbox', { name: 'Password' }).click();
    await page.getByRole('textbox', { name: 'Password' }).fill(credentials?.password || ':(=efV\\5CzI[-KJYtoHA');
    
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForTimeout(3000);
    await dbShot?.('step3_login', 'Signed in');

    // ─── Step 4: Navigate to Products → Overview (exact from Codegen) ───
    await page.getByRole('link', { name: ' Products ' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: 'Overview' }).click();
    await page.waitForTimeout(3000);
    await dbShot?.('step4_products', 'On Products Overview page');

    // ─── Step 5: Scrape ALL pages of products ───
    const allProducts = {};  // product_name → total stock
    let pageNum = 1;
    let hasNext = true;

    while (hasNext && pageNum <= 20) {  // Safety limit: max 20 pages
      await dbShot?.(`step5_page${pageNum}`, `Scraping page ${pageNum}...`);
      
      // Wait for table
      try {
        await page.waitForSelector('table tbody tr', { timeout: 10000 });
      } catch {
        await dbShot?.(`step5_no_table_p${pageNum}`, 'No table found on this page');
        break;
      }

      const rows = await page.locator('table tbody tr').all();
      await dbShot?.(`step5_rows_p${pageNum}`, `Page ${pageNum}: ${rows.length} rows`);

      for (const row of rows) {
        const cells = await row.locator('td').allTextContents();
        const cellTexts = cells.map(c => c.trim());
        
        // Find product name in any cell
        let productName = null;
        let stockQty = null;

        for (const cell of cellTexts) {
          const matched = matchProduct(cell);
          if (matched) productName = matched;
        }

        if (!productName) continue;

        // Find stock quantity — look for numeric cells
        // Typically: SKU, Name, ..., Available/In Stock column
        for (let i = cellTexts.length - 1; i >= 0; i--) {
          const cleaned = cellTexts[i].replace(/[,\s]/g, '');
          const num = parseInt(cleaned, 10);
          if (!isNaN(num) && num >= 0 && num < 100000) {
            stockQty = num;
            break;  // Take last (rightmost) valid number as stock
          }
        }

        if (productName && stockQty !== null) {
          // Accumulate (same product might appear under old + new naming)
          allProducts[productName] = (allProducts[productName] || 0) + stockQty;
        }
      }

      // Check if there's a Next page button
      try {
        const nextBtn = page.getByTitle('Next').nth(1);
        const isDisabled = await nextBtn.getAttribute('class');
        if (isDisabled && isDisabled.includes('disabled')) {
          hasNext = false;
        } else {
          await nextBtn.click();
          await page.waitForTimeout(2000);
          pageNum++;
        }
      } catch {
        hasNext = false;  // No next button = last page
      }
    }

    const parsedItems = Object.entries(allProducts).map(([name, qty]) => ({
      product_name: name,
      on_hand: qty
    }));

    await dbShot?.('step5_done', `Total: ${parsedItems.length} products across ${pageNum} pages: ${JSON.stringify(parsedItems)}`);

    // ─── Step 6: Write to Inventory_Levels ───
    let written = 0;
    if (supabase && parsedItems.length > 0) {
      for (const item of parsedItems) {
        const { error } = await supabase.from('Inventory_Levels').upsert({
          product_name: item.product_name,
          channel_type: '3PL',
          channel: 'WePrepFBA',
          warehouse: 'WP_Raeburn',
          region: 'UK',
          on_hand: item.on_hand,
          source: 'mintsoft_v4',
          updated_at: new Date().toISOString()
        }, { onConflict: 'product_name,channel,warehouse' });

        if (!error) written++;
        else await dbShot?.('write_err', `${item.product_name}: ${JSON.stringify(error)}`);
      }
    }

    const summary = parsedItems.map(p => `${p.product_name}: ${p.on_hand}`).join(', ');
    await dbShot?.('done', `Written ${written}/${parsedItems.length}. ${summary}`);

    return {
      success: true,
      source: 'mintsoft_v4',
      warehouse: 'WP_Raeburn',
      pages_scraped: pageNum,
      items_written: written,
      products: parsedItems
    };

  } catch (err) {
    await dbShot?.('error', `Fatal: ${err.message}`);
    return { success: false, error: err.message };
  }
};
