/**
 * inventory-sync-forceget.js v1.0
 * 
 * Playwright script for Forceget warehouse inventory sync.
 * Runs via playwright-task-executor.js
 * 
 * Flow (from Scribe documentation):
 * 1. Navigate to https://app.forceget.com/
 * 2. Login with credentials
 * 3. Click "Inventory at Forceget WH" in sidebar
 * 4. Click "Live Inventory" 
 * 5. Scrape inventory table (SKU, Warehouse, Product Name, Qty)
 * 6. Map products to Puzzlup_Product_Info
 * 7. Write to Inventory_Levels in Supabase
 * 
 * Channels: 3PL US, 3PL CA (Forceget has both US and CA warehouses)
 * 
 * credentials_key: forceget
 * Expected credentials: { username: 'tim@qualico.be', password: '...' }
 */

const SUPABASE_URL = 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsdGVhaHljZm1waWF4ZGJubHZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEwMTY3ODIsImV4cCI6MjA1NjU5Mjc4Mn0.LSAZrrjFnMPMnR9Zx5H17T_Hhy-S7CLFOjRyqGG1CPs';

// Product name mapping: Forceget names → Puzzlup product names and channels
// Forceget uses both US and CA warehouses
const PRODUCT_MAP = {
  // Mats
  'puzzlup 1000': { product_name: 'PUZZLUP MAT 1000', product_id: 1 },
  'puzzlup mat 1000': { product_name: 'PUZZLUP MAT 1000', product_id: 1 },
  'mat 1000': { product_name: 'PUZZLUP MAT 1000', product_id: 1 },
  'puzzlup 1500 eco': { product_name: 'PUZZLUP MAT 1500 ECO', product_id: 2 },
  'mat 1500 eco': { product_name: 'PUZZLUP MAT 1500 ECO', product_id: 2 },
  'puzzlup 1500 gift': { product_name: 'PUZZLUP MAT 1500 GIFT', product_id: 4 },
  'mat 1500 gift': { product_name: 'PUZZLUP MAT 1500 GIFT', product_id: 4 },
  'puzzlup 1500 lux': { product_name: 'PUZZLUP MAT 1500 LUX', product_id: 5 },
  'mat 1500 lux': { product_name: 'PUZZLUP MAT 1500 LUX', product_id: 5 },
  'puzzlup 3000 eco': { product_name: 'PUZZLUP MAT 3000 ECO', product_id: 6 },
  'mat 3000 eco': { product_name: 'PUZZLUP MAT 3000 ECO', product_id: 6 },
  'puzzlup 3000 gift': { product_name: 'PUZZLUP MAT 3000 GIFT', product_id: 7 },
  'mat 3000 gift': { product_name: 'PUZZLUP MAT 3000 GIFT', product_id: 7 },
  'puzzlup 5000 gift': { product_name: 'PUZZLUP MAT 5000 GIFT', product_id: 8 },
  'mat 5000 gift': { product_name: 'PUZZLUP MAT 5000 GIFT', product_id: 8 },
  'puzzlup 1000 gift': { product_name: 'PUZZLUP MAT 1000 GIFT', product_id: 9 },
  'mat 1000 gift': { product_name: 'PUZZLUP MAT 1000 GIFT', product_id: 9 },
  // Trays
  'puzzlup tray 1500': { product_name: 'PUZZLUP TRAYS 1500 BLACK', product_id: 10 },
  'tray 1500': { product_name: 'PUZZLUP TRAYS 1500 BLACK', product_id: 10 },
  'trays 1500 black': { product_name: 'PUZZLUP TRAYS 1500 BLACK', product_id: 10 },
  'puzzlup tray 3000': { product_name: 'PUZZLUP TRAYS 3000 BLACK', product_id: 12 },
  'tray 3000': { product_name: 'PUZZLUP TRAYS 3000 BLACK', product_id: 12 },
  'trays 3000 black': { product_name: 'PUZZLUP TRAYS 3000 BLACK', product_id: 12 },
};

// Warehouse → channel mapping
const WAREHOUSE_CHANNEL = {
  'us': '3PL US',
  'usa': '3PL US',
  'united states': '3PL US',
  'ca': '3PL CA',
  'can': '3PL CA',
  'canada': '3PL CA',
  'los angeles': '3PL US',
  'la': '3PL US',
  'vancouver': '3PL CA',
  'toronto': '3PL CA',
};

