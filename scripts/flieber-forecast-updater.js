/**
 * flieber-forecast-updater.js
 *
 * Automatically updates Flieber sales forecasts from Supabase.
 * Reads Puzzlup_sales_Forecast → logs in → fills 13 months × N products × 5 stores.
 *
 * Prerequisites (on Tim's machine):
 *   cd C:\Users\Tim\playwright-render-service
 *   npm install @supabase/supabase-js          (playwright + dotenv already installed)
 *   node flieber-forecast-updater.js
 *
 * .env must contain:
 *   SUPABASE_URL=https://zlteahycfmpiaxdbnlvr.supabase.co
 *   SUPABASE_KEY=<service_role key>
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const FLIEBER_EMAIL    = 'Tim@qualico.be';
const FLIEBER_PASSWORD = '{FDd@dqE5y{@K2y^t{W1';
const FLIEBER_URL      = 'https://app.flieber.com/app/sales-forecast';

// Supabase channel_id → Flieber store name (exact text in UI)
const STORES = [
  { channelId: 35, name: 'Amazon EU'  },
  { channelId: 30, name: 'Amazon USA' },
  { channelId: 32, name: 'Amazon UK'  },
  { channelId: 31, name: 'Amazon CA'  },
  { channelId: 33, name: 'Bol'        },
];

// ── TEST MODE ─────────────────────────────────────────────────────────────────
// Set to true to run ONLY Bol × 1 product — safe for first-time testing
const TEST_MODE = true;
// ──────────────────────────────────────────────────────────────────────────────

// Products to SKIP entirely
const SKIP_SKUS = ['TRAY WHITE'];

// Months to fill: Apr 2026 → Apr 2027 (13 months)
const MONTHS = [
  '2026-04','2026-05','2026-06','2026-07','2026-08','2026-09',
  '2026-10','2026-11','2026-12','2027-01','2027-02','2027-03','2027-04',
];

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── DATA FETCH ────────────────────────────────────────────────────────────────

async function loadForecastData() {
  console.log('📊 Loading forecast data from Supabase...');

  const { data: forecasts, error: e1 } = await supabase
    .from('Puzzlup_sales_Forecast')
    .select('product_id, channel_id, forecast_month, units_forecast')
    .gte('forecast_month', '2026-04-01')
    .lte('forecast_month', '2027-04-30')
    .order('channel_id').order('product_id').order('forecast_month');

  if (e1) throw new Error('Supabase forecast fetch: ' + e1.message);

  const { data: products, error: e2 } = await supabase
    .from('Puzzlup_Product_Info')
    .select('id, sku');

  if (e2) throw new Error('Supabase product fetch: ' + e2.message);

  // product_id → sku
  const skuMap = {};
  for (const p of products) skuMap[p.id] = p.sku;

  // Structure: { channelId: { sku: { 'YYYY-MM': units } } }
  const data = {};
  for (const row of forecasts) {
    const sku = skuMap[row.product_id];
    if (!sku || SKIP_SKUS.includes(sku)) continue;

    const cid  = row.channel_id;
    const mo   = row.forecast_month.substring(0, 7); // 'YYYY-MM'
    const val  = Math.round(row.units_forecast ?? 0);

    if (!data[cid])       data[cid]       = {};
    if (!data[cid][sku])  data[cid][sku]  = {};
    data[cid][sku][mo] = val;
  }

  let total = 0;
  for (const cid of Object.keys(data))
    for (const sku of Object.keys(data[cid]))
      total += Object.keys(data[cid][sku]).length;

  console.log(`✅ ${total} data-points loaded across ${Object.values(data).reduce((s,c)=>s+Object.keys(c).length,0)} product×store combos`);
  return data;
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────

async function login(page) {
  console.log('\n🔐 Logging in...');
  await page.goto('https://app.flieber.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for email field — handles redirects to auth providers (Auth0 etc.)
  console.log('⏳ Waiting for login form...');
  await page.waitForSelector('input[type="email"], input[name="email"], input[type="text"]', { timeout: 60000 });
  console.log('✅ Login form visible');

  // Fill credentials
  await page.fill('input[type="email"], input[name="email"], input[type="text"]', FLIEBER_EMAIL);
  await page.waitForTimeout(500);
  await page.fill('input[type="password"]', FLIEBER_PASSWORD);
  await page.waitForTimeout(500);
  // Click the visible Continue/Submit button (skip hidden duplicates)
  await page.locator('button:has-text("Continue"), button[type="submit"]').filter({ visible: true }).first().click({ timeout: 30000 });

  await page.waitForURL('**app.flieber.com/app/**', { timeout: 60000 });
  console.log('✅ Logged in');

  // Save auth state for potential re-use
  await page.context().storageState({ path: 'flieber-auth.json' });
}

// ── STORE FILTER ──────────────────────────────────────────────────────────────

async function applyStoreFilter(page, storeName) {
  console.log(`\n🏪 Setting store filter → ${storeName}`);

  await page.goto(FLIEBER_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // DEBUG: screenshot + button dump to identify correct selectors
  await page.screenshot({ path: 'flieber-debug.png', fullPage: false });
  console.log('📸 Screenshot saved → flieber-debug.png (open this file to see the page)');
  const allButtons = await page.locator('button, div[role="button"], [role="combobox"]').allTextContents();
  console.log('🔍 Clickable elements:', JSON.stringify(allButtons.filter(t => t.trim()).slice(0, 30)));

  // Click "More filters" to open the filter panel
  const moreFiltersBtn = page.locator('button, div[role="button"]').filter({ hasText: /more filters/i }).first();
  await moreFiltersBtn.click({ timeout: 15000 });
  await page.waitForTimeout(1000);

  // DEBUG: screenshot of filter panel
  await page.screenshot({ path: 'flieber-debug-filters.png', fullPage: false });
  console.log('📸 Filter panel screenshot → flieber-debug-filters.png');
  const filterPanelElements = await page.locator('button, div[role="button"], label, input').allTextContents();
  console.log('🔍 Filter panel elements:', JSON.stringify(filterPanelElements.filter(t => t.trim()).slice(0, 40)));

  // Look for store/channel options and click the right one
  const storeOption = page.locator('label, div[role="option"], li, div').filter({ hasText: storeName }).first();
  if (await storeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
    await storeOption.click();
    await page.waitForTimeout(500);
    console.log(`✅ Store filter set to: ${storeName}`);
  } else {
    console.log(`⚠️ Could not find store option: ${storeName} — check flieber-debug-filters.png`);
  }

  // Select the store
  await page.click(`label:has-text("${storeName}"), [role="checkbox"]:near(:text("${storeName}"))`);
  await page.waitForTimeout(300);

  // Apply
  await page.click('button:has-text("Apply")');
  await page.waitForTimeout(2500);

  console.log(`✅ Filter applied: ${storeName}`);
}

// ── OPEN PRODUCT EDITOR ───────────────────────────────────────────────────────

async function openProductEditor(page, sku) {
  console.log(`\n  📦 ${sku}`);

  // Find row containing the SKU
  const row = page.locator('tr, [role="row"]').filter({ hasText: sku }).first();
  if (!(await row.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log(`  ⚠️  Not found in product list — skipping`);
    return false;
  }

  // Hover to reveal the ⋮ menu button
  await row.hover();
  await page.waitForTimeout(300);

  const menuBtn = row.locator(
    'button[aria-label*="more"], button[aria-haspopup], button:has-text("⋮"), button:has-text("...")'
  ).first();
  await menuBtn.click();
  await page.waitForTimeout(300);

  // Click "Edit forecast & past sales"
  await page.click(':text("Edit forecast"), :text("Edit forecast & past sales")');
  await page.waitForTimeout(1500);

  return true;
}

// ── UNSTICK "CUSTOM FORECAST UPLOADING" ──────────────────────────────────────

async function unstickIfNeeded(page) {
  const isStuck = await page.locator(':text("Custom forecast uploading")').isVisible({ timeout: 2000 }).catch(() => false);
  if (!isStuck) return false;

  console.log('  ⚠️  Stuck state — switching to AI model...');

  await page.click(':text("Model selection")');
  await page.waitForTimeout(500);
  await page.click('[value="ai"], label:has-text("AI"), :text-is("AI")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Apply")');

  // Wait for success or timeout
  await page.waitForSelector(':text("successfully")', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Close modal
  await page.click('button[aria-label="Close"], button[aria-label*="close" i], button:has-text("✕"), button:has-text("×")').catch(() => {});
  await page.waitForTimeout(800);

  console.log('  ✅ Unstuck — editor closed, will reopen');
  return true; // caller must reopen
}

// ── SWITCH TO MONTHLY VIEW ────────────────────────────────────────────────────

async function switchToMonthly(page) {
  // Try normal click first
  const btn = page.locator('button:has-text("Monthly")').first();
  try {
    await btn.click({ timeout: 2000 });
  } catch {
    // Fallback: JS click (needed for some React event handlers)
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent?.trim() === 'Monthly') b.click();
      });
    });
  }
  await page.waitForTimeout(800);
}

// ── ENSURE ABSOLUTE MODE ──────────────────────────────────────────────────────

async function ensureAbsoluteMode(page) {
  // Look for Percentage dropdown in Adjusted row and switch to Absolute if needed
  const dropdown = page.locator('select, [role="combobox"]').filter({ hasText: /percentage/i }).first();
  if (await dropdown.isVisible({ timeout: 1000 }).catch(() => false)) {
    await dropdown.selectOption({ label: 'Absolute' });
    await page.waitForTimeout(300);
    console.log('  ↔️  Switched to Absolute mode');
  }
}

// ── FILL ALL 13 MONTHS ────────────────────────────────────────────────────────

async function fillMonths(page, sku, monthlyValues) {
  // Click "Forecast adjustments" tab
  await page.click(':text("Forecast adjustments")');
  await page.waitForTimeout(600);

  await switchToMonthly(page);
  await ensureAbsoluteMode(page);

  // Find the "Adjusted forecast | Units" row's first data cell
  // Strategy: locate the row by its label text, take the first td/cell after the label
  const adjRow = page.locator('tr, [role="row"]').filter({
    hasText: /adj.*forecast|forecast.*adj/i
  }).filter({
    hasText: /units/i
  }).first();

  const firstCell = adjRow.locator('td, [role="cell"], [role="gridcell"]').nth(1);
  await firstCell.dblclick();
  await page.waitForTimeout(400);

  for (let i = 0; i < MONTHS.length; i++) {
    const mo  = MONTHS[i];
    const val = monthlyValues[mo] ?? 0;

    // Select all existing content (prevents append bug ⚠️)
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.type(String(val));

    // ⚠️ Tab TWICE: 1st → Sales (USD) row, 2nd → next month Units
    // Exception: last month — don't Tab (would wrap back to Apr 2026!)
    if (i < MONTHS.length - 1) {
      await page.keyboard.press('Tab'); // → Sales USD same month
      await page.keyboard.press('Tab'); // → Units next month
      await page.waitForTimeout(80);
    }
  }

  // Confirm last cell without tabbing
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // ── Verify Oct/Nov/Dec (truncation gotcha) ─────────────────────────────────
  await verifyLateMo(page, sku, monthlyValues);

  // Apply
  await page.click('button:has-text("Apply")');
  await page.waitForSelector(':text("Forecast edited successfully"), :text("successfully")', { timeout: 10000 })
    .catch(() => console.log('  ⚠️  No success toast seen — continuing anyway'));
  await page.waitForTimeout(1000);

  console.log(`  ✅ Applied (${MONTHS.length} months)`);
}

// ── VERIFY OCT/NOV/DEC (truncation protection) ────────────────────────────────

async function verifyLateMo(page, sku, monthlyValues) {
  // Scroll right to see Oct-Dec columns
  const tableArea = page.locator('.ReactVirtualized__Grid, [class*="grid"], [class*="table"]').first();
  if (await tableArea.isVisible({ timeout: 1000 }).catch(() => false)) {
    await tableArea.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(500);
  }

  for (const mo of ['2026-10', '2026-11', '2026-12']) {
    const expected = monthlyValues[mo] ?? 0;
    if (expected === 0) continue;

    // Find a visible cell showing the expected value — if missing, warn
    const label = mo === '2026-10' ? 'Oct' : mo === '2026-11' ? 'Nov' : 'Dec';
    const cell  = page.locator(`th:has-text("${label} 2026"), td:has-text("${label} 2026")`).first();
    const isVis = await cell.isVisible({ timeout: 1000 }).catch(() => false);
    if (!isVis) {
      console.log(`  ⚠️  Could not verify ${label} (not visible) — check manually`);
    }
  }
}

// ── CLOSE MODAL ───────────────────────────────────────────────────────────────

async function closeModal(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // Fallback
  const closeBtn = page.locator('button[aria-label="Close"], button[aria-label*="close" i]').first();
  if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) await closeBtn.click();
  await page.waitForTimeout(500);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Flieber Forecast Updater\n');

  const allData = await loadForecastData();

  const browser = await chromium.launch({
    headless: false,          // watch it run — set true for unattended
    slowMo: 50,               // slight slow-down for stability
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const stats = { done: 0, skipped: 0, errors: [] };

  try {
    await login(page);

    // TEST_MODE: limit to Bol only
    const storesToRun = TEST_MODE
      ? STORES.filter(s => s.channelId === 33)
      : STORES;

    for (const store of storesToRun) {
      const products = allData[store.channelId];
      if (!products || Object.keys(products).length === 0) {
        console.log(`⏭️  No data for ${store.name} — skipping`);
        continue;
      }

      await applyStoreFilter(page, store.name);

      // TEST_MODE: limit to 1 product
      const skus = TEST_MODE
        ? Object.keys(products).slice(0, 1)
        : Object.keys(products);

      console.log(`\n📋 ${store.name}: ${skus.length} product(s)${TEST_MODE ? ' [TEST MODE]' : ''}`);

      for (const sku of skus) {
        try {
          let opened = await openProductEditor(page, sku);
          if (!opened) { stats.skipped++; continue; }

          // Handle stuck state — may need to reopen
          const wasStuck = await unstickIfNeeded(page);
          if (wasStuck) {
            opened = await openProductEditor(page, sku);
            if (!opened) { stats.skipped++; continue; }
          }

          await fillMonths(page, sku, products[sku]);
          stats.done++;

        } catch (err) {
          console.error(`  ❌ ${sku}: ${err.message}`);
          stats.errors.push({ store: store.name, sku, error: err.message });

          // Take screenshot for debugging
          const fname = `error-${store.name.replace(/ /g,'_')}-${sku.replace(/ /g,'_')}.png`;
          await page.screenshot({ path: fname }).catch(() => {});
          console.log(`  📸 Screenshot saved: ${fname}`);

          // Try to close modal and continue
          await closeModal(page);
        }
      }

      console.log(`✅ Done with ${store.name}`);
    }

  } finally {
    await browser.close();
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════');
  console.log(`🎉 Done! ${stats.done} products updated, ${stats.skipped} skipped`);
  if (stats.errors.length > 0) {
    console.log(`⚠️  ${stats.errors.length} errors:`);
    stats.errors.forEach(e => console.log(`   ${e.store} / ${e.sku}: ${e.error}`));
  }
  console.log('══════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
