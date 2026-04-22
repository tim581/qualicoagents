/**
 * forceget-inventory-export.js v4.0
 * 
 * Follows EXACT PDF guide: "How To Access Live Inventory In Forceget"
 * Step 1: Navigate to https://app.forceget.com/
 * Step 2: Click "Inventory at Forceget WH" in sidebar
 * Step 3: Click "Live Inventory" sub-menu item
 * Step 4: Scrape inventory table + write to Inventory_Levels
 * 
 * Key fixes from v3:
 * - Correct URL (app.forceget.com, NOT 3pl.forceget.com)
 * - Column alignment fix (skip checkbox/# columns)
 * - Writes to Inventory_Levels in Supabase
 */

module.exports = async ({ page, context, supabase, dbShot }) => {
  const FORCEGET_URL = 'https://app.forceget.com';
  const fs = require('fs');
  
  const log = (msg) => console.log(`[Forceget v4] ${msg}`);
  const shot = async (step, msg) => {
    const url = page.url();
    log(`📸 ${step}: ${msg} [URL: ${url}]`);
    if (dbShot) await dbShot(page, step, `${msg} | URL: ${url}`);
  };

  // ── Product name mapping: Forceget display name → Inventory_Levels product_name ──
  // Build mapping from Supabase if available
  let productNameMap = {};
  if (supabase) {
    try {
      const { data: products } = await supabase
        .from('Puzzlup_Product_Info')
        .select('id, sku, product_type');
      if (products) {
        // Map common Forceget display names to our standard names
        products.forEach(p => {
          const name = p.sku || '';
          // Forceget shows names like "Mat 3000 Gift", "Trays 1500 Black"
          // Our product_name in Inventory_Levels uses the full SKU
          productNameMap[name.toLowerCase()] = name;
        });
      }
      log(`Loaded ${Object.keys(productNameMap).length} product mappings`);
    } catch (e) {
      log('Product mapping load failed: ' + e.message);
    }
  }

  // ── STEP 1: Load saved cookies & navigate ──
  const storageStatePath = './forceget-storage-state.json';
  if (fs.existsSync(storageStatePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
      if (state.cookies && state.cookies.length > 0) {
        await context.addCookies(state.cookies);
        log(`Loaded ${state.cookies.length} saved cookies`);
      }
    } catch (e) {
      log('Failed to load cookies: ' + e.message);
    }
  }

  log('STEP 1/4: Navigate to app.forceget.com...');
  await page.goto(FORCEGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  await shot('01-initial', 'Initial page loaded');

  // ── Check if we need to login ──
  const currentUrl = page.url();
  if (currentUrl.includes('login') || currentUrl.includes('Login') || currentUrl.includes('sign-in')) {
    log('Login required...');
    
    let username, password;
    if (supabase) {
      try {
        const { data } = await supabase.from('Browser_Credentials').select('*').eq('key', 'forceget').single();
        if (data) { username = data.username; password = data.password; }
      } catch (e) { log('Credentials lookup failed: ' + e.message); }
    }
    
    if (!username || !password) {
      return { error: 'No credentials available for Forceget login' };
    }
    
    try {
      await page.waitForSelector('input', { timeout: 10000 });
      
      // Angular form — use formcontrolname or type-based selectors
      const emailField = await page.$('input[formcontrolname="email"]') 
        || await page.$('input[type="email"]')
        || await page.$('input[name="email"]')
        || await page.$('input[placeholder*="email" i]')
        || await page.$('input[type="text"]:first-of-type');
      
      if (emailField) {
        await emailField.click();
        await emailField.fill('');
        await emailField.type(username, { delay: 30 });
        // Angular change detection
        await emailField.dispatchEvent('input');
        await emailField.dispatchEvent('change');
        await emailField.dispatchEvent('blur');
        log('Email filled');
      }

      const passField = await page.$('input[type="password"]');
      if (passField) {
        await passField.click();
        await passField.fill('');
        await passField.type(password, { delay: 30 });
        await passField.dispatchEvent('input');
        await passField.dispatchEvent('change');
        await passField.dispatchEvent('blur');
        log('Password filled');
      }

      await shot('02-login-filled', 'Credentials filled');

      // Click submit
      const submitBtn = await page.$('button[type="submit"]')
        || await page.$('button:has-text("Log in")')
        || await page.$('button:has-text("Login")')
        || await page.$('button:has-text("Sign in")');
      
      if (submitBtn) await submitBtn.click();
      
      await page.waitForTimeout(8000);
      await shot('03-after-login', 'After login');
      
      // Save cookies for next time
      const cookies = await context.cookies();
      fs.writeFileSync(storageStatePath, JSON.stringify({ cookies }));
    } catch (loginErr) {
      await shot('login-error', 'Login failed: ' + loginErr.message);
      return { error: 'Login failed: ' + loginErr.message };
    }
  }
  
  log('Logged in to Forceget');

  // ── STEP 2: Click "Inventory at Forceget WH" in sidebar ──
  log('STEP 2/4: Click "Inventory at Forceget WH" in sidebar...');
  
  // Wait for sidebar to render (Angular)
  await page.waitForTimeout(3000);
  
  // Try clicking the sidebar menu item
  let step2Success = false;
  
  // Strategy A: exact text match in sidebar links
  const sidebarSelectors = [
    'text="Inventory at Forceget WH"',
    'text="Inventory At Forceget WH"',
    'text="Inventory at Forceget Wh"',
    'a:has-text("Inventory at Forceget")',
    'span:has-text("Inventory at Forceget")',
    'li:has-text("Inventory at Forceget")',
    '[class*="sidebar"] a:has-text("Inventory")',
    'a[routerlink*="inventory"]',
  ];
  
  for (const sel of sidebarSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        log(`Found sidebar item: "${text.trim()}" via ${sel}`);
        await el.click();
        await page.waitForTimeout(4000);
        step2Success = true;
        await shot('04-inventory-sidebar', `Clicked: ${text.trim()}`);
        break;
      }
    } catch (e) { /* try next */ }
  }
  
  if (!step2Success) {
    // Strategy B: find all sidebar links, log them, pick best match
    const allLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a, [role="menuitem"], li[class*="nav"], span[class*="menu"]'))
        .map(el => ({ text: el.textContent.trim().substring(0, 80), tag: el.tagName }))
        .filter(l => l.text && l.text.length > 2 && l.text.length < 60);
    });
    log('All navigation items: ' + JSON.stringify(allLinks.slice(0, 30)));
    await shot('04-no-inventory-link', 'Could not find Inventory sidebar item');
    
    // Try clicking any link containing "Inventory"
    try {
      const inventoryLink = await page.locator('a, span, li').filter({ hasText: /inventory/i }).first();
      if (inventoryLink) {
        await inventoryLink.click();
        await page.waitForTimeout(4000);
        step2Success = true;
        await shot('04b-inventory-fallback', 'Clicked inventory via locator fallback');
      }
    } catch (e) {
      log('Locator fallback failed: ' + e.message);
    }
  }

  if (!step2Success) {
    return { error: 'Could not find "Inventory at Forceget WH" in sidebar', page_url: page.url() };
  }

  // ── STEP 3: Click "Live Inventory" sub-menu ──
  log('STEP 3/4: Click "Live Inventory" sub-item...');
  await page.waitForTimeout(2000);
  
  let step3Success = false;
  const liveSelectors = [
    'text="Live Inventory"',
    'a:has-text("Live Inventory")',
    'span:has-text("Live Inventory")',
    'li:has-text("Live Inventory")',
    'a[routerlink*="live"]',
  ];
  
  for (const sel of liveSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        log(`Found Live Inventory: "${text.trim()}" via ${sel}`);
        await el.click();
        await page.waitForTimeout(5000);
        step3Success = true;
        await shot('05-live-inventory', `Clicked Live Inventory`);
        break;
      }
    } catch (e) { /* try next */ }
  }
  
  if (!step3Success) {
    // Maybe the sidebar expanded and shows sub-items — try locator
    try {
      await page.locator('a, span, li').filter({ hasText: /live.?inventory/i }).first().click();
      await page.waitForTimeout(5000);
      step3Success = true;
      await shot('05b-live-inventory-fallback', 'Clicked via locator fallback');
    } catch (e) {
      log('Live Inventory not found — maybe already on inventory page');
      await shot('05c-no-live-inventory', 'Live Inventory sub-item not found');
    }
  }

  // ── STEP 4: Scrape the inventory table ──
  log('STEP 4/4: Scraping inventory table...');
  
  // Wait for table to render (Angular lazy loading)
  let tableFound = false;
  for (let attempt = 1; attempt <= 15; attempt++) {
    const hasTable = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      return rows.length;
    });
    log(`Attempt ${attempt}/15: ${hasTable} table rows`);
    if (hasTable > 0) {
      tableFound = true;
      break;
    }
    await page.waitForTimeout(2000);
  }
  
  await shot('06-table-ready', `Table found: ${tableFound}`);
  
  if (!tableFound) {
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
    return { error: 'No inventory table found', page_url: page.url(), body_preview: bodyText.substring(0, 2000) };
  }

  // ── Robust table scraping — handle checkbox/# column offset ──
  const scraped = await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return { headers: [], rows: [] };
    
    // Get ALL th headers — including empty ones for checkbox columns
    const ths = Array.from(table.querySelectorAll('thead th'));
    const rawHeaders = ths.map(th => th.innerText.trim());
    
    // Get all data rows
    const rows = [];
    table.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td'));
      const rawValues = cells.map(td => td.innerText.trim());
      
      // Build object using raw headers
      const row = {};
      rawValues.forEach((val, i) => {
        const header = rawHeaders[i] || `col_${i}`;
        // Skip empty headers (checkbox columns) — use col_N format
        if (header === '' || header === '#') {
          row[`_col_${i}`] = val;
        } else {
          row[header] = val;
        }
      });
      
      // Only include rows that have some real data
      const hasData = Object.entries(row)
        .filter(([k]) => !k.startsWith('_col_'))
        .some(([, v]) => v !== '' && v !== '0');
      if (hasData) rows.push(row);
    });
    
    return { 
      headers: rawHeaders, 
      rows,
      totalRecordsText: document.body.innerText.match(/Total Records?\s*:\s*(\d+)/i)?.[1] || null
    };
  });
  
  log(`Scraped ${scraped.rows.length} rows. Headers: ${JSON.stringify(scraped.headers)}`);
  scraped.rows.forEach((row, i) => {
    log(`  Row ${i+1}: ${JSON.stringify(row)}`);
  });
  
  // ── Parse inventory data from scraped rows ──
  // From PDF, expected columns after checkbox/#:
  // Company Name | Warehouse Name | Sku | Fulfill for | Product Name | Asin | Shopify Sku
  // Plus additional columns to the right for stock quantities
  
  const inventoryItems = scraped.rows.map(row => {
    // Try to extract meaningful fields regardless of header alignment
    // Look for known patterns in values to identify columns
    
    // Find the product name — contains "Mat" or "Tray" 
    let productName = null;
    let warehouseName = null;
    let sku = null;
    let asin = null;
    let stockOnHand = null;
    let allocatedUnit = null;
    let availableUnit = null;
    let inTransit = null;
    let shopifySku = null;
    
    for (const [key, val] of Object.entries(row)) {
      if (key.startsWith('_col_')) continue; // skip checkbox/# columns
      const v = String(val).trim();
      const k = key.toLowerCase();
      
      // Direct header matches (when headers align correctly)
      if (k === 'product name' || k === 'productname') productName = v;
      else if (k === 'warehouse name' || k === 'warehousename') warehouseName = v;
      else if (k === 'sku') sku = v;
      else if (k === 'asin') asin = v;
      else if (k === 'shopify sku' || k === 'shopifysku') shopifySku = v;
      else if (k === 'stock on hand unit' || k === 'stockonhandunit') stockOnHand = parseInt(v) || 0;
      else if (k === 'allocated unit' || k === 'allocatedunit') allocatedUnit = parseInt(v) || 0;
      else if (k === 'available unit' || k === 'availableunit') availableUnit = parseInt(v) || 0;
      else if (k === 'in transit') inTransit = parseInt(v) || 0;
      
      // Pattern-based fallback (when headers are misaligned)
      if (!productName && (v.match(/^(Mat|Tray|Puzzl)/i))) productName = v;
      if (!warehouseName && v.match(/FORCEGET.*WAREHOUSE/i)) warehouseName = v;
      if (!sku && v.match(/^\d{13}$/)) sku = v; // EAN-13 barcode
      if (!asin && v.match(/^B0[A-Z0-9]{8,}$/i)) asin = v; // Amazon ASIN
    }
    
    // Stock: prefer Stock On Hand Unit, fall back to Allocated Unit  
    const stock = stockOnHand ?? allocatedUnit ?? 0;
    
    return {
      product_name: productName,
      warehouse_name: warehouseName,
      sku: sku,
      asin: asin,
      shopify_sku: shopifySku,
      on_hand: stock,
      allocated: allocatedUnit,
      available: availableUnit,
      in_transit: inTransit,
      raw: row // keep raw for debugging
    };
  }).filter(item => item.product_name); // Only keep rows where we identified a product
  
  log(`\nParsed ${inventoryItems.length} inventory items:`);
  inventoryItems.forEach(item => {
    log(`  ${item.product_name}: ${item.on_hand} on-hand (allocated: ${item.allocated}, available: ${item.available})`);
  });

  // ── Write to Inventory_Levels in Supabase ──
  let dbWriteResult = { written: 0, errors: [] };
  
  if (supabase && inventoryItems.length > 0) {
    log('\nWriting to Inventory_Levels...');
    
    // Product name normalization: Forceget "Mat 3000 Gift" → our "PUZZLUP MAT 3000 GIFT"
    // First try to match against existing Inventory_Levels product names
    let existingProducts = [];
    try {
      const { data } = await supabase
        .from('Inventory_Levels')
        .select('product_name')
        .eq('source', 'forceget');
      existingProducts = (data || []).map(d => d.product_name);
    } catch (e) { /* use empty */ }
    
    // Also get all known product names from Puzzlup_Product_Info
    let knownProducts = [];
    try {
      const { data } = await supabase.from('Puzzlup_Product_Info').select('sku');
      knownProducts = (data || []).map(d => d.sku);
    } catch (e) { /* use empty */ }
    
    const normalizeProductName = (fgName) => {
      if (!fgName) return null;
      const cleaned = fgName.trim();
      
      // Try exact match in existing or known products
      const exactMatch = [...existingProducts, ...knownProducts].find(
        p => p.toLowerCase() === cleaned.toLowerCase()
      );
      if (exactMatch) return exactMatch;
      
      // Try partial match — "Mat 3000 Gift" should match "PUZZLUP MAT 3000 GIFT"
      const partial = [...existingProducts, ...knownProducts].find(p => {
        const pLower = p.toLowerCase();
        const cLower = cleaned.toLowerCase();
        return pLower.includes(cLower) || cLower.includes(pLower.replace('puzzlup ', ''));
      });
      if (partial) return partial;
      
      // Fallback: prefix with PUZZLUP and uppercase
      return `PUZZLUP ${cleaned.toUpperCase()}`;
    };
    
    const now = new Date().toISOString();
    
    for (const item of inventoryItems) {
      const productName = normalizeProductName(item.product_name);
      if (!productName) {
        dbWriteResult.errors.push(`No product name for: ${JSON.stringify(item.product_name)}`);
        continue;
      }
      
      // Forceget Toronto = 3PL for both US and CA
      // Write as CA (primary region) — the channel distinguishes
      const record = {
        product_name: productName,
        channel_type: '3PL',
        channel: 'Forceget Toronto',
        warehouse: 'Forceget Toronto',
        region: 'CA',
        on_hand: item.on_hand || 0,
        in_transit: item.in_transit || 0,
        source: 'forceget',
        last_synced_at: now
      };
      
      try {
        // Upsert — match on product_name + channel + warehouse
        const { error } = await supabase
          .from('Inventory_Levels')
          .upsert(record, { 
            onConflict: 'product_name,channel,warehouse',
            ignoreDuplicates: false 
          });
        
        if (error) {
          // If upsert fails (no unique constraint), try update then insert
          log(`Upsert error for ${productName}: ${error.message} — trying update...`);
          const { error: updateErr } = await supabase
            .from('Inventory_Levels')
            .update({ on_hand: record.on_hand, in_transit: record.in_transit, last_synced_at: now })
            .eq('product_name', productName)
            .eq('channel', 'Forceget Toronto')
            .eq('warehouse', 'Forceget Toronto');
          
          if (updateErr) {
            // Insert new row
            const { error: insertErr } = await supabase
              .from('Inventory_Levels')
              .insert(record);
            if (insertErr) {
              dbWriteResult.errors.push(`${productName}: ${insertErr.message}`);
            } else {
              dbWriteResult.written++;
            }
          } else {
            dbWriteResult.written++;
          }
        } else {
          dbWriteResult.written++;
        }
        
        log(`  ✅ ${productName}: ${item.on_hand} units`);
      } catch (e) {
        dbWriteResult.errors.push(`${productName}: ${e.message}`);
        log(`  ❌ ${productName}: ${e.message}`);
      }
    }
    
    log(`\nDB write complete: ${dbWriteResult.written} written, ${dbWriteResult.errors.length} errors`);
  } else if (!supabase) {
    log('No supabase client — skipping DB write');
  }

  return {
    success: true,
    scraped_at: new Date().toISOString(),
    source: 'forceget',
    page_url: page.url(),
    items: inventoryItems.map(({ raw, ...rest }) => rest), // exclude raw debug data from result
    total_products: inventoryItems.length,
    db_write: dbWriteResult,
    headers_found: scraped.headers,
    total_records_on_page: scraped.totalRecordsText
  };
};
