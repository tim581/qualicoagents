/**
 * corax-wms-stock-export.js — v4.0
 * Based on Playwright Codegen recording (Apr 23, 2026)
 * 
 * CRITICAL: Corax shows stock in KOLI (= master cartons), NOT individual units!
 * Must multiply KOLI × units_per_master to get real unit count.
 * 
 * Flow: Microsoft OAuth login → Voorraad → Stocks per artikel → scrape KOLI → convert → write to Inventory_Levels
 */
module.exports = async function({ page, supabase, dbShot, credentials }) {
  const TIMEOUT = 60000;
  
  // KOLI = master cartons. Multiply by units_per_master to get units.
  // Source: Puzzlup_Product_Info table
  const PRODUCT_CONFIG = {
    'PUZZLUP 1000':       { name: 'MAT 1000 GIFT',    upm: 12 },
    'PUZZLUP 1500 ECO':   { name: 'MAT 1500 ECO',     upm: 10 },
    'PUZZLUP 1500 GIFT':  { name: 'MAT 1500 GIFT',    upm: 10 },
    'PUZZLUP 1500 LUX':   { name: 'MAT 1500 LUX',     upm: 10 },
    'PUZZLUP 3000 ECO':   { name: 'MAT 3000 ECO',     upm: 9 },
    'PUZZLUP 3000 GIFT':  { name: 'MAT 3000 GIFT',    upm: 6 },
    'PUZZLUP 5000 GIFT':  { name: 'MAT 5000 GIFT',    upm: 6 },
    'TRAYS 1500 BLACK':   { name: 'TRAYS 1500 BLACK',  upm: 8 },
    'TRAYS 1500 WHITE':   { name: 'TRAYS 1500 WHITE',  upm: 8 },
    'TRAYS 3000 BLACK':   { name: 'TRAYS 3000 BLACK',  upm: 4 },
    // Aliases that may appear in Corax
    '1000 GIFT':          { name: 'MAT 1000 GIFT',    upm: 12 },
    '1500 ECO':           { name: 'MAT 1500 ECO',     upm: 10 },
    '1500 GIFT':          { name: 'MAT 1500 GIFT',    upm: 10 },
    '1500 LUX':           { name: 'MAT 1500 LUX',     upm: 10 },
    '3000 ECO':           { name: 'MAT 3000 ECO',     upm: 9 },
    '3000 GIFT':          { name: 'MAT 3000 GIFT',    upm: 6 },
    '5000 GIFT':          { name: 'MAT 5000 GIFT',    upm: 6 },
  };

  // Helper: find product config from a cell text
  function matchProduct(text) {
    const upper = text.toUpperCase();
    // Try longest keys first for best match
    const keys = Object.keys(PRODUCT_CONFIG).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (upper.includes(key.toUpperCase())) return PRODUCT_CONFIG[key];
    }
    return null;
  }

  try {
    // ─── Step 1: Navigate to Corax (redirects to Microsoft OAuth) ───
    await dbShot?.('step1', 'Navigating to Corax WMS...');
    await page.goto('https://kampspijnacker.coraxwms.nl', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000);
    await dbShot?.('step1_landed', 'On login page');

    // ─── Step 2: Microsoft OAuth Login (exact from Codegen) ───
    const emailField = page.getByRole('textbox', { name: 'someone@coraxwms.nl' });
    await emailField.waitFor({ state: 'visible', timeout: TIMEOUT });
    await emailField.click();
    await emailField.fill(credentials?.username || 'qualico@coraxwms.nl');
    
    await page.getByRole('button', { name: 'Volgende' }).click();
    await page.waitForTimeout(2000);

    const pwField = page.locator('#i0118');
    await pwField.waitFor({ state: 'visible', timeout: TIMEOUT });
    await pwField.click();
    await pwField.fill(credentials?.password || 'GXE.NYeUJX6.f!J');
    
    await page.getByRole('button', { name: 'Aanmelden' }).click();
    await page.waitForTimeout(3000);
    await dbShot?.('step2_login', 'Logged in');

    // Handle "Stay signed in?" prompt
    try {
      const stayBtn = page.getByRole('button', { name: 'Ja' });
      await stayBtn.waitFor({ state: 'visible', timeout: 5000 });
      await stayBtn.click();
    } catch { /* no prompt */ }

    await page.waitForTimeout(5000);
    await dbShot?.('step3_loaded', 'Corax WMS loaded');

    // ─── Step 3: Navigate to Voorraad → Stocks per artikel (exact from Codegen) ───
    await page.getByRole('button', { name: 'Voorraad ' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: 'Stocks per artikel' }).click();
    await page.waitForTimeout(3000);
    await dbShot?.('step3_stocks', 'On Stocks per artikel page');

    // Click expand/show all (from Codegen)
    try {
      await page.locator('.btn-right.ng-scope').click();
      await page.waitForTimeout(2000);
    } catch { /* no expand button */ }

    await dbShot?.('step4_ready', 'Ready to scrape');

    // ─── Step 4: Scrape stock table ───
    // Wait for table to be populated
    await page.waitForSelector('table tbody tr', { timeout: 15000 });
    const rows = await page.locator('table tbody tr').all();
    await dbShot?.('step4_rows', `Found ${rows.length} table rows`);

    const inventory = [];
    for (const row of rows) {
      const cells = await row.locator('td').allTextContents();
      if (cells.length >= 2) {
        inventory.push(cells.map(c => c.trim()));
      }
    }

    // Log first rows for debugging
    await dbShot?.('step4_raw', `First 5 rows: ${JSON.stringify(inventory.slice(0, 5))}`);

    // ─── Step 5: Parse — find product name + KOLI count, convert to units ───
    const parsedItems = [];
    const seen = new Set();

    for (const row of inventory) {
      let product = null;
      let koli = null;

      for (const cell of row) {
        // Try to match product
        if (!product) {
          const match = matchProduct(cell);
          if (match) product = match;
        }
      }

      if (!product) continue;

      // Find the KOLI number — look for numeric cells
      // The KOLI column typically contains the stock count
      for (const cell of row) {
        const cleaned = cell.replace(/[.\s]/g, '').replace(',', '.');
        const num = parseFloat(cleaned);
        if (!isNaN(num) && num >= 0 && num < 100000) {
          koli = Math.round(num);
          break; // Take first numeric value as KOLI count
        }
      }

      if (product && koli !== null && !seen.has(product.name)) {
        seen.add(product.name);
        const units = koli * product.upm;
        parsedItems.push({
          product_name: product.name,
          koli: koli,
          units_per_master: product.upm,
          on_hand: units  // KOLI × units_per_master = actual units
        });
      }
    }

    await dbShot?.('step5_parsed', `Parsed ${parsedItems.length} products: ${JSON.stringify(parsedItems)}`);

    // ─── Step 6: Write to Inventory_Levels ───
    let written = 0;
    if (supabase && parsedItems.length > 0) {
      for (const item of parsedItems) {
        const { error } = await supabase.from('Inventory_Levels').upsert({
          product_name: item.product_name,
          channel_type: '3PL',
          channel: 'Kamps/Vanthiel',
          warehouse: 'Vanthiel Pijnacker',
          region: 'EU',
          on_hand: item.on_hand,  // Already converted: KOLI × units_per_master
          source: 'corax_wms_v4',
          updated_at: new Date().toISOString()
        }, { onConflict: 'product_name,channel,warehouse' });

        if (!error) written++;
        else await dbShot?.('write_err', `${item.product_name}: ${JSON.stringify(error)}`);
      }
    }

    const summary = parsedItems.map(p => `${p.product_name}: ${p.koli} KOLI × ${p.units_per_master} = ${p.on_hand} units`);
    await dbShot?.('done', `Written ${written}/${parsedItems.length}. ${summary.join(', ')}`);

    return {
      success: true,
      source: 'corax_wms_v4',
      warehouse: 'Vanthiel Pijnacker',
      note: 'KOLI (master cartons) converted to units using units_per_master',
      items_written: written,
      products: parsedItems
    };

  } catch (err) {
    await dbShot?.('error', `Fatal: ${err.message}`);
    return { success: false, error: err.message };
  }
};
