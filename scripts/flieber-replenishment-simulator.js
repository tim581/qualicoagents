/**
 * flieber-replenishment-simulator.js  v1.3
 *
 * Runs PO (Purchase) and TO (Transfer) simulations in Flieber, then fetches
 * results via GraphQL API and logs everything to Supabase Flieber_Debug_Log.
 *
 * PO config:  arrival = today + 120 calendar days, coverage = 120 days
 * TO config:  departure = today + 7 business days, arrival = today + 17 business days, coverage = 70 days
 *
 * Prerequisites (on Tim's machine):
 *   cd C:\Users\Tim\playwright-render-service
 *   npm install @supabase/supabase-js          (playwright + dotenv already installed)
 *   node flieber-replenishment-simulator.js
 *
 * .env must contain:
 *   SUPABASE_URL=https://zlteahycfmpiaxdbnlvr.supabase.co
 *   SUPABASE_KEY=<service_role key>
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const FLIEBER_EMAIL    = 'Tim@qualico.be';
const FLIEBER_PASSWORD = '{FDd@dqE5y{@K2y^t{W1';
const FLIEBER_URL      = 'https://app.flieber.com/app/inventory-forecast';
const GRAPHQL_URL      = 'https://app.flieber.com/api/graphql';
const GRAPHQL_TOKEN    = 'Bearer 019cca1e-4959-72af-8113-f95bb6dba3a1:iJd1NgmpCqzORumpBDNjmQSMTa1LisjrKLPXXM4n1os';

// ── MODE ──────────────────────────────────────────────────────────────────────
// Set to 'po', 'to', or 'both' to control which simulations to run
const RUN_MODE = 'both'; // 'po' | 'to' | 'both'

// PO parameters
const PO_ARRIVAL_DAYS   = 120; // calendar days from today (60 production + 60 shipping)
const PO_COVERAGE_DAYS  = 120;

// TO parameters
const TO_DEPARTURE_BIZ_DAYS = 7;   // business days from today
const TO_ARRIVAL_BIZ_DAYS   = 17;  // business days from today
const TO_COVERAGE_DAYS      = 70;

// ── DATE HELPERS ──────────────────────────────────────────────────────────────

function addCalendarDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addBusinessDays(date, bizDays) {
  const d = new Date(date);
  let added = 0;
  while (added < bizDays) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++; // skip Sat(6) and Sun(0)
  }
  return d;
}

function formatDate(d) {
  // Returns 'YYYY-MM-DD'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TODAY = new Date();
const PO_ARRIVAL_DATE     = addCalendarDays(TODAY, PO_ARRIVAL_DAYS);
const TO_DEPARTURE_DATE   = addBusinessDays(TODAY, TO_DEPARTURE_BIZ_DAYS);
const TO_ARRIVAL_DATE     = addBusinessDays(TODAY, TO_ARRIVAL_BIZ_DAYS);

console.log(`📅 Today:          ${formatDate(TODAY)}`);
console.log(`📅 PO arrival:     ${formatDate(PO_ARRIVAL_DATE)} (today + ${PO_ARRIVAL_DAYS} calendar days)`);
console.log(`📅 TO departure:   ${formatDate(TO_DEPARTURE_DATE)} (today + ${TO_DEPARTURE_BIZ_DAYS} business days)`);
console.log(`📅 TO arrival:     ${formatDate(TO_ARRIVAL_DATE)} (today + ${TO_ARRIVAL_BIZ_DAYS} business days)`);
console.log(`🔧 Mode:           ${RUN_MODE}\n`);

// ── SELF-DEBUGGING: SUPABASE LOG ──────────────────────────────────────────────

const RUN_ID = `replenish_${Date.now()}`;
console.log(`🔍 Debug run ID: ${RUN_ID}`);
console.log(`   → Query Supabase "Flieber_Debug_Log" WHERE run_id = '${RUN_ID}' after run\n`);

async function dbLog(step, status, message) {
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
    console.log(`  📸 Screenshot → ${step} (${label})`);
  } catch (e) { /* never break the main flow */ }
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

// ── DATE PICKER HELPER ────────────────────────────────────────────────────────
// Navigates the calendar date picker to the target date and clicks the day.
// The calendar shows month headers like "April 2026" with < > navigation arrows.