function matchProduct(rawName) {
  const lower = rawName.toLowerCase().trim();
  // Try exact match first
  if (PRODUCT_MAP[lower]) return PRODUCT_MAP[lower];
  // Try partial match
  for (const [key, val] of Object.entries(PRODUCT_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return null;
}

function matchWarehouse(rawWarehouse) {
  const lower = rawWarehouse.toLowerCase().trim();
  for (const [key, val] of Object.entries(WAREHOUSE_CHANNEL)) {
    if (lower.includes(key)) return val;
  }
  // Default: if contains 'us' or 'america' → US, else CA
  if (lower.includes('us') || lower.includes('america')) return '3PL US';
  if (lower.includes('ca') || lower.includes('canada')) return '3PL CA';
  return null;
}

module.exports = async function run({ page, credentials, log }) {
  const results = { products: [], errors: [], channel: 'forceget' };
  
  try {
    // Step 1: Navigate to Forceget
    await log('navigate', 'Going to Forceget app...');
    await page.goto('https://app.forceget.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Step 2: Login if needed
    const currentUrl = page.url();
    await log('check_login', `Current URL: ${currentUrl}`);
    
    // Check if we need to login
    const loginForm = await page.$('input[type="email"], input[name="email"], input[type="text"][placeholder*="email" i]');
    if (loginForm) {
      await log('login', 'Login form detected, entering credentials...');
      
      // Try to find email field
      const emailField = await page.$('input[type="email"], input[name="email"], input[type="text"][placeholder*="email" i], input[type="text"][placeholder*="user" i]');
      if (emailField) {
        await emailField.click({ clickCount: 3 });
        await emailField.type(credentials.username || 'tim@qualico.be', { delay: 50 });
      }
      
      // Find password field
      const passField = await page.$('input[type="password"]');
      if (passField) {
        await passField.click({ clickCount: 3 });
        await passField.type(credentials.password, { delay: 50 });
      }
      
      // Click login button
      const loginBtn = await page.$('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in")');
      if (loginBtn) {
        await loginBtn.click();
        await page.waitForTimeout(5000);
        await page.waitForLoadState('networkidle').catch(() => {});
      }
      
      await log('login_done', 'Login submitted, waiting for dashboard...');
      await page.waitForTimeout(3000);
    }
    
    // Step 3: Navigate to Inventory section
    await log('nav_inventory', 'Looking for Inventory at Forceget WH in sidebar...');
    
    // Try multiple selectors for sidebar navigation
    const sidebarSelectors = [
      'text="Inventory at Forceget WH"',
      'text="Inventory"',
      'a:has-text("Inventory")',
      'span:has-text("Inventory")',
      '[class*="sidebar"] >> text="Inventory"',
      'nav >> text="Inventory"',
    ];
    
    let clicked = false;
    for (const sel of sidebarSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          clicked = true;
          await log('sidebar_click', `Clicked: ${sel}`);
          break;
        }
      } catch (e) { /* try next */ }
    }
    
    if (!clicked) {
      // Try by scanning all links/buttons
      const links = await page.$$('a, button, span, div[role="button"]');
      for (const link of links) {
        const text = await link.textContent().catch(() => '');
        if (text && text.toLowerCase().includes('inventory')) {
          await link.click();
          clicked = true;
          await log('sidebar_click_scan', `Clicked element with text: ${text.trim()}`);
          break;
        }
      }
    }
    
    await page.waitForTimeout(3000);
    
    // Step 4: Click "Live Inventory"
    await log('nav_live', 'Looking for Live Inventory button/tab...');
    
    const liveSelectors = [
      'text="Live Inventory"',
      'a:has-text("Live Inventory")',
      'button:has-text("Live Inventory")',
      'span:has-text("Live Inventory")',
      'tab:has-text("Live")',
    ];
    
    clicked = false;
    for (const sel of liveSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          clicked = true;
          await log('live_click', `Clicked: ${sel}`);
          break;
        }
      } catch (e) { /* try next */ }
    }
    
    await page.waitForTimeout(5000);
    await page.waitForLoadState('networkidle').catch(() => {});
    
    // Step 5: Scrape inventory table
    await log('scrape', 'Scraping inventory table...');
    
    // Try to find the table
    const tableData = await page.evaluate(() => {
      const rows = [];
      
      // Method 1: Standard HTML table
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const trs = table.querySelectorAll('tbody tr, tr');
        for (const tr of trs) {
          const cells = tr.querySelectorAll('td');
          if (cells.length >= 3) {
            rows.push({
              cells: Array.from(cells).map(c => c.textContent.trim()),
              cellCount: cells.length
            });
          }
        }
      }
      
      // Method 2: Grid/div-based table (React apps often use this)
      if (rows.length === 0) {
        const gridRows = document.querySelectorAll('[role="row"], [class*="row"], [class*="Row"]');
        for (const row of gridRows) {
          const cells = row.querySelectorAll('[role="cell"], [role="gridcell"], [class*="cell"], [class*="Cell"]');
          if (cells.length >= 3) {
            rows.push({
              cells: Array.from(cells).map(c => c.textContent.trim()),
              cellCount: cells.length
            });
          }
        }
      }
      
      // Also get headers
      const headers = [];
      const ths = document.querySelectorAll('th, [role="columnheader"]');
      for (const th of ths) {
        headers.push(th.textContent.trim());
      }
      
      return { rows, headers, tableCount: tables.length };
    });
    
    await log('table_data', JSON.stringify({
      rowCount: tableData.rows.length,
      headers: tableData.headers,
      tableCount: tableData.tableCount,
      sampleRow: tableData.rows[0] || 'none'
    }));
    
    // Parse inventory data
    // Expected columns: SKU, Warehouse, Product Name, Qty (based on Scribe PDF)
    const inventoryItems = [];
    
    for (const row of tableData.rows) {
      const cells = row.cells;
      if (cells.length < 3) continue;
      
      // Try to identify which column is what
      // Look for a numeric quantity value
      let sku = '', warehouse = '', productName = '', qty = 0;
      
      // Find quantity (numeric column)
      let qtyIdx = -1;
      for (let i = cells.length - 1; i >= 0; i--) {
        const num = parseInt(cells[i].replace(/,/g, ''));
        if (!isNaN(num) && num >= 0) {
          qty = num;
          qtyIdx = i;
          break;
        }
      }
      
      if (qtyIdx === -1) continue; // Skip non-data rows
      
      // Assign remaining columns based on position
      // Typical: SKU | Warehouse | Product Name | Qty
      if (cells.length >= 4) {
        sku = cells[0];
        warehouse = cells[1];
        productName = cells[2];
      } else if (cells.length === 3) {
        sku = cells[0];
        productName = cells[1];
        // No warehouse column — try to detect from SKU or product name
        warehouse = 'unknown';
      }
      
      // Try to match product
      const productMatch = matchProduct(productName) || matchProduct(sku);
      const channel = matchWarehouse(warehouse);
      
      if (productMatch && qty > 0) {
        inventoryItems.push({
          product_name: productMatch.product_name,
          product_id: productMatch.product_id,
          channel: channel || '3PL US', // Default to US if can't determine
          qty: qty,
          raw_sku: sku,
          raw_warehouse: warehouse,
          raw_name: productName
        });
      } else {
        results.errors.push({
          message: `Unmatched: SKU=${sku}, Name=${productName}, WH=${warehouse}, Qty=${qty}`,
          raw: cells
        });
      }
    }
    
    await log('parsed', JSON.stringify({
      matched: inventoryItems.length,
      unmatched: results.errors.length,
      items: inventoryItems
    }));
    
    results.products = inventoryItems;
    
    // Step 6: Write to Supabase Inventory_Levels
    if (inventoryItems.length > 0) {
      await log('write_supabase', `Writing ${inventoryItems.length} items to Inventory_Levels...`);
      
      const now = new Date().toISOString();
      
      for (const item of inventoryItems) {
        try {
          // Upsert: try update first, then insert
          const updateRes = await fetch(
            `${SUPABASE_URL}/rest/v1/Inventory_Levels?product_name=eq.${encodeURIComponent(item.product_name)}&channel=eq.${encodeURIComponent(item.channel)}`,
            {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                units_on_hand: item.qty,
                last_synced_at: now,
                sync_source: 'forceget_playwright'
              })
            }
          );
          
          // If no rows updated, insert
          if (updateRes.status === 200) {
            // Check if any row was actually updated by doing a count
            const checkRes = await fetch(
              `${SUPABASE_URL}/rest/v1/Inventory_Levels?product_name=eq.${encodeURIComponent(item.product_name)}&channel=eq.${encodeURIComponent(item.channel)}&select=id`,
              {
                headers: {
                  'apikey': SUPABASE_KEY,
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                }
              }
            );
            const existing = await checkRes.json();
            
            if (!existing || existing.length === 0) {
              // Insert new row
              await fetch(
                `${SUPABASE_URL}/rest/v1/Inventory_Levels`,
                {
                  method: 'POST',
                  headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                  },
                  body: JSON.stringify({
                    product_name: item.product_name,
                    product_id: item.product_id,
                    channel: item.channel,
                    channel_type: '3PL',
                    units_on_hand: item.qty,
                    last_synced_at: now,
                    sync_source: 'forceget_playwright'
                  })
                }
              );
              await log('inserted', `${item.product_name} (${item.channel}): ${item.qty}`);
            } else {
              await log('updated', `${item.product_name} (${item.channel}): ${item.qty}`);
            }
          }
        } catch (e) {
          results.errors.push({ product: item.product_name, error: e.message });
          await log('write_error', `Failed: ${item.product_name} - ${e.message}`);
        }
      }
      
      await log('write_done', `Wrote ${inventoryItems.length} items to Inventory_Levels`);
    }
    
    // Take final screenshot for verification
    await page.screenshot({ path: '/tmp/forceget-inventory.png', fullPage: true });
    await log('screenshot', 'Final screenshot saved');
    
    results.success = true;
    results.summary = {
      total_products: inventoryItems.length,
      total_units: inventoryItems.reduce((sum, i) => sum + i.qty, 0),
      channels: [...new Set(inventoryItems.map(i => i.channel))],
      synced_at: new Date().toISOString()
    };
    
  } catch (error) {
    results.success = false;
    results.error = error.message;
    await log('error', `Script failed: ${error.message}`);
    
    // Screenshot on error
    try {
      await page.screenshot({ path: '/tmp/forceget-error.png', fullPage: true });
    } catch (e) { /* ignore */ }
  }
  
  return results;
};
