// inventory-sync-mintsoft.js v1.2 — UK 3PL (WePrepFBA) inventory sync
// CHANGELOG v1.2: Auto-writes to Inventory_Levels table (no more manual post-processing)
// CHANGELOG v1.1: Initial working version with pagination support
//
// CONFIRMED SELECTORS from browser inspection:
//   - Username: input[name="username"]  (type="text", placeholder="UserName")
//   - Password: input[name="password"]  (type="password", placeholder="Password")
//   - Submit: button with "Sign In" text
//   - Inventory: Product Overview table at /Product/, "Inventory" column = warehouse breakdown
//   - Format: "WarehouseName\nCount\nWarehouseName\nCount"
//   - Main warehouse: WP_Raeburn (our 3PL stock)
//   - 11 products, 2 pages (set pageSize=100 to get all)

const { chromium } = require('playwright-core');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SITE_URL = 'https://om.mintsoft.co.uk/UserAccount/LogOn?ReturnUrl=%2fProduct%2f&signInOptions=false';
const SITE_EMAIL = 'tim@qualico.be';
const SITE_PASSWORD = ':(=efV\\5CzI[-KJYtoHA';
const TASK_ID = process.env.BROWSER_TASK_ID;

const RUN_ID = `mintsoft_inv_${Date.now()}`;

// === SKU MAPPING: Mintsoft product names → Puzzlup product names ===
// Mintsoft uses its own naming. We map to the standard Inventory_Levels product names.
const SKU_MAP = {
  'PUZZLUP 1000 GIFT': { product_name: 'MAT 1000 GIFT',    product_id: 16 },
  'PUZZLUP 1500 GIFT': { product_name: 'MAT 1500 GIFT',    product_id: 12 },
  'PUZZLUP 1500 LUX':  { product_name: 'MAT 1500 LUX',     product_id: 10 },
  'PUZZLUP 3000 GIFT': { product_name: 'MAT 3000 GIFT',     product_id: 2  },
  'PUZZLUP 5000 GIFT': { product_name: 'MAT 5000 GIFT',     product_id: 11 },
  'TRAYS 1500 BLACK':  { product_name: 'TRAYS 1500 BLACK',  product_id: 14 },
  'TRAYS 1500 WHITE':  { product_name: 'TRAYS 1500 WHITE',  product_id: 3  },
  'TRAYS 3000 BLACK':  { product_name: 'TRAYS 3000 BLACK',  product_id: 15 },
  // UK_1500_MAT = FBA-bound stock at Buckle warehouse (not 3PL), skip for now
  // Puzzl_Tray_UK = placeholder SKU with 0 stock, skip
};

async function logDebug(step, status, message, screenshot = null) {
  try {
    await supabase.from('Flieber_Debug_Log').insert({
      run_id: RUN_ID, step, status, message: String(message).slice(0, 2000),
      screenshot: screenshot ? screenshot.toString('base64') : null
    });
  } catch (e) { console.error('  [DB:error]', e.message); }
  const icon = status === 'error' ? '❌' : status === 'success' ? '✅' : 'ℹ️';
  console.log(`  [DB:${status}] ${step}: ${String(message).slice(0, 200)}`);
  if (screenshot) console.log(`  📸 Screenshot → ${step}`);
}

