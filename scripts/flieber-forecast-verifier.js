/**
 * flieber-forecast-verifier.js v2.2 — Export Flieber forecast CSV and compare against Supabase
 *
 * KNOWN CSV FORMAT (confirmed from real export 2026-04-14):
 *   - Columns: Product Code, Product Name, Store, Tier, Forecast Model, Currency, Status,
 *     Manually Adjusted On, many (-)NM/ND columns, then (+)1M through (+)12M Total Units Sold
 *   - (+)1M = next month from today, (+)2M = +2 months, etc.
 *   - Store values: "Amazon EU", "Amazon USA", "Amazon UK", "Amazon CA", "Bol", "Puzzlup"
 *   - Product Code = EAN/barcode (e.g. "5419980047489")
 *
 * Flow:
 *   1. Login to Flieber
 *   2. Go to sales-forecast (all stores, monthly view)
 *   3. Click "Export data" → "Export table data" → download CSV
 *   4. Parse CSV
 *   5. Query Supabase for product mapping + forecasts
 *   6. Compare (+)1M...(+)12M against Supabase months
 *   7. Report to Flieber_Debug_Log
 */

const { chromium } = require('playwright-core');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const FLIEBER_URL = 'https://app.flieber.com/app/sales-forecast?period=FULL&interval=month&is_pro=true';
const RUN_ID = `verify_${Date.now()}`;

