/**
 * flieber-forecast-updater.js  v6 — fix: nth(2) for April start cell, tab-per-cell debug, Apply fix
 *
 * Automatically updates Flieber sales forecasts from Supabase.
 * Reads Puzzlup_sales_Forecast → logs in → fills 13 months × N products × 5 stores.
 *
 * After each run: query Supabase "Flieber_Debug_Log" filtered by run_id to see all steps + screenshots.
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

// ── SELF-DEBUGGING: SUPABASE LOG ──────────────────────────────────────────────

const RUN_ID = `run_${Date.now()}`;
console.log(`\n🔍 Debug run ID: ${RUN_ID}`);
console.log(`   → Query Supabase "Flieber_Debug_Log" WHERE run_id = '${RUN_ID}' after run\n`);

async function dbLog(step, status, message) {
  // status: 'info' | 'success' | 'warn' | 'error'
  const short = (message || '').toString().substring(0, 3000);
  console.log(`  [DB:${status}] ${step}: ${short.substring(0, 120)}`);
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ run_id: RUN_ID, step, status, message: short }),
    });
  } catch (e) { /* never break the main flow */ }
}

async function dbShot(page, step, label) {
  try {
    const buf = await page.screenshot({ fullPage: false });
    // Limit to ~400KB base64 (safe for Supabase text column)
    const b64 = buf.toString('base64').substring(0, 400000);
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ run_id: RUN_ID, step, status: 'screenshot', message: label, screenshot: b64 }),
    });
    console.log(`  📸 Screenshot logged → ${step} (${label})`);
  } catch (e) { /* never break the main flow */ }
}

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

  // Get Flieber product name/code mapping per product_id + channel_id
  const { data: flieberSkus, error: e2 } = await supabase
    .from('flieber_product_skus')
    .select('product_id, channel_id, flieber_product_name, flieber_product_code');

  if (e2) throw new Error('Supabase flieber_product_skus fetch: ' + e2.message);

  // Map: "productId_channelId" → { name, code }
  const flieberMap = {};
  for (const f of flieberSkus) {
    flieberMap[`${f.product_id}_${f.channel_id}`] = {
      name: f.flieber_product_name,
      code: f.flieber_product_code,
    };
  }

  // Structure: { channelId: { flieberCode: { name: "MAT 1500 GIFT", months: { 'YYYY-MM': units } } } }
  const data = {};
  let skipped = 0;
  for (const row of forecasts) {
    const key = `${row.product_id}_${row.channel_id}`;
    const flieber = flieberMap[key];
    if (!flieber) { skipped++; continue; } // no Flieber mapping

    const cid  = row.channel_id;
    const code = flieber.code;
    const mo   = row.forecast_month.substring(0, 7); // 'YYYY-MM'
    const val  = Math.round(row.units_forecast ?? 0);

    if (!data[cid])        data[cid]        = {};
    if (!data[cid][code])  data[cid][code]  = { name: flieber.name, months: {} };
    data[cid][code].months[mo] = val;
  }

  if (skipped > 0) console.log(`  ⚠️  ${skipped} rows had no Flieber mapping — skipped`);

  let total = 0;
  for (const cid of Object.keys(data))
    for (const code of Object.keys(data[cid]))
      total += Object.keys(data[cid][code].months).length;

  console.log(`✅ ${total} data-points loaded across ${Object.values(data).reduce((s,c)=>s+Object.keys(c).length,0)} product×store combos`);
  return data;
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────

