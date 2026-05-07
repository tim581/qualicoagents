/**
 * flieber-actuals-export.js v1.0 — Export actual sales from Flieber CSV and upsert to Supabase
 *
 * Reads (-)NM Total Units Sold columns from the Flieber export CSV.
 * Each (-)NM column = N months ago actual sales.
 *
 * Target table: puzzlup_sales_actuals (product_id, channel_id, sales_month, units_actual, source)
 * Source tag: 'flieber_export'
 *
 * Used by:
 *   - Initial backfill (Jan–Apr 2026)
 *   - Monthly cron trigger (2nd of each month, pulls previous month)
 *
 * Env: SUPABASE_URL, SUPABASE_KEY (same as other scripts)
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
const RUN_ID = `actuals_${Date.now()}`;

// Store name → channel_id (same mapping as verifier)
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
 * Convert negative offset (1=last month, 2=2 months ago, ...) to ISO month string
 * e.g. from May 2026: negOffset(1) → "2026-04-01", negOffset(4) → "2026-01-01"
 */
function negOffsetToMonth(offsetN) {
  const now = new Date();
  const targetMonth = now.getMonth() - offsetN; // can be negative
  const targetYear = now.getFullYear() + Math.floor(targetMonth / 12);
  const m = ((targetMonth % 12) + 12) % 12;
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
  await page.fill('input[type="email"], input[name="email"], input[type="text"]', creds.username);
  await sleep(500);
  await page.fill('input[type="password"]', creds.password);
  await sleep(500);
  await page.locator('button:has-text("Continue"), button[type="submit"]').filter({ visible: true }).first().click({ timeout: 30000 });
  await page.waitForURL('**app.flieber.com/app/**', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  await dbLog('login', 'success', 'Logged in ✅');
}

// ── SELECT ALL STORES ────────────────────────────────────────────────────────

async function selectAllStores(page) {
  await dbLog('select-all', 'info', 'Waiting 8s for SPA to settle...');
  await sleep(8000);

  const filterBtn = page.getByText(/regions.*channels|all regions/i).first();
  const filterVisible = await filterBtn.isVisible({ timeout: 5000 }).catch(() => false);

  if (!filterVisible) {
    throw new Error('Could not find store filter button');
  }

  const filterText = await filterBtn.textContent().catch(() => '');
  if (filterText.toLowerCase().includes('all regions')) {
    await dbLog('select-all', 'success', 'Already showing all stores ✅');
    return;
  }

  await filterBtn.click({ timeout: 10000, force: true });
  await sleep(2000);

  const storesMenu = page.getByText(/^stores$/i).first();
  const storesVisible = await storesMenu.isVisible({ timeout: 5000 }).catch(() => false);
  if (storesVisible) {
    await storesMenu.click({ timeout: 5000 });
    await sleep(1000);
  }

  const ALL_STORES = ['Amazon CA', 'Amazon EU', 'Amazon UK', 'Amazon USA', 'Bol', 'Puzzlup'];
  for (const store of ALL_STORES) {
    const storeRow = page.locator('label, li, div[role="option"]').filter({ hasText: new RegExp(`^${store}$`) }).first();
    const isVisible = await storeRow.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isVisible) continue;

    const isChecked = await storeRow.evaluate(el => {
      const cb = el.querySelector('input[type="checkbox"]');
      if (cb) return cb.checked;
      return el.getAttribute('aria-checked') === 'true';
    }).catch(() => false);

    if (!isChecked) {
      await storeRow.click({ timeout: 5000 }).catch(() => {});
      await sleep(300);
    }
  }

  const enabledApply = page.locator('button:not([disabled])').filter({ hasText: /^apply$/i }).first();
  const applyVisible = await enabledApply.isVisible({ timeout: 5000 }).catch(() => false);
  if (applyVisible) {
    await enabledApply.click({ timeout: 5000 });
    await sleep(3000);
  } else {
    await page.keyboard.press('Escape');
    await sleep(2000);
  }

  await dbLog('select-all', 'success', 'All stores selected ✅');
}