// Store name → channel_id mapping (confirmed)
const STORE_CHANNEL_MAP = {
  'Amazon EU': 35,
  'Amazon USA': 30,
  'Amazon UK': 32,
  'Amazon CA': 31,
  'Bol': 33,
  'Puzzlup': 36,
};

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function dbLog(step, status, message) {
  try {
    await supabase.from('Flieber_Debug_Log').insert({
      step, status, message: String(message).substring(0, 2000),
      run_id: RUN_ID,
    });
  } catch (e) { console.error('dbLog error:', e.message); }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Calculate target month from (+)NM offset
 * (+)1M from April 2026 = May 2026 = "2026-05-01"
 */
function offsetToMonth(offsetN) {
  const now = new Date();
  const targetMonth = now.getMonth() + offsetN; // 0-based
  const targetYear = now.getFullYear() + Math.floor(targetMonth / 12);
  const m = ((targetMonth % 12) + 12) % 12; // handle wrap
  const mm = String(m + 1).padStart(2, '0');
  return `${targetYear}-${mm}-01`;
}

// ── LOGIN ────────────────────────────────────────────────────────────────────

async function login(page) {
  await dbLog('login', 'info', 'Navigating to Flieber...');
  await page.goto('https://app.flieber.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const { data: creds } = await supabase
    .from('Browser_Credentials')
    .select('username, password')
    .eq('key', 'flieber_login')
    .single();

  if (!creds) throw new Error('No flieber_login credentials found');

  await page.waitForSelector('input[type="email"], input[name="email"], input[type="text"]', { timeout: 60000 });
  await dbLog('login', 'info', 'Login form visible');

  await page.fill('input[type="email"], input[name="email"], input[type="text"]', creds.username);
  await sleep(500);
  await page.fill('input[type="password"]', creds.password);
  await sleep(500);
  await page.locator('button:has-text("Continue"), button[type="submit"]').filter({ visible: true }).first().click({ timeout: 30000 });

  await page.waitForURL('**app.flieber.com/app/**', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000); // Let SPA settle
  await dbLog('login', 'success', 'Logged in ✅');
}

// ── SELECT ALL STORES ────────────────────────────────────────────────────────
// Uses the PROVEN approach from flieber-forecast-updater.js

async function selectAllStores(page) {
  await dbLog('select-all', 'info', 'Waiting 8s for SPA to settle...');
  await sleep(8000);

  // Step 1: Check if already showing all stores
  const filterBtn = page.getByText(/regions.*channels|all regions/i).first();
  const filterVisible = await filterBtn.isVisible({ timeout: 5000 }).catch(() => false);
  
  if (!filterVisible) {
    await dbLog('select-all', 'warning', 'Filter button not found — taking screenshot');
    await dbShot(page, 'select-all-no-filter', 'Could not find filter button');
    // Try alternate: maybe the page shows a different text
    const altBtn = page.locator('button').filter({ hasText: /region|channel|store|amazon|bol/i }).first();
    const altVisible = await altBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (altVisible) {
      const altText = await altBtn.textContent().catch(() => '?');
      await dbLog('select-all', 'info', `Found alternate filter: "${altText}"`);
    }
    throw new Error('Could not find store filter button');
  }

  const filterText = await filterBtn.textContent().catch(() => '');
  await dbLog('select-all', 'info', `Current filter: "${filterText}"`);

  if (filterText.toLowerCase().includes('all regions')) {
    await dbLog('select-all', 'success', 'Already showing all stores ✅');
    return;
  }

  // Step 2: Open the filter dropdown
  await filterBtn.click({ timeout: 10000, force: true });
  await sleep(2000);
  await dbLog('select-all', 'info', 'Filter dropdown opened');
  await dbShot(page, 'select-all-dropdown', 'Filter dropdown opened');

  // Step 3: Click "Stores >" submenu
  const storesMenu = page.getByText(/^stores$/i).first();
  const storesVisible = await storesMenu.isVisible({ timeout: 5000 }).catch(() => false);
  if (storesVisible) {
    await storesMenu.click({ timeout: 5000 });
    await sleep(1000);
    await dbLog('select-all', 'info', 'Clicked Stores submenu');
  } else {
    await dbLog('select-all', 'info', 'No Stores submenu — may be flat list');
  }

  // Step 4: Check ALL stores individually (proven approach)
  const ALL_STORES = ['Amazon CA', 'Amazon EU', 'Amazon UK', 'Amazon USA', 'Bol', 'Puzzlup'];
  
  for (const store of ALL_STORES) {
    const storeRow = page.locator('label, li, div[role="option"]').filter({ hasText: new RegExp(`^${store}$`) }).first();
    const isVisible = await storeRow.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isVisible) {
      await dbLog('select-all', 'warning', `Store "${store}" not visible`);
      continue;
    }

    const isChecked = await storeRow.evaluate(el => {
      const cb = el.querySelector('input[type="checkbox"]');
      if (cb) return cb.checked;
      return el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-checked') !== null;
    }).catch(() => null);

    if (isChecked === false || isChecked === null) {
      await storeRow.click({ timeout: 5000 }).catch(async (e) => {
        await dbLog('select-all', 'warning', `Could not click ${store}: ${e.message}`);
      });
      await sleep(300);
      await dbLog('select-all', 'info', `Checked "${store}"`);
    } else {
      await dbLog('select-all', 'info', `"${store}" already checked ✅`);
    }
  }

  await sleep(500);
  await dbShot(page, 'select-all-all-checked', 'All stores checked');

  // Step 5: Click Apply
  const enabledApply = page.locator('button:not([disabled])').filter({ hasText: /^apply$/i }).first();
  const applyVisible = await enabledApply.isVisible({ timeout: 5000 }).catch(() => false);
  
  if (applyVisible) {
    await enabledApply.click({ timeout: 5000 });
    await sleep(3000);
    await dbLog('select-all', 'success', 'Clicked Apply — all stores selected');
  } else {
    // Close dropdown with Escape
    await page.keyboard.press('Escape');
    await sleep(2000);
    await dbLog('select-all', 'info', 'No Apply button — closed with Escape');
  }

  // Verify
  const newText = await filterBtn.textContent().catch(() => '');
  await dbLog('select-all', 'success', `Filter after select: "${newText}"`);
}

// ── EXPORT CSV ───────────────────────────────────────────────────────────────

async function exportCSV(page) {
  await dbLog('export', 'info', 'Looking for Export button...');

  // The "Export data" button might be at the bottom or inside a menu
  const exportBtn = page.locator('button:has-text("Export data")').first();
  await exportBtn.scrollIntoViewIfNeeded({ timeout: 15000 });
  await sleep(1000);
  await exportBtn.click({ timeout: 10000 });
  await sleep(2000);
  await dbLog('export', 'info', 'Clicked "Export data"');

  // Set up download listener BEFORE clicking "Export table data"
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  
  const exportTableBtn = page.locator('text=/Export table data/i, button:has-text("Export table data")').first();
  await exportTableBtn.click({ timeout: 10000 });
  await dbLog('export', 'info', 'Clicked "Export table data" — waiting for download...');

  const download = await downloadPromise;
  const downloadPath = path.join(__dirname, `flieber-export-${Date.now()}.csv`);
  await download.saveAs(downloadPath);

  const fileSize = fs.statSync(downloadPath).size;
  await dbLog('export', 'success', `CSV downloaded: ${(fileSize / 1024).toFixed(1)} KB`);
  return downloadPath;
}

// ── PARSE CSV ────────────────────────────────────────────────────────────────

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');

  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (vals[idx] || '').trim(); });
    rows.push(row);
  }

  console.log(`📊 Parsed ${rows.length} rows, ${headers.length} columns`);
  return { headers: headers.map(h => h.trim()), rows };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── COMPARE WITH SUPABASE ────────────────────────────────────────────────────