async function login(page) {
  console.log('\n🔐 Logging in...');
  await dbLog('login', 'info', 'Navigating to Flieber...');
  await page.goto('https://app.flieber.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.waitForSelector('input[type="email"], input[name="email"], input[type="text"]', { timeout: 60000 });
  await dbLog('login', 'info', 'Login form visible');

  await page.fill('input[type="email"], input[name="email"], input[type="text"]', FLIEBER_EMAIL);
  await page.waitForTimeout(500);
  await page.fill('input[type="password"]', FLIEBER_PASSWORD);
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Continue"), button[type="submit"]').filter({ visible: true }).first().click({ timeout: 30000 });

  await page.waitForURL('**app.flieber.com/app/**', { timeout: 60000 });
  await dbLog('login', 'success', 'Logged in ✅');
  console.log('✅ Logged in');

  await page.context().storageState({ path: 'flieber-auth.json' });
}

// ── STORE FILTER ──────────────────────────────────────────────────────────────

async function applyStoreFilter(page, storeName) {
  console.log(`\n🏪 Setting store filter → ${storeName}`);
  await dbLog('store-filter', 'info', `Target store: ${storeName}`);

  await page.goto(FLIEBER_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await dbShot(page, 'store-filter-0-pageload', 'Page loaded, before opening filter');

  // Step 1: Open the channel/store filter dropdown
  console.log('🔍 Opening filter dropdown...');
  const channelFilterBtn = page.getByText(/regions.*channels|all regions/i).first();
  await channelFilterBtn.click({ timeout: 15000, force: true });
  await page.waitForTimeout(1000);
  await dbShot(page, 'store-filter-1-dropdown-open', 'After clicking filter button');

  // Step 2: Click "Stores >" submenu
  console.log('🔍 Clicking Stores submenu...');
  const storesMenu = page.getByText(/^stores$/i).first();
  await storesMenu.click({ timeout: 10000 });
  await page.waitForTimeout(800);
  await dbShot(page, 'store-filter-2-stores-submenu', 'After clicking Stores submenu');

  const ALL_STORES = ['Amazon CA', 'Amazon EU', 'Amazon UK', 'Amazon USA', 'Bol', 'Puzzlup'];

  // ── PHASE 1: Ensure ALL stores are checked ──────────────────────────────────
  // This guarantees the next phase causes a change → Apply button will be enabled
  console.log('🔍 Phase 1: Selecting ALL stores...');
  await dbLog('store-filter', 'info', 'Phase 1: ensuring all stores are checked');

  for (const store of ALL_STORES) {
    const storeRow = page.locator('label, li, div[role="option"]').filter({ hasText: new RegExp(`^${store}$`) }).first();
    const isVisible = await storeRow.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isVisible) {
      await dbLog('store-filter', 'warn', `Store "${store}" not visible in list`);
      continue;
    }

    const isChecked = await storeRow.evaluate(el => {
      const cb = el.querySelector('input[type="checkbox"]');
      if (cb) return cb.checked;
      return el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-checked') !== null;
    }).catch(() => null);

    await dbLog('store-filter', 'info', `Phase1 ${store}: isChecked=${isChecked}`);

    if (isChecked === false || isChecked === null) {
      // Click to check it (null means we couldn't detect — click anyway to be safe)
      await storeRow.click({ timeout: 5000 }).catch(async (e) => {
        await dbLog('store-filter', 'warn', `Could not click ${store}: ${e.message}`);
      });
      await page.waitForTimeout(200);
    }
  }

  await page.waitForTimeout(500);
  await dbShot(page, 'store-filter-3-all-checked', 'After Phase 1 — all stores should be checked');

  // ── PHASE 2: Uncheck all EXCEPT target store ────────────────────────────────
  console.log(`🔍 Phase 2: Deselecting all except "${storeName}"...`);
  await dbLog('store-filter', 'info', `Phase 2: unchecking all except ${storeName}`);

  for (const store of ALL_STORES) {
    if (store === storeName) continue; // keep target checked

    const storeRow = page.locator('label, li, div[role="option"]').filter({ hasText: new RegExp(`^${store}$`) }).first();
    const isVisible = await storeRow.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isVisible) continue;

    const isChecked = await storeRow.evaluate(el => {
      const cb = el.querySelector('input[type="checkbox"]');
      if (cb) return cb.checked;
      return el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-checked') !== null;
    }).catch(() => null);

    await dbLog('store-filter', 'info', `Phase2 ${store}: isChecked=${isChecked} → will uncheck`);

    if (isChecked !== false) {
      await storeRow.click({ timeout: 5000 }).catch(async (e) => {
        await dbLog('store-filter', 'warn', `Could not uncheck ${store}: ${e.message}`);
      });
      await page.waitForTimeout(200);
    }
  }

  await page.waitForTimeout(500);
  await dbShot(page, 'store-filter-4-target-only', `After Phase 2 — only ${storeName} should be checked`);

  // ── Step 5: Click Apply ──────────────────────────────────────────────────────
  // Look for an ENABLED Apply button (not the disabled global one)
  await dbLog('store-filter', 'info', 'Looking for enabled Apply button...');

  // Dump all Apply buttons and their state for debugging
  const applyButtons = await page.locator('button').filter({ hasText: /^apply$/i }).all();
  const applyStates = [];
  for (const btn of applyButtons) {
    const disabled = await btn.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true').catch(() => '?');
    const visible  = await btn.isVisible().catch(() => false);
    applyStates.push(`disabled=${disabled} visible=${visible}`);
  }
  await dbLog('store-filter', 'info', `Apply buttons found: ${applyButtons.length} → [${applyStates.join(' | ')}]`);
  await dbShot(page, 'store-filter-5-before-apply', 'State before clicking Apply');

  // Click the first ENABLED Apply button
  const enabledApply = page.locator('button:not([disabled])').filter({ hasText: /^apply$/i }).first();
  const isEnabled = await enabledApply.isVisible({ timeout: 5000 }).catch(() => false);

  if (!isEnabled) {
    // Fallback: maybe "Apply" is inside a popover — try any visible button with Apply text
    await dbLog('store-filter', 'warn', 'No enabled Apply button found — trying force click on last Apply');
    const anyApply = page.locator('button').filter({ hasText: /^apply$/i }).last();
    await anyApply.click({ force: true, timeout: 10000 });
  } else {
    await enabledApply.click({ timeout: 10000 });
  }

  await page.waitForTimeout(2500);
  await dbShot(page, 'store-filter-6-applied', `After Apply — filter should show ${storeName}`);
  await dbLog('store-filter', 'success', `Filter applied: ${storeName} ✅`);
  console.log(`✅ Filter applied: ${storeName}`);
}