async function pickDate(page, targetDate, fieldLabel) {
  console.log(`  📅 Picking date: ${formatDate(targetDate)} for "${fieldLabel}"`);
  await dbLog('date-picker', 'info', `Picking ${formatDate(targetDate)} for ${fieldLabel}`);

  // NOTE: Use page-level selectors (Chakra UI renders modals in portals).
  
  // Strategy: Find the label, then find the "Set date" button in the same row/container.
  // From screenshot: layout is label on top, "📅 Set date" button below.
  const labelEl = page.getByText(fieldLabel, { exact: false }).first();
  await labelEl.waitFor({ timeout: 5000 });
  
  // Go to parent wrapper and find the date button
  const wrapper = labelEl.locator('..');
  let clicked = false;
  
  // Approach 1: Find "Set date" text in the wrapper
  try {
    const setDateBtn = wrapper.getByText('Set date', { exact: false }).first();
    await setDateBtn.click({ timeout: 3000 });
    clicked = true;
  } catch {}
  
  // Approach 2: Find input or button with calendar-like attributes in wrapper
  if (!clicked) {
    try {
      const dateBtn = wrapper.locator('button, input[type="text"], [class*="date"], [class*="Date"]').first();
      await dateBtn.click({ timeout: 3000 });
      clicked = true;
    } catch {}
  }
  
  // Approach 3: Broader — find all "Set date" buttons in modal by position
  if (!clicked) {
    try {
      const allDateBtns = page.getByText('Set date', { exact: false });
      const count = await allDateBtns.count();
      console.log(`  ℹ️ Found ${count} "Set date" buttons in modal`);
      
      // For PO: only 1 date field → index 0
      // For TO: "departure" = index 0, "arrival" = index 1
      const idx = fieldLabel.toLowerCase().includes('departure') ? 0 :
                  fieldLabel.toLowerCase().includes('arrival') && count > 1 ? 1 : 0;
      await allDateBtns.nth(idx).click({ timeout: 3000 });
      clicked = true;
    } catch {}
  }
  
  if (!clicked) {
    await dbShot(page, `date-fail-${fieldLabel}`, `Could not open date picker for ${fieldLabel}`);
    throw new Error(`Failed to open date picker: ${fieldLabel}`);
  }
  
  await page.waitForTimeout(1000);
  await dbShot(page, 'date-picker-opened', `Calendar opened for ${fieldLabel}`);
  
  // Now navigate to the correct month
  const targetMonth = targetDate.getMonth(); // 0-indexed
  const targetYear = targetDate.getFullYear();
  const targetDay = targetDate.getDate();
  
  // Calendar header shows something like "April 2026"
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const targetMonthStr = `${monthNames[targetMonth]} ${targetYear}`;
  
  // Navigate forward until we see the target month
  let attempts = 0;
  while (attempts < 24) { // max 24 months forward
    // Broad set of selectors for calendar month header (Chakra UI, React DatePicker, etc.)
    const headerText = await page.locator('[class*="calendar"] [class*="header"], [class*="Calendar"] [class*="Header"], th[colspan], [class*="month-year"], [aria-live], [class*="datepicker"] [class*="heading"], [class*="DatePicker"] [class*="title"], [class*="calendar-header"], [class*="month-label"]')
      .first().textContent().catch(async () => {
        // Fallback: find any text on page matching "MonthName YYYY" pattern
        const allText = await page.locator('text=/(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{4}/').first().textContent().catch(() => '');
        return allText;
      });
    
    if (headerText.includes(monthNames[targetMonth]) && headerText.includes(String(targetYear))) {
      console.log(`  ✅ Calendar showing: ${headerText}`);
      break;
    }
    
    // Click next month arrow
    const nextBtn = page.locator('[class*="calendar"] button[aria-label*="next" i], [class*="calendar"] button:has-text(">"), [class*="Calendar"] [class*="next"], button[aria-label="Next Month"], [class*="navigation"] button:last-child, button:has([class*="chevron-right"]), button:has([class*="right"])').first();
    await nextBtn.click({ timeout: 3000 }).catch(async () => {
      // Fallback: try the > arrow button
      await page.locator('button:has-text("›"), button:has-text(">")').last().click({ timeout: 3000 });
    });
    await page.waitForTimeout(500);
    attempts++;
  }
  
  if (attempts >= 24) {
    await dbLog('date-picker', 'error', `Could not navigate to ${targetMonthStr} after 24 attempts`);
    throw new Error(`Calendar navigation failed for ${targetMonthStr}`);
  }
  
  // Click the target day
  // Days are typically buttons or td elements with just the number
  const dayBtn = page.locator(`[class*="calendar"] button:text-is("${targetDay}"), [class*="Calendar"] button:text-is("${targetDay}"), td:text-is("${targetDay}"), [role="gridcell"]:text-is("${targetDay}"), button[aria-label*="${targetDay}"]`).first();
  
  await dayBtn.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  
  await dbLog('date-picker', 'success', `Selected ${formatDate(targetDate)} for ${fieldLabel}`);
  console.log(`  ✅ Date selected: ${formatDate(targetDate)}`);
}