async function compareWithSupabase(csvData) {
  await dbLog('compare', 'info', `Starting comparison: ${csvData.rows.length} CSV rows, ${csvData.headers.length} columns`);

  // ─── Step 1: Detect (+)NM Total Units Sold columns ─────────
  const monthColumns = {}; // { offset_number: column_name }
  for (const h of csvData.headers) {
    const match = h.match(/^\(\+\)(\d+)M Total Units Sold$/);
    if (match) {
      monthColumns[parseInt(match[1])] = h;
    }
  }

  const offsets = Object.keys(monthColumns).map(Number).sort((a, b) => a - b);
  await dbLog('compare', 'info', `Found ${offsets.length} forecast month columns: ${offsets.map(n => `(+)${n}M`).join(', ')}`);

  if (offsets.length === 0) {
    // Fallback: log all column names containing (+) for diagnosis
    const plusCols = csvData.headers.filter(h => h.includes('(+)'));
    await dbLog('compare', 'error', `No (+)NM columns found! Plus columns: ${plusCols.join(' | ')}`);
    return { matches: 0, mismatches: 0, skipped: 0, missing: 0, errors: ['No month columns detected'] };
  }

  // ─── Step 2: Map offsets to actual months ─────────
  const offsetToMonthMap = {};
  for (const n of offsets) {
    offsetToMonthMap[n] = offsetToMonth(n);
  }
  await dbLog('compare', 'info', `Month mapping: ${offsets.map(n => `(+)${n}M → ${offsetToMonthMap[n]}`).join(', ')}`);

  // ─── Step 3: Load product mapping from Supabase ─────────
  const { data: skuMap, error: skuErr } = await supabase
    .from('flieber_product_skus')
    .select('product_id, channel_id, flieber_product_name, flieber_product_code');

  if (skuErr || !skuMap) {
    await dbLog('compare', 'error', `Failed to load SKU map: ${skuErr?.message}`);
    return { matches: 0, mismatches: 0, skipped: 0, missing: 0, errors: [skuErr?.message] };
  }

  // Build lookup: flieber_product_code + channel_id → product_id
  const codeLookup = {};   // "barcode_channelId" → product_id
  const nameLookup = {};   // "productName_channelId" → product_id
  for (const s of skuMap) {
    if (s.flieber_product_code) {
      codeLookup[`${s.flieber_product_code}_${s.channel_id}`] = s.product_id;
    }
    if (s.flieber_product_name) {
      nameLookup[`${s.flieber_product_name.toLowerCase()}_${s.channel_id}`] = s.product_id;
    }
  }

  await dbLog('compare', 'info', `Loaded ${skuMap.length} SKU mappings (${Object.keys(codeLookup).length} by code, ${Object.keys(nameLookup).length} by name)`);

  // ─── Step 4: Load ALL forecasts from Supabase ─────────
  const { data: forecasts, error: fcErr } = await supabase
    .from('Puzzlup_sales_Forecast')
    .select('product_id, channel_id, forecast_month, units_forecast');

  if (fcErr || !forecasts) {
    await dbLog('compare', 'error', `Failed to load forecasts: ${fcErr?.message}`);
    return { matches: 0, mismatches: 0, skipped: 0, missing: 0, errors: [fcErr?.message] };
  }

  // Build lookup: "productId_channelId_2026-05-01" → units_forecast
  const forecastLookup = {};
  for (const f of forecasts) {
    forecastLookup[`${f.product_id}_${f.channel_id}_${f.forecast_month}`] = f.units_forecast;
  }

  await dbLog('compare', 'info', `Loaded ${forecasts.length} forecast rows from Supabase`);

  // ─── Step 5: Compare each CSV row ─────────
  let matches = 0;
  let mismatches = 0;
  let skipped = 0;
  let missing = 0;
  const mismatchDetails = [];
  const matchSummary = [];

  for (const row of csvData.rows) {
    const productCode = row['Product Code'] || '';
    const productName = row['Product Name'] || '';
    const store = row['Store'] || '';

    // Map store → channel_id
    const channelId = STORE_CHANNEL_MAP[store];
    if (!channelId) {
      skipped++;
      continue;
    }

    // Map product code → product_id (try by code first, then by name)
    let productId = codeLookup[`${productCode}_${channelId}`];
    if (!productId) {
      productId = nameLookup[`${productName.toLowerCase()}_${channelId}`];
    }
    if (!productId) {
      // Try fuzzy: check if any SKU mapping's product name contains the CSV product name
      for (const s of skuMap) {
        if (s.channel_id === channelId && s.flieber_product_name &&
            s.flieber_product_name.toLowerCase() === productName.toLowerCase()) {
          productId = s.product_id;
          break;
        }
      }
    }
    if (!productId) {
      skipped++;
      await dbLog('compare-skip', 'warning', `No mapping for: ${productName} (${productCode}) / ${store}`);
      continue;
    }

    // Compare each month
    let rowMatches = 0;
    let rowMismatches = 0;
    for (const n of offsets) {
      const colName = monthColumns[n];
      const csvValRaw = row[colName];
      if (!csvValRaw || csvValRaw === '' || csvValRaw === '-') continue;

      const csvVal = parseFloat(csvValRaw);
      if (isNaN(csvVal)) continue;

      const forecastMonth = offsetToMonthMap[n];
      const key = `${productId}_${channelId}_${forecastMonth}`;
      const supaVal = forecastLookup[key];

      if (supaVal === undefined) {
        missing++;
        continue;
      }

      // Allow tolerance of ±2 units (Flieber recalculates from daily averages)
      const diff = Math.abs(Math.round(csvVal) - supaVal);
      if (diff <= 2) {
        matches++;
        rowMatches++;
      } else {
        mismatches++;
        rowMismatches++;
        if (mismatchDetails.length < 100) {
          mismatchDetails.push(
            `${productName} / ${store} / (+)${n}M (${forecastMonth}): Flieber=${csvVal} vs Supabase=${supaVal} (diff=${diff})`
          );
        }
      }
    }

    matchSummary.push(`${productName} / ${store}: ✅${rowMatches} ❌${rowMismatches}`);
  }

  // ─── Step 6: Log results ─────────
  const overallStatus = mismatches === 0 ? 'success' : 'warning';
  const summary = `VERIFICATION RESULTS: ✅ ${matches} matches, ❌ ${mismatches} mismatches, ⏭️ ${skipped} skipped, ❓ ${missing} not-in-supabase`;
  await dbLog('compare-result', overallStatus, summary);

  // Log product-level summary in chunks
  for (let i = 0; i < matchSummary.length; i += 15) {
    const chunk = matchSummary.slice(i, i + 15).join('\n');
    await dbLog('compare-products', 'info', chunk);
  }

  // Log mismatches in detail
  if (mismatchDetails.length > 0) {
    for (let i = 0; i < mismatchDetails.length; i += 10) {
      const chunk = mismatchDetails.slice(i, i + 10).join('\n');
      await dbLog('compare-mismatch', 'warning', chunk);
    }
  }

  return { matches, mismatches, skipped, missing, mismatchDetails };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('🔍 Flieber Forecast Verifier v2.2');
  await dbLog('main', 'info', 'Verifier v2.2 started');

  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--start-maximized'],
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      acceptDownloads: true,
    });
    const page = await context.newPage();

    // Step 1: Login
    await login(page);

    // Step 2: Navigate to sales forecast
    await dbLog('navigate', 'info', 'Navigating to sales forecast...');
    await page.goto(FLIEBER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(8000); // SPA settle time
    await dbLog('navigate', 'success', 'Sales forecast page loaded');

    // Step 3: Ensure all stores selected
    await selectAllStores(page);
    await sleep(3000);

    // Step 4: Export CSV
    const csvPath = await exportCSV(page);

    // Step 5: Parse CSV
    const csvData = parseCSV(csvPath);
    await dbLog('parse', 'success', `Parsed ${csvData.rows.length} rows, ${csvData.headers.length} columns`);

    // Log unique stores found
    const stores = [...new Set(csvData.rows.map(r => r['Store'] || 'unknown'))];
    await dbLog('parse', 'info', `Stores in CSV: ${stores.join(', ')}`);

    // Step 6: Compare with Supabase
    const result = await compareWithSupabase(csvData);

    // Cleanup
    try { fs.unlinkSync(csvPath); } catch (e) {}

    await dbLog('main', result.mismatches > 0 ? 'warning' : 'success',
      `Verification complete! ✅ ${result.matches} matches, ❌ ${result.mismatches} mismatches`);

    console.log(`\n🏁 Done! ✅ ${result.matches} ❌ ${result.mismatches}`);

  } catch (error) {
    console.error(`❌ Fatal: ${error.message}`);
    await dbLog('main', 'error', `Fatal: ${error.message}\n${error.stack?.substring(0, 500)}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