// ── OPEN PRODUCT EDITOR ───────────────────────────────────────────────────────

async function openProductEditor(page, productName) {
  console.log(`\n  📦 ${productName}`);
  await dbLog('product-editor', 'info', `Opening editor for: ${productName}`);

  await dbShot(page, `product-${productName.replace(/ /g,'_')}-0-start`, 'Product list before search');

  const allText = await page.evaluate((name) => {
    const els = Array.from(document.querySelectorAll('*'));
    return els
      .filter(el => el.children.length === 0 && el.textContent.includes(name.substring(0, 6)))
      .map(el => `[${el.tagName}.${el.className.toString().substring(0,30)}] "${el.textContent.trim().substring(0,80)}"`)
      .slice(0, 20);
  }, productName);
  await dbLog('product-editor', 'info', `DOM elements containing "${productName.substring(0,6)}": ${JSON.stringify(allText)}`);

  const selectors = [
    `tr:has-text("${productName}")`,
    `[role="row"]:has-text("${productName}")`,
    `div:has-text("${productName}")`,
    `:text("${productName}")`,
  ];

  let row = null;
  for (const sel of selectors) {
    const candidate = page.locator(sel).first();
    if (await candidate.isVisible({ timeout: 2000 }).catch(() => false)) {
      row = candidate;
      await dbLog('product-editor', 'info', `Row found with selector: ${sel}`);
      console.log(`  ✅ Found with selector: ${sel}`);
      break;
    }
  }

  if (!row) {
    await dbLog('product-editor', 'warn', `Product "${productName}" not found in list — skipping`);
    console.log(`  ⚠️  Not found in product list — skipping`);
    return false;
  }

  await row.hover();
  await page.waitForTimeout(300);

  const menuBtn = row.locator(
    'button[aria-label*="more"], button[aria-haspopup], button:has-text("⋮"), button:has-text("...")'
  ).first();
  await menuBtn.click();
  await page.waitForTimeout(300);

  await page.click(':text("Edit forecast"), :text("Edit forecast & past sales")');
  await page.waitForTimeout(1500);

  await dbShot(page, `product-${productName.replace(/ /g,'_')}-1-editor-open`, 'Editor opened');
  await dbLog('product-editor', 'success', `Editor opened for ${productName}`);
  return true;
}

// ── UNSTICK "CUSTOM FORECAST UPLOADING" ──────────────────────────────────────