// ── EXPORT CSV ───────────────────────────────────────────────────────────────

async function exportCSV(page) {
  await dbLog('export', 'info', 'Looking for Export button...');

  const exportBtn = page.locator('button:has-text("Export data")').first();
  await exportBtn.scrollIntoViewIfNeeded({ timeout: 15000 });
  await sleep(1000);
  await exportBtn.click({ timeout: 10000 });
  await sleep(2000);

  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  const exportTableBtn = page.getByText('Export table data').first();
  await exportTableBtn.click({ timeout: 10000 });

  const download = await downloadPromise;
  const downloadPath = path.join(__dirname, `flieber-actuals-${Date.now()}.csv`);
  await download.saveAs(downloadPath);

  const fileSize = fs.statSync(downloadPath).size;
  await dbLog('export', 'success', `CSV downloaded: ${(fileSize / 1024).toFixed(1)} KB`);
  return downloadPath;
}

// ── PARSE CSV ────────────────────────────────────────────────────────────────

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
      result.push(current); current = '';
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

// ── UPSERT ACTUALS ────────────────────────────────────────────────────────────

async function upsertActuals(csvData) {
  await dbLog('upsert', 'info', `Processing ${csvData.rows.length} CSV rows for actuals`);

  // Find (-)NM Total Units Sold columns
  const negColumns = {}; // { offsetN: columnName }
  for (const h of csvData.headers) {
    const match = h.match(/^\(-\)(\d+)M Total Units Sold$/i);
    if (match) negColumns[parseInt(match[1])] = h;
  }

  // Also try alternate format: (-)NM Sold, (-)N Month, etc.
  for (const h of csvData.headers) {
    const match2 = h.match(/^\(-\)(\d+)M\s/i);
    if (match2 && !negColumns[parseInt(match2[1])]) {
      if (h.toLowerCase().includes('sold') || h.toLowerCase().includes('unit')) {
        negColumns[parseInt(match2[1])] = h;
      }
    }
  }

  const offsets = Object.keys(negColumns).map(Number).sort((a, b) => a - b);
  await dbLog('upsert', 'info', `Found ${offsets.length} past-month columns: ${offsets.map(n => `(-)${n}M`).join(', ')}`);

  if (offsets.length === 0) {
    const negCols = csvData.headers.filter(h => h.includes('(-)'));
    await dbLog('upsert', 'error', `No (-)NM columns found! Neg columns: ${negCols.slice(0, 10).join(' | ')}`);
    // Log first 5 headers for debugging
    await dbLog('upsert', 'info', `All headers sample: ${csvData.headers.slice(0, 20).join(' | ')}`);
    throw new Error('No past-month columns detected in CSV');
  }

  // Map offsets to calendar months
  const offsetMonthMap = {};
  for (const n of offsets) {
    offsetMonthMap[n] = negOffsetToMonth(n);
  }
  await dbLog('upsert', 'info', `Month mapping: ${offsets.map(n => `(-)${n}M → ${offsetMonthMap[n]}`).join(', ')}`);

  // Load product mapping
  const { data: skuMap, error: skuErr } = await supabase
    .from('flieber_product_skus')
    .select('product_id, channel_id, flieber_product_name, flieber_product_code');

  if (skuErr || !skuMap) throw new Error(`Failed to load SKU map: ${skuErr?.message}`);

  const codeLookup = {};
  const nameLookup = {};
  for (const s of skuMap) {
    if (s.flieber_product_code) codeLookup[`${s.flieber_product_code}_${s.channel_id}`] = s.product_id;
    if (s.flieber_product_name) nameLookup[`${s.flieber_product_name.toLowerCase()}_${s.channel_id}`] = s.product_id;
  }
  await dbLog('upsert', 'info', `Loaded ${skuMap.length} SKU mappings`);

  // Build upsert records
  const records = []; // { product_id, channel_id, sales_month, units_actual, source }
  let skipped = 0;

  for (const row of csvData.rows) {
    const productCode = row['Product Code'] || '';
    const productName = row['Product Name'] || '';
    const store = row['Store'] || '';

    const channelId = STORE_CHANNEL_MAP[store];
    if (!channelId) { skipped++; continue; }

    let productId = codeLookup[`${productCode}_${channelId}`]
      || nameLookup[`${productName.toLowerCase()}_${channelId}`];

    if (!productId) {
      for (const s of skuMap) {
        if (s.channel_id === channelId && s.flieber_product_name?.toLowerCase() === productName.toLowerCase()) {
          productId = s.product_id; break;
        }
      }
    }
    if (!productId) { skipped++; continue; }

    for (const n of offsets) {
      const colName = negColumns[n];
      const rawVal = row[colName];
      if (!rawVal || rawVal === '' || rawVal === '-') continue;
      const units = Math.round(parseFloat(rawVal));
      if (isNaN(units) || units < 0) continue;

      records.push({
        product_id: productId,
        channel_id: channelId,
        sales_month: offsetMonthMap[n],
        units_actual: units,
        source: 'flieber_export',
      });
    }
  }

  await dbLog('upsert', 'info', `Built ${records.length} records to upsert (${skipped} rows skipped — no mapping)`);

  if (records.length === 0) {
    await dbLog('upsert', 'warning', 'No records to upsert!');
    return { upserted: 0, skipped };
  }

  // Delete existing records for affected months (clean upsert)
  const affectedMonths = [...new Set(records.map(r => r.sales_month))];
  for (const month of affectedMonths) {
    const { error: delErr } = await supabase
      .from('puzzlup_sales_actuals')
      .delete()
      .eq('sales_month', month)
      .eq('source', 'flieber_export');
    if (delErr) await dbLog('upsert', 'warning', `Delete error for ${month}: ${delErr.message}`);
  }
  await dbLog('upsert', 'info', `Cleared existing flieber_export data for: ${affectedMonths.join(', ')}`);

  // Batch insert (100 at a time)
  let inserted = 0;
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    const { error: insErr } = await supabase
      .from('puzzlup_sales_actuals')
      .insert(batch);
    if (insErr) {
      await dbLog('upsert', 'error', `Insert error batch ${i}: ${insErr.message}`);
    } else {
      inserted += batch.length;
    }
  }

  await dbLog('upsert', 'success', `✅ Upserted ${inserted} actuals records for months: ${affectedMonths.join(', ')}`);
  return { upserted: inserted, skipped, months: affectedMonths };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('📊 Flieber Actuals Export v1.0');
  await dbLog('main', 'info', 'Actuals export v1.0 started');

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

    await login(page);

    await dbLog('navigate', 'info', 'Navigating to sales forecast...');
    await page.goto(FLIEBER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(8000);
    await dbLog('navigate', 'success', 'Sales forecast page loaded');

    await selectAllStores(page);
    await sleep(3000);

    const csvPath = await exportCSV(page);
    const csvData = parseCSV(csvPath);
    await dbLog('parse', 'success', `Parsed ${csvData.rows.length} rows, ${csvData.headers.length} columns`);

    const result = await upsertActuals(csvData);

    try { fs.unlinkSync(csvPath); } catch (e) {}

    await dbLog('main', 'success', `✅ Done! Upserted ${result.upserted} actuals records for ${result.months?.join(', ')}`);
    console.log(`\n🏁 Done! Upserted ${result.upserted} records`);

    // Auto-create a verify task (optional — could verify the new actuals)
    // For now just log success to Flieber_Debug_Log

  } catch (error) {
    console.error(`❌ Fatal: ${error.message}`);
    await dbLog('main', 'error', `Fatal: ${error.message}\n${error.stack?.substring(0, 500)}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
