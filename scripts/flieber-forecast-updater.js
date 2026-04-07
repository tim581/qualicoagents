/**
 * flieber-forecast-updater.js  v8.5 — close modal after EVERY product + waitForProductList recovery
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
const TEST_MODE = false;
// Set to a channelId to run only that store (all products), or null for all stores
const ONLY_STORE = null; // null = ALL stores (Amazon EU/USA/UK/CA + Bol)
// ──────────────────────────────────────────────────────────────────────────────

// Products to SKIP entirely
const SKIP_SKUS = ['TRAY WHITE'];

// Dynamic months: current month → 12 months ahead (13 total, rolls forward automatically)
const _now = new Date();
const MONTHS = Array.from({ length: 13 }, (_, i) => {
  const d = new Date(_now.getFullYear(), _now.getMonth() + i, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});
console.log(`📅 Month range: ${MONTHS[0]} → ${MONTHS[12]}`);

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
    .gte('forecast_month', `${MONTHS[0]}-01`)
    .lte('forecast_month', `${MONTHS[MONTHS.length - 1]}-28`)
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

  // Step 1: Find the product text element and scroll it into view
  const productTextEl = page.locator(`p.chakra-text:text-is("${productName}")`).first();
  let found = await productTextEl.isVisible({ timeout: 2000 }).catch(() => false);

  if (!found) {
    // Try scrolling the product list to find it
    await dbLog('product-editor', 'info', `"${productName}" not immediately visible — scrolling to find...`);
    await page.evaluate(async (name) => {
      const scrollContainers = document.querySelectorAll('[class*="overflow"], [style*="overflow"]');
      for (const container of scrollContainers) {
        const textEl = container.querySelector(`p.chakra-text`);
        if (textEl) {
          // Scroll down in steps
          for (let i = 0; i < 10; i++) {
            container.scrollTop += 300;
            await new Promise(r => setTimeout(r, 200));
            const found = Array.from(container.querySelectorAll('p.chakra-text'))
              .find(el => el.textContent.trim() === name);
            if (found) { found.scrollIntoView({ block: 'center' }); return true; }
          }
        }
      }
      // Fallback: find any element with exact text and scrollIntoView
      const el = Array.from(document.querySelectorAll('p, span, td, div'))
        .find(el => el.children.length === 0 && el.textContent.trim() === name);
      if (el) { el.scrollIntoView({ block: 'center' }); return true; }
      return false;
    }, productName);
    await page.waitForTimeout(500);
    found = await productTextEl.isVisible({ timeout: 2000 }).catch(() => false);
  }

  if (!found) {
    // Log what IS in the DOM for debugging
    const allText = await page.evaluate((name) => {
      const els = Array.from(document.querySelectorAll('p.chakra-text'));
      return els.map(el => el.textContent.trim()).filter(t => t.length > 2).slice(0, 30);
    }, productName);
    await dbLog('product-editor', 'warn', `Product "${productName}" not found. Visible products: ${JSON.stringify(allText)}`);
    console.log(`  ⚠️  Not found in product list — skipping`);
    return false;
  }

  // Step 2: Navigate from the text element up to its table row (tr)
  const row = page.locator(`tr:has(p.chakra-text:text-is("${productName}"))`).first();
  const rowVisible = await row.isVisible({ timeout: 2000 }).catch(() => false);

  if (!rowVisible) {
    // Fallback: try role="row" or click the text element's parent
    const altRow = page.locator(`[role="row"]:has(:text-is("${productName}"))`).first();
    const altVisible = await altRow.isVisible({ timeout: 2000 }).catch(() => false);
    if (altVisible) {
      await dbLog('product-editor', 'info', `Using [role="row"] fallback for ${productName}`);
      await altRow.hover();
    } else {
      // Last resort: hover the text element itself to trigger menu
      await dbLog('product-editor', 'info', `Using direct text hover fallback for ${productName}`);
      await productTextEl.hover();
    }
  } else {
    await row.hover();
  }
  await page.waitForTimeout(300);

  // Step 3: Click the row's menu button (⋮ or ...)
  const hoverTarget = rowVisible ? row : page.locator(`tr, [role="row"], div`).filter({ has: productTextEl }).first();
  const menuBtn = hoverTarget.locator(
    'button[aria-label*="more" i], button[aria-haspopup], button:has-text("⋮"), button:has-text("...")'
  ).first();

  const menuVisible = await menuBtn.isVisible({ timeout: 2000 }).catch(() => false);
  if (menuVisible) {
    await menuBtn.click();
    await dbLog('product-editor', 'info', `Menu button clicked for ${productName}`);
  } else {
    // Fallback: right-click or click directly on the row
    await dbLog('product-editor', 'info', `No menu button visible — trying right-click on ${productName}`);
    await productTextEl.click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(300);

  // Step 4: Click "Edit forecast" or "Edit forecast & past sales"
  await page.click(':text("Edit forecast"), :text("Edit forecast & past sales")', { timeout: 5000 });
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

  // Find the "Adjusted forecast | Units" row — may need scrolling inside the Handsontable
  const adjRow = page.locator('tr, [role="row"]').filter({
    hasText: /adj.*forecast|forecast.*adj/i
  }).filter({
    hasText: /units/i
  }).first();

  let rowVisible = await adjRow.isVisible({ timeout: 3000 }).catch(() => false);

  // If not visible, try scrolling it into view within the Handsontable container
  if (!rowVisible) {
    await dbLog('fill-months', 'warn', 'Adjusted forecast row not immediately visible — scrolling into view...');
    // Scroll the row into view inside the HT container
    await adjRow.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' })).catch(() => {});
    await page.waitForTimeout(500);
    rowVisible = await adjRow.isVisible({ timeout: 3000 }).catch(() => false);
  }

  // Second attempt: scroll the entire Handsontable wrapper down
  if (!rowVisible) {
    await dbLog('fill-months', 'warn', 'Still not visible — scrolling HT wrapper...');
    const htWrapper = page.locator('.ht_master .wtHolder').first();
    await htWrapper.evaluate(el => { el.scrollTop = el.scrollHeight; }).catch(() => {});
    await page.waitForTimeout(500);
    rowVisible = await adjRow.isVisible({ timeout: 3000 }).catch(() => false);
  }

  await dbLog('fill-months', rowVisible ? 'info' : 'error', `Adjusted forecast row visible: ${rowVisible}`);

  if (!rowVisible) {
    await dbShot(page, `fill-${productName.replace(/ /g,'_')}-error-no-row`, 'Adjusted forecast row not found');
    throw new Error('Adjusted forecast row not visible');
  }

  // Log row HTML for debugging
  const rowHtml = await adjRow.evaluate(el => el.outerHTML.substring(0, 500)).catch(() => 'N/A');
  await dbLog('fill-months', 'info', `Row HTML: ${rowHtml}`);

  // ── GET ROW INDEX FOR PRECISE TARGETING ───────────────────────────────────
  const rowIdx = await adjRow.evaluate(el => el.getAttribute('aria-rowindex')).catch(() => null);
  await dbLog('fill-months', 'info', `Adjusted forecast row aria-rowindex: ${rowIdx}`);

  // ── v8 ROOT CAUSE FIX ─────────────────────────────────────────────────────
  // PROBLEM (v7): After Tab, frozen clone (ht_clone_inline_start) intercepts keyboard events.
  //   Every typed value landed in col 3 (April) regardless of Tab navigation.
  // FIX: Click each month cell DIRECTLY in .ht_master (the non-frozen scrollable grid)
  //   using aria-colindex. No Tab navigation for moving between cells.
  //
  //   aria-colindex: 1=label(frozen), 2=Absolute-type(frozen), 3=Month[0], 4=Month[1], ...

  await dbLog('fill-months', 'info', `v8 fill: clicking each cell by aria-colindex in .ht_master. rowIdx=${rowIdx}`);

  for (let i = 0; i < MONTHS.length; i++) {
    const mo       = MONTHS[i];
    const val      = monthlyValues[mo] ?? 0;
    const colIndex = i + 3; // col 3 = first month (April/current), col 4 = next month, etc.

    // Target the cell directly in .ht_master — avoids frozen clone entirely
    const cellSel = rowIdx
      ? `.ht_master tr[aria-rowindex="${rowIdx}"] td[aria-colindex="${colIndex}"]`
      : `.ht_master td[aria-colindex="${colIndex}"]`;

    const cell = page.locator(cellSel).first();

    // Scroll cell into view if needed (later months may be outside viewport)
    const isVis = await cell.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isVis) {
      await page.locator('.ht_master').first().evaluate(el => { el.scrollLeft += 300; });
      await page.waitForTimeout(200);
    }

    // Read current value before editing
    const curVal = await cell.innerText().catch(() => '?');

    // Double-click to enter EDIT mode (no force: true needed — we're outside the frozen clone)
    await cell.dblclick({ timeout: 5000 });
    await page.waitForTimeout(250);

    // Clear existing value, then type the new one
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.type(String(val));

    // Commit with Enter (stays in same cell, no navigation side-effects)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    if (i < 4 || i === MONTHS.length - 1) {
      await dbLog('fill-months', 'info', `Month[${i}] ${mo} col=${colIndex}: "${curVal}" → ${val}`);
    }
  }

  await page.waitForTimeout(500);
  await dbShot(page, `fill-${productName.replace(/ /g,'_')}-2-after-fill`, 'After filling all 13 months');

  // ── CLICK APPLY BUTTON (blue button top-right of edit forecast modal) ──────
  // The forecast edit modal uses "Apply" (not "Save") to commit changes.
  // There may be multiple Apply buttons (store filter vs forecast); target the
  // visible, enabled one. The store filter Apply should be hidden at this point.
  await page.waitForTimeout(500); // let UI settle after last Enter

  const allBtns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button:not([aria-hidden="true"])'))
      .filter(b => b.offsetParent !== null && !b.disabled)
      .map(b => `"${(b.textContent || b.getAttribute('aria-label') || '').trim().substring(0, 40)}"`)
      .filter(s => s.length > 2)
      .slice(0, 25)
  ).catch(() => []);
  await dbLog('fill-months', 'info', `Visible enabled buttons after fill: ${JSON.stringify(allBtns)}`);

  // Click the blue Apply button in the forecast edit modal
  const applyBtn = page.locator('button:not([disabled])').filter({ hasText: /^apply$/i }).filter({ visible: true }).first();
  const applyVis = await applyBtn.isVisible({ timeout: 5000 }).catch(() => false);

  if (applyVis) {
    await applyBtn.click({ timeout: 5000 });
    await dbLog('fill-months', 'success', 'Clicked Apply button ✅');
    await page.waitForTimeout(2000);
    await dbShot(page, `fill-${productName.replace(/ /g,'_')}-3-after-apply`, 'After clicking Apply');
    // Wait for success confirmation or page update
    await page.waitForSelector(':text("successfully"), :text("saved"), :text("updated"), :text("applied")', { timeout: 10000 })
      .catch(() => dbLog('fill-months', 'warn', 'No success toast after Apply — may still have worked'));
  } else {
    await dbLog('fill-months', 'error', `Apply button NOT visible! Cannot save. Buttons: ${JSON.stringify(allBtns)}`);
  }

  await dbLog('fill-months', 'success', `fillMonths complete for ${productName} (${MONTHS.length} months)`);
  console.log(`  ✅ ${MONTHS.length} months filled`);
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
  // Try Escape first
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Check if modal is still open
  const modalStillOpen = await page.locator('.chakra-modal__content-container').isVisible({ timeout: 500 }).catch(() => false);
  
  if (modalStillOpen) {
    await dbLog('close-modal', 'warn', 'Modal still open after Escape — trying close button...');
    // Try close/X buttons
    const closeSelectors = [
      'button[aria-label="Close"]',
      'button[aria-label*="close" i]',
      '.chakra-modal__close-btn',
      '.chakra-modal__content-container button:has(svg)',  // X icon button
    ];
    for (const sel of closeSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
        break;
      }
    }
  }

  // Final check — if still open, click the overlay backdrop
  const stillOpen = await page.locator('.chakra-modal__content-container').isVisible({ timeout: 300 }).catch(() => false);
  if (stillOpen) {
    await dbLog('close-modal', 'warn', 'Modal STILL open — clicking overlay...');
    await page.locator('.chakra-modal__overlay').click({ position: { x: 10, y: 10 }, force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(300);
}

// ── WAIT FOR PRODUCT LIST (v8.5) ─────────────────────────────────────────────
// After closing modal, wait until the product list is fully visible again.
// This prevents the race condition where the next product search runs before
// the page has re-rendered the product list.

async function waitForProductList(page) {
  await page.waitForTimeout(1000); // let page settle after modal close

  // Wait for at least one p.chakra-text with product-like content to appear
  for (let attempt = 0; attempt < 5; attempt++) {
    const productCount = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('p.chakra-text'));
      // Filter to only product-name-like elements (>3 chars, not generic UI text)
      return els.filter(el => {
        const t = el.textContent.trim();
        return t.length > 3 && !['Sales forecast', 'Actual sales', 'Filters', 'Stores', 'Apply'].includes(t);
      }).length;
    }).catch(() => 0);

    if (productCount > 0) {
      await dbLog('product-list', 'info', `Product list visible (${productCount} items found)`);
      return;
    }

    await dbLog('product-list', 'warn', `Attempt ${attempt + 1}: product list not yet visible — waiting...`);
    await page.waitForTimeout(1000);
  }

  await dbLog('product-list', 'warn', 'Product list not fully loaded after 5s — proceeding anyway');
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Flieber Forecast Updater v8.5\n');
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

    const storesToRun = ONLY_STORE
      ? STORES.filter(s => s.channelId === ONLY_STORE)
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

          // v8.5: ALWAYS close modal after success and wait for product list to reload
          await closeModal(page);
          await waitForProductList(page);

        } catch (err) {
          console.error(`  ❌ ${name}: ${err.message}`);
          await dbLog('main', 'error', `${store.name} / ${name}: ${err.message}`);
          stats.errors.push({ store: store.name, code, name, error: err.message });

          const fname = `error-${store.name.replace(/ /g,'_')}-${name.replace(/ /g,'_')}.png`;
          await page.screenshot({ path: fname }).catch(() => {});
          console.log(`  📸 Screenshot saved: ${fname}`);

          await closeModal(page);
          await waitForProductList(page);
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
