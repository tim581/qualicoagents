/**
 * flieber-forecast-verifier.js v1.0 — Export Flieber forecast CSV and compare against Supabase
 *
 * Flow:
 *   1. Login to Flieber
 *   2. Go to sales-forecast (all regions, all channels, all stores)
 *   3. Click "Export data" → "Export table data" → download CSV
 *   4. Parse CSV
 *   5. Query Supabase Puzzlup_sales_Forecast for same products/months
 *   6. Compare and report mismatches to Flieber_Debug_Log
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

// ── LOGIN ────────────────────────────────────────────────────────────────────

async function login(page) {
  await dbLog('login', 'info', 'Navigating to Flieber...');
  await page.goto('https://app.flieber.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Get credentials from Supabase
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

  await page.waitForURL('**app.flieber.com/app/**', { timeout: 60000 });
  await dbLog('login', 'success', 'Logged in ✅');
}

// ── SELECT ALL REGIONS/CHANNELS/STORES ───────────────────────────────────────

async function selectAllStores(page) {
  await dbLog('select-all', 'info', 'Checking if all stores are selected...');

  // The top filter should say "All regions, channels and stores"
  const filterBtn = page.locator('text=/All regions.*channels.*stores|regions.*channels/i').first();
  const filterText = await filterBtn.textContent().catch(() => '');
  
  if (filterText.toLowerCase().includes('all regions')) {
    await dbLog('select-all', 'success', `Already showing all stores: "${filterText}"`);
    return;
  }

  // Need to open filter and select all
  await filterBtn.click({ timeout: 15000 });
  await sleep(1000);

  // Look for "Select all" or similar
  const selectAll = page.locator('text=/select all/i').first();
  if (await selectAll.isVisible({ timeout: 3000 }).catch(() => false)) {
    await selectAll.click();
    await sleep(500);
  }

  // Close the dropdown
  await page.keyboard.press('Escape');
  await sleep(1000);
  await dbLog('select-all', 'success', 'All stores selected');
}

// ── EXPORT CSV ───────────────────────────────────────────────────────────────

async function exportCSV(page) {
  await dbLog('export', 'info', 'Starting CSV export...');

  // Scroll to bottom to find the "Export data" button
  // The button is at the bottom of the page
  const exportBtn = page.locator('button:has-text("Export data")').first();
  
  // Wait for it to be visible (may need to scroll)
  await exportBtn.scrollIntoViewIfNeeded({ timeout: 10000 });
  await sleep(500);

  // Click "Export data" to open the submenu
  await exportBtn.click({ timeout: 10000 });
  await sleep(1000);
  await dbLog('export', 'info', 'Clicked "Export data" button');

  // Now click "Export table data"
  const exportTableBtn = page.locator('text=/Export table data/i').first();
  
  // Set up download listener BEFORE clicking
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  
  await exportTableBtn.click({ timeout: 10000 });
  await dbLog('export', 'info', 'Clicked "Export table data" — waiting for download...');

  // Wait for the download
  const download = await downloadPromise;
  const downloadPath = path.join(__dirname, `flieber-export-${Date.now()}.csv`);
  await download.saveAs(downloadPath);
  
  await dbLog('export', 'success', `CSV downloaded: ${downloadPath}`);
  return downloadPath;
}

// ── PARSE CSV ────────────────────────────────────────────────────────────────

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());
  
  if (lines.length < 2) throw new Error('CSV has no data rows');
  
  // Parse header
  const headers = parseCSVLine(lines[0]);
  console.log(`📊 CSV headers: ${headers.join(', ')}`);
  
  // Parse rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (vals[idx] || '').trim(); });
    rows.push(row);
  }
  
  console.log(`📊 Parsed ${rows.length} rows from CSV`);
  return { headers, rows };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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
  await dbLog('compare', 'info', `Comparing ${csvData.rows.length} CSV rows against Supabase...`);
  
  // Log the headers so we can understand the CSV structure
  await dbLog('compare', 'info', `CSV headers: ${csvData.headers.join(' | ')}`);
  
  // Log first 3 rows as sample
  for (let i = 0; i < Math.min(3, csvData.rows.length); i++) {
    const row = csvData.rows[i];
    const sample = Object.entries(row).map(([k, v]) => `${k}=${v}`).join(', ');
    await dbLog('compare', 'info', `Sample row ${i}: ${sample.substring(0, 1500)}`);
  }

  // Get product mapping from Supabase
  const { data: skuMap } = await supabase
    .from('flieber_product_skus')
    .select('product_id, channel_id, flieber_product_name, flieber_product_code');

  // Get all forecasts from Supabase
  const { data: forecasts } = await supabase
    .from('Puzzlup_sales_Forecast')
    .select('product_id, channel_id, forecast_month, units_forecast');

  if (!skuMap || !forecasts) {
    await dbLog('compare', 'error', 'Could not fetch Supabase data');
    return { matches: 0, mismatches: 0, errors: ['Could not fetch Supabase data'] };
  }

  await dbLog('compare', 'info', `Loaded ${skuMap.length} SKU mappings, ${forecasts.length} forecast rows from Supabase`);

  // Build lookup: product_id + channel_id + month → units_forecast
  const forecastLookup = {};
  for (const f of forecasts) {
    const key = `${f.product_id}_${f.channel_id}_${f.forecast_month}`;
    forecastLookup[key] = f.units_forecast;
  }

  // Build product name → product_id + channel_id lookup
  const productLookup = {};
  for (const s of skuMap) {
    if (s.flieber_product_name) {
      productLookup[s.flieber_product_name] = { product_id: s.product_id, channel_id: s.channel_id };
    }
  }

  // Now try to match CSV rows against Supabase
  // CSV structure depends on Flieber export format — we'll detect month columns
  const monthColumns = csvData.headers.filter(h => /^\w{3}\s+\d{4}$|^\d{4}-\d{2}/.test(h.trim()));
  await dbLog('compare', 'info', `Detected ${monthColumns.length} month columns: ${monthColumns.join(', ')}`);

  let matches = 0;
  let mismatches = 0;
  let skipped = 0;
  const mismatchDetails = [];

  for (const row of csvData.rows) {
    // Try to identify the product — look for product name or EAN columns
    const productName = row['Product'] || row['product'] || row['Name'] || row['name'] || '';
    const store = row['Store'] || row['store'] || row['Channel'] || row['channel'] || '';
    const ean = row['EAN'] || row['ean'] || row['Code'] || row['code'] || '';

    // Find matching SKU in our lookup
    let mapping = null;
    for (const [name, m] of Object.entries(productLookup)) {
      if (productName && name.toLowerCase().includes(productName.toLowerCase())) {
        mapping = m;
        break;
      }
      if (ean && name.includes(ean)) {
        mapping = m;
        break;
      }
    }

    if (!mapping) {
      skipped++;
      continue;
    }

    // Compare each month
    for (const monthCol of monthColumns) {
      const csvVal = parseFloat(row[monthCol]);
      if (isNaN(csvVal)) continue;

      // Convert month column to YYYY-MM format
      const monthKey = normalizeMonth(monthCol);
      if (!monthKey) continue;

      const lookupKey = `${mapping.product_id}_${mapping.channel_id}_${monthKey}`;
      const supaVal = forecastLookup[lookupKey];

      if (supaVal === undefined) {
        skipped++;
        continue;
      }

      if (Math.abs(csvVal - Math.round(supaVal)) <= 1) {
        matches++;
      } else {
        mismatches++;
        if (mismatchDetails.length < 50) {
          mismatchDetails.push(`${productName} (${store}) ${monthCol}: Flieber=${csvVal}, Supabase=${supaVal}`);
        }
      }
    }
  }

  const summary = `✅ Matches: ${matches}, ❌ Mismatches: ${mismatches}, ⏭️ Skipped: ${skipped}`;
  await dbLog('compare', mismatches > 0 ? 'warning' : 'success', summary);

  if (mismatchDetails.length > 0) {
    // Log mismatches in chunks
    for (let i = 0; i < mismatchDetails.length; i += 10) {
      const chunk = mismatchDetails.slice(i, i + 10).join('\n');
      await dbLog('compare-mismatch', 'warning', chunk);
    }
  }

  return { matches, mismatches, skipped, mismatchDetails };
}

function normalizeMonth(col) {
  col = col.trim();
  
  // Already YYYY-MM format
  if (/^\d{4}-\d{2}/.test(col)) return col.substring(0, 7);
  
  // "Apr 2026" format
  const monthMap = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
  };
  const match = col.match(/^(\w{3})\s+(\d{4})$/);
  if (match && monthMap[match[1]]) {
    return `${match[2]}-${monthMap[match[1]]}`;
  }
  
  return null;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('🔍 Flieber Forecast Verifier v1.0');
  await dbLog('main', 'info', 'Script started — forecast verification');

  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--start-maximized'],
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      acceptDownloads: true,  // CRITICAL for CSV download
    });
    const page = await context.newPage();

    // Step 1: Login
    await login(page);

    // Step 2: Navigate to sales forecast
    await dbLog('navigate', 'info', 'Navigating to sales forecast...');
    await page.goto(FLIEBER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000); // Let SPA settle
    await dbLog('navigate', 'success', 'Sales forecast page loaded');

    // Step 3: Ensure all stores selected
    await selectAllStores(page);
    await sleep(2000);

    // Step 4: Export CSV
    const csvPath = await exportCSV(page);

    // Step 5: Parse CSV
    const csvData = parseCSV(csvPath);

    // Step 6: Compare with Supabase
    const result = await compareWithSupabase(csvData);

    // Cleanup CSV file
    try { fs.unlinkSync(csvPath); } catch (e) {}

    await dbLog('main', 'success', 
      `Verification complete! Matches=${result.matches}, Mismatches=${result.mismatches}, Skipped=${result.skipped}`);
    
    console.log(`\n🏁 Done! Matches=${result.matches}, Mismatches=${result.mismatches}`);

  } catch (error) {
    console.error(`❌ Fatal: ${error.message}`);
    await dbLog('main', 'error', `Fatal: ${error.message}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