// ── MULTI-SELECT "SELECT ALL" HELPER ──────────────────────────────────────────
// NOTE: Chakra UI modals render in portals. Do NOT scope selectors inside
// a modal locator — use page-level selectors instead.

async function clickSelectAll(page, dropdownLabel) {
  console.log(`  🔽 Opening "${dropdownLabel}" dropdown and selecting all...`);
  await dbLog('select-all', 'info', `Opening ${dropdownLabel} dropdown`);
  
  // Strategy: Use page-level selectors (NOT modal-scoped) because Chakra UI
  // renders modals in portals that don't match typical modal CSS selectors.
  
  let clicked = false;
  
  // Approach 1: Find the label text, go to parent, find combobox input inside
  try {
    const labelEl = page.getByText(dropdownLabel, { exact: false }).first();
    await labelEl.waitFor({ timeout: 5000 });
    // Go up multiple levels to find the container with the React Select
    // Try parent, grandparent, great-grandparent
    for (const levels of ['..', '../..', '../../..']) {
      try {
        const wrapper = labelEl.locator(levels);
        const combobox = wrapper.locator('input[role="combobox"]').first();
        await combobox.click({ timeout: 2000 });
        clicked = true;
        break;
      } catch {}
    }
  } catch (e) {
    console.log(`  ⚠️ Could not find label "${dropdownLabel}": ${e.message.substring(0, 100)}`);
  }
  
  // Approach 2: Use all combobox inputs on the page and pick by index
  // IMPORTANT: After filling one dropdown, its combobox may disappear. So if only
  // 1 combobox remains, click it regardless of which dropdown we're targeting.
  if (!clicked) {
    try {
      const allComboboxes = page.locator('input[role="combobox"]');
      const count = await allComboboxes.count();
      console.log(`  ℹ️ Found ${count} combobox inputs on page`);
      
      if (count === 1) {
        // Only one left — must be the one we want
        await allComboboxes.first().scrollIntoViewIfNeeded();
        await allComboboxes.first().click({ timeout: 3000 });
        clicked = true;
      } else if (count > 1) {
        // Multiple comboboxes: destinations = first, suppliers/origins = second
        const idx = dropdownLabel.toLowerCase().includes('destination') ? 0 : 1;
        await allComboboxes.nth(idx).scrollIntoViewIfNeeded();
        await allComboboxes.nth(idx).click({ timeout: 3000 });
        clicked = true;
      }
    } catch (e) {
      console.log(`  ⚠️ Combobox approach failed: ${e.message.substring(0, 100)}`);
    }
  }
  
  // Approach 3: Click the placeholder "Select..." text
  if (!clicked) {
    try {
      const allPlaceholders = page.locator('[class*="placeholder"]:text("Select...")');
      const count = await allPlaceholders.count();
      console.log(`  ℹ️ Found ${count} "Select..." placeholders`);
      if (count === 1) {
        await allPlaceholders.first().click({ timeout: 3000 });
        clicked = true;
      } else if (count > 1) {
        const idx = dropdownLabel.toLowerCase().includes('destination') ? 0 : 1;
        await allPlaceholders.nth(idx).click({ timeout: 3000 });
        clicked = true;
      }
    } catch {}
  }
  
  if (!clicked) {
    await dbShot(page, `select-fail-${dropdownLabel}`, `Could not open dropdown: ${dropdownLabel}`);
    throw new Error(`Failed to open dropdown: ${dropdownLabel}`);
  }
  
  await page.waitForTimeout(1000);
  await dbShot(page, `select-opened-${dropdownLabel.replace(/\s+/g, '-').toLowerCase()}`, `Dropdown opened: ${dropdownLabel}`);
  
  // Now look for "Select all" option in the dropdown menu
  // React Select renders options in a portal or menu div
  try {
    const selectAllOption = page.getByText('Select all', { exact: false }).first();
    await selectAllOption.click({ timeout: 5000 });
  } catch {
    // Fallback: try clicking checkboxes or option items
    // Some multi-selects have individual checkboxes — click them all
    await dbShot(page, `select-no-selectall-${dropdownLabel.replace(/\s+/g, '-').toLowerCase()}`, 'No "Select all" found — checking options');
    
    const options = page.locator('[class*="option"], [class*="Option"], [role="option"]');
    const optCount = await options.count();
    console.log(`  ℹ️ Found ${optCount} options — clicking each...`);
    
    for (let i = 0; i < optCount; i++) {
      try {
        await options.nth(i).click({ timeout: 2000 });
        await page.waitForTimeout(200);
      } catch { break; }
    }
  }
  
  await page.waitForTimeout(500);
  
  // Close dropdown: click outside (Escape doesn't reliably close React Select)
  // Click the modal title/description text to dismiss the dropdown menu
  try {
    // Try clicking the modal header/description text to unfocus the dropdown
    const modalTitle = page.getByText('Select the destination', { exact: false }).first();
    await modalTitle.click({ timeout: 2000 });
  } catch {
    try {
      // Fallback: click body or any non-interactive area
      await page.locator('body').click({ position: { x: 10, y: 10 } });
    } catch {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  await page.waitForTimeout(500);
  
  await dbLog('select-all', 'success', `Selected all for ${dropdownLabel}`);
  console.log(`  ✅ Selected all for "${dropdownLabel}"`);
}

// ── FILL COVERAGE INPUT ──────────────────────────────────────────────────────

async function fillCoverageInput(page, days) {
  // "Days of coverage" label → find the number input near it
  // NOTE: Use page-level selectors (Chakra UI portal)
  let filled = false;
  
  // Approach 1: Find "Days of coverage" label, navigate to parent, find input
  try {
    const labelEl = page.getByText('Days of coverage', { exact: false }).first();
    await labelEl.waitFor({ timeout: 5000 });
    
    for (const levels of ['..', '../..', '../../..']) {
      try {
        const wrapper = labelEl.locator(levels);
        const input = wrapper.locator('input:not([role="combobox"]):not([id*="react-select"])').first();
        await input.click({ timeout: 2000 });
        await input.fill('');
        await input.type(String(days));
        filled = true;
        break;
      } catch {}
    }
  } catch {}
  
  // Approach 2: Find input[type="number"] on page
  if (!filled) {
    try {
      const numInput = page.locator('input[type="number"]').first();
      await numInput.click({ timeout: 3000 });
      await numInput.fill('');
      await numInput.type(String(days));
      filled = true;
    } catch {}
  }
  
  // Approach 3: Find non-combobox inputs on page and pick last one (coverage is last)
  if (!filled) {
    try {
      const allInputs = page.locator('input:visible:not([role="combobox"]):not([id*="react-select"]):not([type="email"]):not([type="password"])');
      const count = await allInputs.count();
      console.log(`  ℹ️ Found ${count} non-combobox visible inputs on page`);
      if (count > 0) {
        const lastInput = allInputs.nth(count - 1);
        await lastInput.click({ timeout: 3000 });
        await lastInput.fill('');
        await lastInput.type(String(days));
        filled = true;
      }
    } catch {}
  }
  
  if (!filled) {
    await dbShot(page, 'coverage-fail', `Could not fill coverage input with ${days}`);
    throw new Error(`Failed to fill coverage input with ${days}`);
  }
  
  await page.waitForTimeout(500);
  console.log(`  ✅ Coverage set to ${days} days`);
}

// ── EXTRACT SIMULATION ID FROM URL ────────────────────────────────────────────

function extractSimId(url) {
  const match = url.match(/\/replenishment\/(?:purchase|transfer)\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

// ── FETCH RESULTS VIA GRAPHQL ─────────────────────────────────────────────────

async function fetchSimulationResults(simId, type) {
  console.log(`\n📡 Fetching ${type} simulation results for ${simId}...`);
  await dbLog(`api-${type}`, 'info', `Fetching results for sim ${simId}`);
  
  const allItems = [];
  let hasNext = true;
  let offset = 0;
  const limit = 100;
  
  while (hasNext) {
    const query = `{
      replenishment_simulation_products(
        simulationId: "${simId}",
        pagination: { limit: ${limit}, offset: ${offset} }
      ) {
        items {
          productName
          locationName
          replenishmentUnits
          onHandUnits
          coverageDays
        }
        pageInfo {
          hasNext
        }
      }
    }`;
    
    const resp = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': GRAPHQL_TOKEN,
      },
      body: JSON.stringify({ query }),
    });
    
    if (!resp.ok) {
      const text = await resp.text();
      await dbLog(`api-${type}`, 'error', `HTTP ${resp.status}: ${text}`);
      throw new Error(`GraphQL API error: ${resp.status}`);
    }
    
    const json = await resp.json();
    
    if (json.errors) {
      await dbLog(`api-${type}`, 'error', `GraphQL errors: ${JSON.stringify(json.errors)}`);
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    
    const data = json.data.replenishment_simulation_products;
    allItems.push(...data.items);
    hasNext = data.pageInfo.hasNext;
    offset += limit;
    
    console.log(`  📦 Fetched ${allItems.length} items so far (hasNext: ${hasNext})`);
  }
  
  await dbLog(`api-${type}`, 'success', `Fetched ${allItems.length} result rows`);
  console.log(`✅ ${type.toUpperCase()} results: ${allItems.length} items`);
  
  return allItems;
}

// ── LOG RESULTS TO SUPABASE DEBUG LOG ─────────────────────────────────────────

async function logResults(items, type, simId) {
  // Log a summary + full JSON to debug log
  const summary = items.map(i => `${i.productName} @ ${i.locationName}: ${i.replenishmentUnits} units (on-hand: ${i.onHandUnits}, coverage: ${i.coverageDays}d)`);
  
  await dbLog(`results-${type}`, 'success', 
    `Simulation ${simId}\n` +
    `Total items: ${items.length}\n` +
    `Total replenishment units: ${items.reduce((s, i) => s + (i.replenishmentUnits || 0), 0)}\n\n` +
    summary.slice(0, 50).join('\n') + 
    (summary.length > 50 ? `\n... and ${summary.length - 50} more` : '')
  );
  
  // Also save full results as JSON to debug log
  await dbLog(`results-${type}-json`, 'info', JSON.stringify(items).substring(0, 3000));
  
  console.log(`\n📊 ${type.toUpperCase()} Summary:`);
  console.log(`   Items: ${items.length}`);
  console.log(`   Total reorder units: ${items.reduce((s, i) => s + (i.replenishmentUnits || 0), 0)}`);
  
  // Print top items
  const sorted = [...items].sort((a, b) => (b.replenishmentUnits || 0) - (a.replenishmentUnits || 0));
  console.log('   Top 10 by replenishment units:');
  for (const item of sorted.slice(0, 10)) {
    console.log(`     ${item.productName} @ ${item.locationName}: ${item.replenishmentUnits} units`);
  }
}

// ── RUN PO SIMULATION ─────────────────────────────────────────────────────────

async function runPOSimulation(page) {
  console.log('\n' + '='.repeat(60));
  console.log('📦 PURCHASE ORDER (PO) SIMULATION');
  console.log('='.repeat(60));
  
  await dbLog('po-start', 'info', `PO simulation: arrival=${formatDate(PO_ARRIVAL_DATE)}, coverage=${PO_COVERAGE_DAYS}d`);
  
  // Navigate to inventory forecast page
  await page.goto(FLIEBER_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  await dbShot(page, 'po-1-page-loaded', 'Inventory forecast page loaded');
  
  // Step 1: Click "Plan replenishment" button (top right)
  console.log('  🔘 Clicking "Plan replenishment"...');
  const planBtn = page.getByText('Plan replenishment', { exact: false }).first();
  await planBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await dbShot(page, 'po-2-plan-menu', 'Plan replenishment menu');
  
  // Step 2: Click "Start new purchase plan"
  console.log('  🔘 Clicking "Start new purchase plan"...');
  const purchaseOption = page.getByText('Start new purchase plan', { exact: false }).first();
  await purchaseOption.click({ timeout: 10000 });
  await page.waitForTimeout(2000);
  await dbShot(page, 'po-3-modal-open', 'Purchase plan modal opened');
  
  // Step 3: Select all destinations
  await clickSelectAll(page, 'Select destinations');
  await dbShot(page, 'po-4-destinations', 'Destinations selected');
  
  // Step 4: Select all suppliers
  await clickSelectAll(page, 'Select suppliers');
  await dbShot(page, 'po-5-suppliers', 'Suppliers selected');
  
  // Step 5: Set Target shipment arrival date
  await pickDate(page, PO_ARRIVAL_DATE, 'Target shipment arrival');
  await dbShot(page, 'po-6-arrival-date', `Arrival date set: ${formatDate(PO_ARRIVAL_DATE)}`);
  
  // Step 6: Set Days of coverage
  console.log(`  📝 Setting coverage days to ${PO_COVERAGE_DAYS}...`);
  await fillCoverageInput(page, PO_COVERAGE_DAYS);
  await dbShot(page, 'po-7-coverage', `Coverage set to ${PO_COVERAGE_DAYS}`);
  
  // Step 7: Click "Start purchase plan" button (the blue submit button, NOT the menu option)
  console.log('  🚀 Clicking "Start purchase plan"...');
  await dbShot(page, 'po-pre-submit', 'State before clicking Start purchase plan');
  // Use exact text to avoid matching "Start new purchase plan" menu item
  const startBtn = page.locator('button').filter({ hasText: /^Start purchase plan$/ }).first();
  try {
    await startBtn.click({ timeout: 5000 });
  } catch {
    // Fallback: find the colored/primary button (usually blue/green)
    const primaryBtn = page.locator('button[class*="primary"], button[class*="Primary"], button[class*="blue"], button[class*="colorScheme"]').filter({ hasText: 'Start' }).first();
    await primaryBtn.click({ timeout: 5000 }).catch(async () => {
      // Last resort: find all buttons with "Start purchase plan" text, click the LAST one (submit is after menu)
      const allBtns = page.getByText('Start purchase plan', { exact: false });
      const count = await allBtns.count();
      await allBtns.nth(count - 1).click({ timeout: 5000 });
    });
  }
  
  // Step 8: Wait for simulation to complete — URL changes to include sim ID
  console.log('  ⏳ Waiting for simulation to complete...');
  await dbLog('po-simulate', 'info', 'Waiting for simulation results...');
  
  await page.waitForURL('**/replenishment/purchase/**', { timeout: 120000 });
  await page.waitForTimeout(5000); // extra wait for data to load
  
  const simUrl = page.url();
  const simId = extractSimId(simUrl);
  
  if (!simId) {
    await dbLog('po-simulate', 'error', `Could not extract sim ID from URL: ${simUrl}`);
    throw new Error(`PO sim ID extraction failed. URL: ${simUrl}`);
  }
  
  await dbLog('po-simulate', 'success', `Simulation complete! ID: ${simId}`);
  await dbShot(page, 'po-8-results', 'PO simulation results page');
  console.log(`  ✅ PO Simulation ID: ${simId}`);
  
  // Step 9: Fetch results via GraphQL API
  const results = await fetchSimulationResults(simId, 'po');
  await logResults(results, 'po', simId);
  
  return { simId, results };
}

// ── RUN TO SIMULATION ─────────────────────────────────────────────────────────

async function runTOSimulation(page) {
  console.log('\n' + '='.repeat(60));
  console.log('🚚 TRANSFER ORDER (TO) SIMULATION');
  console.log('='.repeat(60));
  
  await dbLog('to-start', 'info', `TO simulation: departure=${formatDate(TO_DEPARTURE_DATE)}, arrival=${formatDate(TO_ARRIVAL_DATE)}, coverage=${TO_COVERAGE_DAYS}d`);
  
  // Navigate to inventory forecast page
  await page.goto(FLIEBER_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  await dbShot(page, 'to-1-page-loaded', 'Inventory forecast page loaded');
  
  // Step 1: Click "Plan replenishment" button
  console.log('  🔘 Clicking "Plan replenishment"...');
  const planBtn = page.getByText('Plan replenishment', { exact: false }).first();
  await planBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await dbShot(page, 'to-2-plan-menu', 'Plan replenishment menu');
  
  // Step 2: Click "Start new transfer plan"
  console.log('  🔘 Clicking "Start new transfer plan"...');
  const transferOption = page.getByText('Start new transfer plan', { exact: false }).first();
  await transferOption.click({ timeout: 10000 });
  await page.waitForTimeout(2000);
  await dbShot(page, 'to-3-modal-open', 'Transfer plan modal opened');
  
  // Step 3: Select all destinations
  await clickSelectAll(page, 'Select destinations');
  await dbShot(page, 'to-4-destinations', 'Destinations selected');
  
  // Step 4: Select all origins (optional)
  await clickSelectAll(page, 'Select origins');
  await dbShot(page, 'to-5-origins', 'Origins selected');
  
  // Step 5: Set Target shipment departure date
  await pickDate(page, TO_DEPARTURE_DATE, 'Target shipment departure');
  await dbShot(page, 'to-6-departure', `Departure date set: ${formatDate(TO_DEPARTURE_DATE)}`);
  
  // Step 6: Set Target shipment arrival date
  await pickDate(page, TO_ARRIVAL_DATE, 'Target shipment arrival');
  await dbShot(page, 'to-7-arrival', `Arrival date set: ${formatDate(TO_ARRIVAL_DATE)}`);
  
  // Step 7: Set Days of coverage
  console.log(`  📝 Setting coverage days to ${TO_COVERAGE_DAYS}...`);
  await fillCoverageInput(page, TO_COVERAGE_DAYS);
  await dbShot(page, 'to-8-coverage', `Coverage set to ${TO_COVERAGE_DAYS}`);
  
  // Step 8: Click "Start transfer plan" button (the blue submit button, NOT the menu option)
  console.log('  🚀 Clicking "Start transfer plan"...');
  await dbShot(page, 'to-pre-submit', 'State before clicking Start transfer plan');
  const startBtn = page.locator('button').filter({ hasText: /^Start transfer plan$/ }).first();
  try {
    await startBtn.click({ timeout: 5000 });
  } catch {
    const allBtns = page.getByText('Start transfer plan', { exact: false });
    const count = await allBtns.count();
    await allBtns.nth(count - 1).click({ timeout: 5000 });
  }
  
  // Step 9: Wait for simulation to complete
  console.log('  ⏳ Waiting for simulation to complete...');
  await dbLog('to-simulate', 'info', 'Waiting for simulation results...');
  
  await page.waitForURL('**/replenishment/transfer/**', { timeout: 120000 });
  await page.waitForTimeout(5000);
  
  const simUrl = page.url();
  const simId = extractSimId(simUrl);
  
  if (!simId) {
    await dbLog('to-simulate', 'error', `Could not extract sim ID from URL: ${simUrl}`);
    throw new Error(`TO sim ID extraction failed. URL: ${simUrl}`);
  }
  
  await dbLog('to-simulate', 'success', `Simulation complete! ID: ${simId}`);
  await dbShot(page, 'to-9-results', 'TO simulation results page');
  console.log(`  ✅ TO Simulation ID: ${simId}`);
  
  // Step 10: Fetch results via GraphQL API
  const results = await fetchSimulationResults(simId, 'to');
  await logResults(results, 'to', simId);
  
  return { simId, results };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: false }); // visible for debugging
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  
  try {
    await login(page);
    
    let poResult = null;
    let toResult = null;
    
    if (RUN_MODE === 'po' || RUN_MODE === 'both') {
      poResult = await runPOSimulation(page);
    }
    
    if (RUN_MODE === 'to' || RUN_MODE === 'both') {
      toResult = await runTOSimulation(page);
    }
    
    // ── FINAL SUMMARY ──────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL SIMULATIONS COMPLETE');
    console.log('='.repeat(60));
    
    if (poResult) {
      console.log(`\n📦 PO Simulation ID: ${poResult.simId}`);
      console.log(`   Results: ${poResult.results.length} items`);
      console.log(`   Total reorder: ${poResult.results.reduce((s, i) => s + (i.replenishmentUnits || 0), 0)} units`);
    }
    
    if (toResult) {
      console.log(`\n🚚 TO Simulation ID: ${toResult.simId}`);
      console.log(`   Results: ${toResult.results.length} items`);
      console.log(`   Total transfer: ${toResult.results.reduce((s, i) => s + (i.replenishmentUnits || 0), 0)} units`);
    }
    
    await dbLog('main', 'success', `Done! PO: ${poResult ? poResult.results.length + ' items' : 'skipped'}, TO: ${toResult ? toResult.results.length + ' items' : 'skipped'}`);
    
  } catch (err) {
    console.error(`\n❌ FATAL ERROR: ${err.message}`);
    await dbLog('main', 'error', err.message);
    await dbShot(page, 'error-final', 'State at fatal error');
  } finally {
    await browser.close();
  }
  
  console.log(`\n🔍 Debug: query Flieber_Debug_Log WHERE run_id = '${RUN_ID}'`);
})();