async function run() {
  console.log(`🔍 Debug run ID: ${RUN_ID}`);
  console.log(`   → Query: SELECT * FROM "Flieber_Debug_Log" WHERE run_id = '${RUN_ID}'`);
  console.log(`\n🚀 inventory-sync-mintsoft.js v1.2 starting...`);
  await logDebug('start', 'info', 'Script v1.2 starting');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    // === LOGIN ===
    console.log('\n🔐 Logging in...');
    await logDebug('login', 'info', 'Navigating to site...');
    await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await logDebug('login', 'info', `Current URL: ${page.url()}`);
    let ss = await page.screenshot(); await logDebug('login-page', 'screenshot', 'Initial page load', ss);

    // Fill username
    try {
      await page.fill('input[name="username"]', SITE_EMAIL);
      await logDebug('login', 'info', 'Username filled via input[name="username"]');
    } catch (e) {
      try {
        await page.fill('input[placeholder="UserName"]', SITE_EMAIL);
        await logDebug('login', 'info', 'Username filled via placeholder');
      } catch (e2) {
        await logDebug('login', 'error', `Could not fill username: ${e2.message}`);
      }
    }

    // Fill password using page.evaluate (special chars safe)
    try {
      await page.evaluate((pw) => {
        const el = document.querySelector('input[name="password"]');
        if (el) {
          el.value = pw;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, SITE_PASSWORD);
      await logDebug('login', 'info', 'Password filled via page.evaluate');
    } catch (e) {
      await logDebug('login', 'error', `Could not fill password: ${e.message}`);
    }

    ss = await page.screenshot(); await logDebug('login-filled', 'screenshot', 'Credentials filled', ss);

    // Submit
    try {
      await page.click('button:has-text("Sign In")');
    } catch (e) {
      try { await page.click('input[type="submit"]'); } catch (e2) {
        await page.keyboard.press('Enter');
        await logDebug('login', 'info', 'Pressed Enter as fallback');
      }
    }

    await page.waitForTimeout(5000);
    await logDebug('login', page.url().includes('LogOn') ? 'error' : 'success', `Post-login URL: ${page.url()}`);
    ss = await page.screenshot(); await logDebug('login-done', 'screenshot', 'After login', ss);

    if (page.url().includes('LogOn')) {
      await logDebug('login', 'error', 'Still on login page — authentication failed');
      await writeResult([], browser); return;
    }

    // === NAVIGATE TO PRODUCTS ===
    console.log('\n📦 Loading products...');
    const productUrl = 'https://om.mintsoft.co.uk/Product/?';
    if (!page.url().includes('/Product')) {
      await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30000 });
    }
    await logDebug('products', 'info', `On page: ${page.url()}`);
    await page.waitForTimeout(3000);
    
    // Try to set display count to 100 to avoid pagination
    try {
      const pageSizeSelect = await page.$('select[name*="length"], .dataTables_length select');
      if (pageSizeSelect) {
        await pageSizeSelect.selectOption('100');
        await page.waitForTimeout(3000);
        await logDebug('products', 'info', 'Set page size to 100');
      }
    } catch (e) {
      await logDebug('products', 'info', 'Could not change page size, using default');
    }

    ss = await page.screenshot(); await logDebug('products-loaded', 'screenshot', 'Product page', ss);

    // === EXTRACT DATA ===
    console.log('\n📊 Extracting inventory data...');
    
    const headers = await page.evaluate(() => {
      const ths = document.querySelectorAll('table thead th');
      return Array.from(ths).map((th, i) => ({ index: i, text: th.innerText.trim() }));
    });
    await logDebug('headers', 'info', JSON.stringify(headers));

    // Extract all rows
    const tableData = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      return Array.from(rows).map(row => {
        const cells = row.querySelectorAll('td');
        return Array.from(cells).map(c => c.innerText.trim());
      }).filter(r => r.length > 3);
    });
    await logDebug('table-data', 'info', `Found ${tableData.length} rows on page 1`);

    // Check if there's more pages
    let allExtraData = [];
    let pageNum = 2;
    while (true) {
      try {
        const nextBtn = await page.$(`a:has-text("${pageNum}"), .paginate_button:has-text("${pageNum}")`);
        if (!nextBtn) break;
        await nextBtn.click();
        await page.waitForTimeout(3000);
        const pageData = await page.evaluate(() => {
          const rows = document.querySelectorAll('table tbody tr');
          return Array.from(rows).map(row => {
            const cells = row.querySelectorAll('td');
            return Array.from(cells).map(c => c.innerText.trim());
          }).filter(r => r.length > 3);
        });
        await logDebug('table-data', 'info', `Found ${pageData.length} rows on page ${pageNum}`);
        allExtraData = [...allExtraData, ...pageData];
        pageNum++;
      } catch (e) {
        await logDebug('pagination', 'info', `No page ${pageNum} or error: ${e.message}`);
        break;
      }
    }

    const allData = [...tableData, ...allExtraData];

    // Find column indices
    const skuIdx = headers.findIndex(h => h.text.toLowerCase() === 'sku');
    const nameIdx = headers.findIndex(h => h.text.toLowerCase() === 'name');
    const inventoryIdx = headers.findIndex(h => h.text.toLowerCase() === 'inventory');
    
    await logDebug('columns', 'info', `SKU col=${skuIdx}, Name col=${nameIdx}, Inventory col=${inventoryIdx}`);

    // Parse inventory data — deduplicate by SKU
    const productMap = new Map();
    for (const row of allData) {
      if (row.length <= Math.max(skuIdx, nameIdx, inventoryIdx)) continue;
      
      const sku = skuIdx >= 0 ? row[skuIdx] : '';
      const name = nameIdx >= 0 ? row[nameIdx] : '';
      const inventoryRaw = inventoryIdx >= 0 ? row[inventoryIdx] : '';
      
      // Skip if already seen (pagination duplicates)
      if (productMap.has(sku)) continue;
      
      // Parse warehouse breakdown: "WarehouseName\nCount\nWarehouseName\nCount"
      let totalStock = 0;
      const warehouses = {};
      if (inventoryRaw) {
        const parts = inventoryRaw.split('\n');
        for (let i = 0; i < parts.length - 1; i += 2) {
          const whName = parts[i].trim();
          const whCount = parseInt(parts[i + 1]) || 0;
          warehouses[whName] = whCount;
          totalStock += whCount;
        }
      }

      productMap.set(sku, {
        sku,
        name,
        total_stock: totalStock,
        warehouses,
        wp_raeburn: warehouses['WP_Raeburn'] || 0,
        we_prep_fba: warehouses['We Prep FBA'] || 0
      });
    }

    const products = Array.from(productMap.values());
    await logDebug('results', 'info', `Parsed ${products.length} unique products: ${JSON.stringify(products.map(p => ({sku: p.sku, total: p.total_stock, raeburn: p.wp_raeburn})))}`);

    // === WRITE TO INVENTORY_LEVELS ===
    console.log('\n💾 Writing to Inventory_Levels...');
    let written = 0;
    const now = new Date().toISOString();

    for (const product of products) {
      const mapping = SKU_MAP[product.sku];
      if (!mapping) {
        await logDebug('inventory-write', 'info', `Skipping unmapped SKU: ${product.sku} (${product.wp_raeburn} units)`);
        continue;
      }

      // Only write WP_Raeburn stock (our 3PL inventory)
      const units = product.wp_raeburn;
      
      const { error } = await supabase.from('Inventory_Levels').upsert({
        product_id: mapping.product_id,
        product_name: mapping.product_name,
        channel: '3PL UK',
        channel_type: '3PL',
        units_on_hand: units,
        last_synced_at: now
      }, { onConflict: 'product_id,channel' });

      if (error) {
        await logDebug('inventory-write', 'error', `Failed to write ${mapping.product_name}: ${error.message}`);
      } else {
        written++;
        console.log(`  ✅ ${mapping.product_name}: ${units} units`);
      }
    }

    const totalUnits = products.reduce((s, p) => s + p.wp_raeburn, 0);
    await logDebug('inventory-write', 'success', `Wrote ${written} products to Inventory_Levels (${totalUnits} total units)`);
    console.log(`\n✅ Found ${products.length} products, wrote ${written} to Inventory_Levels (${totalUnits} total units)`);
    await logDebug('complete', 'success', `Finished: ${products.length} products, ${written} written, ${totalUnits} units`);
    ss = await page.screenshot(); await logDebug('complete', 'screenshot', 'Final state', ss);

    await writeResult(products, browser, written);
  } catch (err) {
    await logDebug('fatal', 'error', `${err.message}\n${err.stack}`);
    await writeResult([], browser, 0);
  }
}

async function writeResult(products, browser, writtenCount = 0) {
  if (TASK_ID) {
    try {
      await supabase.from('Browser_Tasks').update({
        result: { 
          products: products.map(p => ({ sku: p.sku, wp_raeburn: p.wp_raeburn, total: p.total_stock })),
          inventory_levels_written: writtenCount,
          run_id: RUN_ID, 
          version: 'v1.2' 
        },
        status: 'done', 
        completed_at: new Date().toISOString()
      }).eq('id', TASK_ID);
      console.log(`✅ Result written to Browser_Tasks id=${TASK_ID}`);
    } catch (e) { console.error('Failed to write result:', e.message); }
  }
  await browser.close();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