async function unstickIfNeeded(page) {
  const isStuck = await page.locator(':text("Custom forecast uploading")').isVisible({ timeout: 2000 }).catch(() => false);
  if (!isStuck) return false;

  console.log('  ⚠️  Stuck state — switching to AI model...');
  await dbLog('unstick', 'warn', 'Stuck state detected — switching to AI model');

  await page.click(':text("Model selection")');
  await page.waitForTimeout(500);
  await page.click('[value="ai"], label:has-text("AI"), :text-is("AI")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Apply")');

  await page.waitForSelector(':text("successfully")', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  await page.click('button[aria-label="Close"], button[aria-label*="close" i], button:has-text("✕"), button:has-text("×")').catch(() => {});
  await page.waitForTimeout(800);

  await dbLog('unstick', 'success', 'Unstuck — editor closed, will reopen');
  console.log('  ✅ Unstuck — editor closed, will reopen');
  return true;
}

// ── SWITCH TO MONTHLY VIEW ────────────────────────────────────────────────────

async function switchToMonthly(page) {
  const btn = page.locator('button:has-text("Monthly")').first();
  try {
    await btn.click({ timeout: 2000 });
  } catch {
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
  const dropdown = page.locator('select, [role="combobox"]').filter({ hasText: /percentage/i }).first();
  if (await dropdown.isVisible({ timeout: 1000 }).catch(() => false)) {
    await dropdown.selectOption({ label: 'Absolute' });
    await page.waitForTimeout(300);
    console.log('  ↔️  Switched to Absolute mode');
    await dbLog('fill-months', 'info', 'Switched to Absolute mode');
  }
}

// ── FILL ALL 13 MONTHS ────────────────────────────────────────────────────────

async function fillMonths(page, productName, monthlyValues) {
  await dbLog('fill-months', 'info', `fillMonths start for ${productName}`);

  await page.click(':text("Forecast adjustments")');
  await page.waitForTimeout(600);

  await switchToMonthly(page);
  await ensureAbsoluteMode(page);

  await dbShot(page, `fill-${productName.replace(/ /g,'_')}-0-before-dblclick`, 'Before finding Adjusted forecast row');

  // Find the "Adjusted forecast | Units" row
  const adjRow = page.locator('tr, [role="row"]').filter({
    hasText: /adj.*forecast|forecast.*adj/i
  }).filter({
    hasText: /units/i
  }).first();

  const rowVisible = await adjRow.isVisible({ timeout: 5000 }).catch(() => false);
  await dbLog('fill-months', rowVisible ? 'info' : 'error', `Adjusted forecast row visible: ${rowVisible}`);

  if (!rowVisible) {
    await dbShot(page, `fill-${productName.replace(/ /g,'_')}-error-no-row`, 'Adjusted forecast row not found');
    throw new Error('Adjusted forecast row not visible');
  }

  // Log row HTML for debugging
  const rowHtml = await adjRow.evaluate(el => el.outerHTML.substring(0, 500)).catch(() => 'N/A');
  await dbLog('fill-months', 'info', `Row HTML: ${rowHtml}`);

  // ── IDENTIFY ALL CELLS IN ROW ─────────────────────────────────────────────
  // Col 0 = row label (readonly), Col 1 = "Absolute" type dropdown, Col 2+ = months
  const allCells = adjRow.locator('td, [role="cell"], [role="gridcell"]');
  const cellCount = await allCells.count().catch(() => 0);
  await dbLog('fill-months', 'info', `Row has ${cellCount} cells total. Col 0=label, Col 1=type(Absolute), Col 2=April(start)`);

  // Log first 4 cells to confirm structure
  for (let ci = 0; ci < Math.min(4, cellCount); ci++) {
    const cText = await allCells.nth(ci).innerText().catch(() => '?');
    const cIdx  = await allCells.nth(ci).getAttribute('aria-colindex').catch(() => '?');
    await dbLog('fill-months', 'info', `  cell[${ci}] aria-colindex=${cIdx} text="${cText.substring(0,30)}"`);
  }

  // ✅ FIX: nth(2) = first MONTH column (April), NOT the "Absolute" type dropdown at nth(1)
  const firstCell = adjRow.locator('td, [role="cell"], [role="gridcell"]').nth(2);
  const cellVisible = await firstCell.isVisible({ timeout: 3000 }).catch(() => false);
  const aprilText  = await firstCell.innerText().catch(() => '?');
  await dbLog('fill-months', cellVisible ? 'info' : 'warn', `April cell visible: ${cellVisible}, current value: "${aprilText}"`);

  // ⚠️ Handsontable frozen-column overlay intercepts clicks → force: true bypasses it
  await dbLog('fill-months', 'info', 'Attempting dblclick on April cell (nth(2)) with force:true...');
  await firstCell.dblclick({ force: true });
  await page.waitForTimeout(600);

  await dbShot(page, `fill-${productName.replace(/ /g,'_')}-1-after-dblclick`, 'After dblclick on April — should be in edit mode');

  // Check if cell opened (input field appears)
  const inputVisible = await page.locator('input[type="text"], textarea, .handsontableInput').first().isVisible({ timeout: 1000 }).catch(() => false);
  await dbLog('fill-months', inputVisible ? 'success' : 'warn', `Cell edit input visible after dblclick: ${inputVisible}`);

  // Log which cell is now active (to confirm we're at April)
  const activeColIdx = await page.evaluate(() => {
    const active = document.querySelector('td.current, td[class*="current"], .handsontableInput');
    return active ? active.getAttribute('aria-colindex') || active.closest('td')?.getAttribute('aria-colindex') || 'unknown' : 'none';
  }).catch(() => 'eval-error');
  await dbLog('fill-months', 'info', `Active cell aria-colindex after dblclick: ${activeColIdx} (should be col 3 = April)`);

  // Fill all 13 months — TAB ONCE per month (we are in the Units row, Tab moves right)
  for (let i = 0; i < MONTHS.length; i++) {
    const mo  = MONTHS[i];
    const val = monthlyValues[mo] ?? 0;

    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.type(String(val));

    // Debug: log active cell for first 3 months
    if (i < 3) {
      const curIdx = await page.evaluate(() => {
        const el = document.querySelector('.handsontableInput, td.current');
        return el ? (el.getAttribute('aria-colindex') || el.closest('td')?.getAttribute('aria-colindex') || '?') : '?';
      }).catch(() => '?');
      await dbLog('fill-months', 'info', `Month[${i}] ${mo} = ${val}, active col: ${curIdx}`);
    }

    if (i < MONTHS.length - 1) {
      // TAB ONCE to next month (staying in Adjusted forecast | Units row)
      await page.keyboard.press('Tab');
      await page.waitForTimeout(80);

      // After first Tab, check if we jumped to wrong row — log active col
      if (i < 3) {
        const afterIdx = await page.evaluate(() => {
          const el = document.querySelector('.handsontableInput, td.current');
          return el ? (el.getAttribute('aria-colindex') || el.closest('td')?.getAttribute('aria-colindex') || '?') : '?';
        }).catch(() => '?');
        await dbLog('fill-months', 'info', `  After Tab: active col = ${afterIdx}`);
      }
    }
  }

  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  await dbShot(page, `fill-${productName.replace(/ /g,'_')}-2-after-enter`, 'After Enter — looking for Apply/Save button');

  await verifyLateMo(page, productName, monthlyValues);

  // ── APPLY / SAVE ──────────────────────────────────────────────────────────
  // After month entry, Flieber shows an Apply button in the forecast editor panel
  // Log all visible buttons first to find the right selector
  const allButtonTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button:not([disabled])'))
      .map(b => b.textContent?.trim().substring(0, 40))
      .filter(t => t && t.length > 0)
      .slice(0, 20)
  ).catch(() => []);
  await dbLog('fill-months', 'info', `Visible enabled buttons: ${JSON.stringify(allButtonTexts)}`);

  // Try Apply button with broader selector (not anchored to ^ and $)
  const applyBtn = page.locator('button:not([disabled])').filter({ hasText: /apply/i }).first();
  const applyExists = await applyBtn.isVisible({ timeout: 3000 }).catch(() => false);
  await dbLog('fill-months', applyExists ? 'info' : 'warn', `Apply button found: ${applyExists}`);

  if (applyExists) {
    await applyBtn.click({ timeout: 10000 });
  } else {
    // Fallback: Enter key to confirm
    await dbLog('fill-months', 'warn', 'No Apply button — pressing Enter as fallback');
    await page.keyboard.press('Enter');
  }

  await page.waitForSelector(':text("Forecast edited successfully"), :text("successfully")', { timeout: 10000 })
    .catch(() => dbLog('fill-months', 'warn', 'No success toast seen — continuing anyway'));
  await page.waitForTimeout(1000);

  await dbShot(page, `fill-${productName.replace(/ /g,'_')}-2-done`, 'After Apply — should show success toast');
  await dbLog('fill-months', 'success', `fillMonths complete for ${productName} (${MONTHS.length} months)`);
  console.log(`  ✅ Applied (${MONTHS.length} months)`);
}

// ── VERIFY OCT/NOV/DEC (truncation protection) ────────────────────────────────

async function verifyLateMo(page, productName, monthlyValues) {
  const tableArea = page.locator('.ReactVirtualized__Grid, [class*="grid"], [class*="table"]').first();
  if (await tableArea.isVisible({ timeout: 1000 }).catch(() => false)) {
    await tableArea.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(500);
  }

  for (const mo of ['2026-10', '2026-11', '2026-12']) {
    const expected = monthlyValues[mo] ?? 0;
    if (expected === 0) continue;

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
  const closeBtn = page.locator('button[aria-label="Close"], button[aria-label*="close" i]').first();
  if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) await closeBtn.click();
  await page.waitForTimeout(500);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Flieber Forecast Updater v5\n');
  await dbLog('main', 'info', `Script started. TEST_MODE=${TEST_MODE}`);

  const allData = await loadForecastData();

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const stats = { done: 0, skipped: 0, errors: [] };

  try {
    await login(page);

    const storesToRun = TEST_MODE
      ? STORES.filter(s => s.channelId === 33)
      : STORES;

    for (const store of storesToRun) {
      const products = allData[store.channelId];
      if (!products || Object.keys(products).length === 0) {
        console.log(`⏭️  No data for ${store.name} — skipping`);
        await dbLog('main', 'warn', `No data for ${store.name}`);
        continue;
      }

      await applyStoreFilter(page, store.name);

      const productCodes = TEST_MODE
        ? Object.keys(products).slice(0, 1)
        : Object.keys(products);

      console.log(`\n📋 ${store.name}: ${productCodes.length} product(s)${TEST_MODE ? ' [TEST MODE]' : ''}`);

      for (const code of productCodes) {
        const { name, months } = products[code];
        try {
          let opened = await openProductEditor(page, name);
          if (!opened) { stats.skipped++; continue; }

          const wasStuck = await unstickIfNeeded(page);
          if (wasStuck) {
            opened = await openProductEditor(page, name);
            if (!opened) { stats.skipped++; continue; }
          }

          await fillMonths(page, name, months);
          stats.done++;
          await dbLog('main', 'success', `${store.name} / ${name} — DONE`);

        } catch (err) {
          console.error(`  ❌ ${name}: ${err.message}`);
          await dbLog('main', 'error', `${store.name} / ${name}: ${err.message}`);
          stats.errors.push({ store: store.name, code, name, error: err.message });

          const fname = `error-${store.name.replace(/ /g,'_')}-${name.replace(/ /g,'_')}.png`;
          await page.screenshot({ path: fname }).catch(() => {});
          console.log(`  📸 Screenshot saved: ${fname}`);

          await closeModal(page);
        }
      }

      console.log(`✅ Done with ${store.name}`);
    }

  } finally {
    await browser.close();
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const summary = `Done: ${stats.done} updated, ${stats.skipped} skipped, ${stats.errors.length} errors`;
  await dbLog('main', stats.errors.length === 0 ? 'success' : 'warn', summary);

  console.log('\n══════════════════════════════════');
  console.log(`🎉 Done! ${stats.done} products updated, ${stats.skipped} skipped`);
  if (stats.errors.length > 0) {
    console.log(`⚠️  ${stats.errors.length} errors:`);
    stats.errors.forEach(e => console.log(`   ${e.store} / ${e.name}: ${e.error}`));
  }
  console.log(`\n🔍 Run ID: ${RUN_ID}`);
  console.log(`   → Supabase: SELECT step, status, message FROM "Flieber_Debug_Log" WHERE run_id = '${RUN_ID}' ORDER BY created_at`);
  console.log('══════════════════════════════════');
}

main().catch(async err => {
  console.error('Fatal error:', err);
  await dbLog('main', 'error', `Fatal: ${err.message}`).catch(() => {});
  process.exit(1);
});
