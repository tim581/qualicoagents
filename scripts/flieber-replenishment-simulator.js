/**
 * flieber-replenishment-simulator.js  v3.0 — Fully rewritten pickDate: scoped to popover, simple > click, day click by text.
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
const RUN_MODE = process.env.RUN_MODE || 'both'; // 'po' | 'to' | 'both' — set by executor

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
// v1.7: Rewritten to use evaluate() for finding date inputs near labels.
// Chakra UI date fields are regular inputs, not "Set date" buttons.

// New pickDate function for v1.7
// Key changes:
// 1. Uses evaluate() to find label + nearby input/button (not "Set date" text)
// 2. Falls back to clicking all visible inputs near the label
// 3. Better Chakra calendar navigation

async function pickDate(page, targetDate, fieldLabel) {
  console.log(`  📅 Picking date: ${formatDate(targetDate)} for "${fieldLabel}"`);
  await dbLog('date-picker', 'info', `Picking ${formatDate(targetDate)} for ${fieldLabel}`);

  const targetMonth = targetDate.getMonth();
  const targetYear = targetDate.getFullYear();
  const targetDay = targetDate.getDate();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const targetMonthStr = `${monthNames[targetMonth]} ${targetYear}`;

  // STEP 1: Open calendar by clicking the date field near the label
  // CRITICAL: Use evaluate to FIND the element, but Playwright to CLICK it
  // DOM .click() does NOT trigger React/Chakra event handlers!
  
  // First: discover what's near the label for debugging
  const discovery = await page.evaluate((label) => {
    const allEls = [...document.querySelectorAll('*')];
    const labelEl = allEls.find(el => el.textContent?.trim() === label && el.children.length === 0);
    if (!labelEl) return { error: 'Label not found' };
    
    let container = labelEl.parentElement;
    const nearby = [];
    for (let i = 0; i < 4 && container; i++) {
      const els = container.querySelectorAll('input, button, [role="button"], [tabindex]');
      for (const el of els) {
        nearby.push({
          tag: el.tagName, 
          type: el.getAttribute('type'),
          placeholder: el.getAttribute('placeholder'),
          text: el.textContent?.trim()?.substring(0, 50),
          classes: (el.className || '').substring(0, 60)
        });
      }
      container = container.parentElement;
    }
    return { labelFound: true, nearbyCount: nearby.length, elements: nearby.slice(0, 10) };
  }, fieldLabel);
  await dbLog('date-picker-discovery', 'info', JSON.stringify(discovery).substring(0, 600));

  // Mark the target element with a data attribute so Playwright can find it
  // === REACT-DATEPICKER approach (discovered from v2.9 debug dump) ===
  // The calendar is a standard react-datepicker with known CSS classes:
  //   .react-datepicker__current-month  → "April 2026"
  //   .react-datepicker__navigation--next → forward button (OUTSIDE header!)
  //   .react-datepicker__day--0XX → day cells (zero-padded)
  
  // STEP 1: Click the date input to open the calendar
  // From v2.9 discovery: input has placeholder="Set date", class="chakra-input"
  const findResult = await page.evaluate((label) => {
    const allEls = [...document.querySelectorAll('*')];
    const labelEl = allEls.find(el => el.textContent?.trim() === label && el.children.length === 0);
    if (!labelEl) return { ok: false, reason: 'Label not found' };
    let container = labelEl.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      const input = container.querySelector('input[placeholder="Set date"], input.chakra-input');
      if (input) {
        input.setAttribute('data-pw-target', 'date-field');
        return { ok: true, tag: 'INPUT' };
      }
      container = container.parentElement;
    }
    return { ok: false, reason: 'No date input near label' };
  }, fieldLabel);
  
  await dbLog('date-picker', 'info', `Find: ${JSON.stringify(findResult)}`);
  
  if (findResult.ok) {
    await page.locator('[data-pw-target="date-field"]').click({ timeout: 5000 });
    await page.evaluate(() => document.querySelector('[data-pw-target]')?.removeAttribute('data-pw-target'));
    await dbLog('date-picker', 'success', 'Clicked date input');
  } else {
    throw new Error(`Cannot open date picker for "${fieldLabel}": ${findResult.reason}`);
  }
  
  await page.waitForTimeout(1000);
  
  // Verify calendar opened — react-datepicker should now be visible
  const calendarVisible = await page.locator('.react-datepicker').count();
  await dbLog('date-picker', 'info', `react-datepicker visible: ${calendarVisible > 0}`);
  if (calendarVisible === 0) {
    await dbShot(page, 'no-calendar', 'Calendar did not open');
    throw new Error('react-datepicker not visible after clicking date input');
  }
  await dbShot(page, 'date-picker-opened', `Calendar opened for ${fieldLabel}`);
  
  // STEP 2: Navigate to target month using .react-datepicker__navigation--next
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const targetMonthName = `${months[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
  
  for (let attempt = 0; attempt < 24; attempt++) {
    const currentMonth = await page.locator('.react-datepicker__current-month').first().textContent();
    await dbLog('date-nav', 'info', `Month ${attempt}: "${currentMonth?.trim()}" → target "${targetMonthName}"`);
    
    if (currentMonth?.trim() === targetMonthName) {
      await dbLog('date-nav', 'success', `Reached target month: ${targetMonthName}`);
      break;
    }
    
    // Click the NEXT button
    await page.locator('.react-datepicker__navigation--next').click({ timeout: 3000 });
    await page.waitForTimeout(300);
    
    if (attempt === 23) {
      await dbShot(page, 'date-nav-fail', `Could not reach ${targetMonthName}`);
      throw new Error(`Could not navigate to ${targetMonthName} after 24 attempts`);
    }
  }

  // STEP 3: Click the target day
  // react-datepicker day class: .react-datepicker__day--0XX (zero-padded)
  const dayPadded = String(targetDay).padStart(3, '0'); // day 9 → "009"
  const daySelector = `.react-datepicker__day--${dayPadded}:not(.react-datepicker__day--outside-month)`;
  
  await dbLog('date-day', 'info', `Clicking day ${targetDay} with selector: ${daySelector}`);
  await page.locator(daySelector).first().click({ timeout: 5000 });
  await dbLog('date-day', 'success', `Clicked day ${targetDay}`);
  
  await dbLog('date-picker', 'success', `Selected ${formatDate(targetDate)} for ${fieldLabel}`);
  console.log(`  ✅ Date selected: ${formatDate(targetDate)}`);
  await page.waitForTimeout(500);
}

// ── MULTI-SELECT "SELECT ALL" HELPER ──────────────────────────────────────────
// NOTE: Chakra UI modals render in portals. Do NOT scope selectors inside
// a modal locator — use page-level selectors instead.

async function clickSelectAll(page, dropdownLabel) {
  console.log(`  🔽 Opening "${dropdownLabel}" dropdown and selecting all...`);
  await dbLog('select-all', 'info', `Opening ${dropdownLabel} dropdown`);
  
  // v1.7 FIX: The dropdown is a CUSTOM CHECKBOX DROPDOWN, not React Select.
  // Screenshot analysis shows: clicking the control opens a list of checkboxes
  // including "Select all", "3PL CA", "3PL UK", etc.
  
  let clicked = false;
  
  // STEP 1: OPEN THE DROPDOWN
  // Strategy A: Find the label, then find the combobox/control nearby
  try {
    const labelEl = page.getByText(dropdownLabel, { exact: false }).first();
    await labelEl.waitFor({ timeout: 5000 });
    
    // Try clicking the combobox input near this label
    for (const levels of ['..', '../..', '../../..']) {
      try {
        const wrapper = labelEl.locator(levels);
        
        // Try the control div first (the visible select box)
        const control = wrapper.locator('[class*="control"], [class*="Control"]').first();
        const controlCount = await control.count();
        if (controlCount > 0) {
          await control.click({ timeout: 2000 });
          clicked = true;
          console.log(`  ✅ Clicked control div via label parent (${levels})`);
          break;
        }
        
        // Fallback: try combobox input
        const combobox = wrapper.locator('input[role="combobox"]').first();
        const cbCount = await combobox.count();
        if (cbCount > 0) {
          await combobox.click({ timeout: 2000 });
          clicked = true;
          console.log(`  ✅ Clicked combobox input via label parent (${levels})`);
          break;
        }
      } catch {}
    }
  } catch (e) {
    console.log(`  ⚠️ Label approach failed: ${e.message.substring(0, 100)}`);
  }
  
  // Strategy B: Find all controls/comboboxes on page, pick by index
  if (!clicked) {
    try {
      // Try control divs first
      const allControls = page.locator('[class*="control"]:has(input[role="combobox"])');
      let count = await allControls.count();
      if (count > 0) {
        const idx = dropdownLabel.toLowerCase().includes('destination') ? 0 : 
                    (count === 1 ? 0 : 1);
        await allControls.nth(idx).click({ timeout: 3000 });
        clicked = true;
        console.log(`  ✅ Clicked control by index ${idx} (of ${count})`);
      }
    } catch {}
  }
  
  if (!clicked) {
    try {
      const allComboboxes = page.locator('input[role="combobox"]');
      const count = await allComboboxes.count();
      if (count >= 1) {
        const idx = count === 1 ? 0 : 
                    (dropdownLabel.toLowerCase().includes('destination') ? 0 : 1);
        await allComboboxes.nth(idx).click({ timeout: 3000 });
        clicked = true;
        console.log(`  ✅ Clicked combobox by index ${idx} (of ${count})`);
      }
    } catch {}
  }
  
  if (!clicked) {
    await dbShot(page, `select-fail-${dropdownLabel}`, `Could not open dropdown: ${dropdownLabel}`);
    throw new Error(`Failed to open dropdown: ${dropdownLabel}`);
  }
  
  await page.waitForTimeout(1500);
  await dbShot(page, `select-opened-${dropdownLabel.replace(/\s+/g, '-').toLowerCase()}`, `Dropdown opened: ${dropdownLabel}`);
  
  // STEP 2: CLICK "SELECT ALL" CHECKBOX
  // v1.7 FIX: Use page.evaluate() to find and click "Select all" via vanilla JS.
  // Playwright selectors failed in v1.5 despite the element being visible.
  // Also: scope fallback to dropdown container only (not all 76 checkboxes on page).
  
  let selected = false;
  
  // Approach A: Use vanilla JS in browser — most reliable
  try {
    const result = await page.evaluate(() => {
      // Find all elements containing "Select all" text
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.textContent.trim().toLowerCase() === 'select all') {
          // Click the closest clickable parent (label, div, span, etc.)
          const clickTarget = node.parentElement;
          if (clickTarget) {
            clickTarget.click();
            return { clicked: true, tag: clickTarget.tagName, text: clickTarget.textContent.trim() };
          }
        }
      }
      return { clicked: false };
    });
    if (result.clicked) {
      selected = true;
      console.log(`  ✅ Clicked "Select all" via evaluate() — <${result.tag}>`);
    } else {
      console.log('  ⚠️ evaluate() found no "Select all" text node');
    }
  } catch (e) {
    console.log(`  ⚠️ evaluate() failed: ${e.message.substring(0, 100)}`);
  }
  
  // Approach B: Force-click with Playwright (bypasses actionability checks)
  if (!selected) {
    try {
      await page.click('text="Select all"', { force: true, timeout: 3000 });
      selected = true;
      console.log('  ✅ Clicked "Select all" via force-click');
    } catch (e) {
      console.log(`  ⚠️ force-click failed: ${e.message.substring(0, 100)}`);
    }
  }
  
  // Approach C: Click by role with force
  if (!selected) {
    try {
      const cb = page.getByRole('checkbox', { name: /select all/i }).first();
      await cb.click({ force: true, timeout: 3000 });
      selected = true;
      console.log('  ✅ Clicked "Select all" via getByRole(checkbox) + force');
    } catch (e) {
      console.log(`  ⚠️ getByRole(checkbox)+force failed: ${e.message.substring(0, 100)}`);
    }
  }
  
  // Approach D: SCOPED fallback — find dropdown panel, click checkboxes inside it only
  if (!selected) {
    await dbShot(page, `select-no-selectall-${dropdownLabel.replace(/\s+/g, '-').toLowerCase()}`, 'Trying scoped checkbox fallback');
    
    // Use evaluate to click all checkboxes INSIDE the open dropdown only
    try {
      const result = await page.evaluate(() => {
        // The dropdown panel is likely a div with a list of checkbox items
        // Look for a container that has "Select all" or multiple checkbox-like items
        // and is positioned as a dropdown (not the main page content)
        
        // Strategy: find elements with checkbox-like role/class near "Select all" text
        const allCheckboxes = document.querySelectorAll('[role="checkbox"], input[type="checkbox"], [class*="checkbox"], [data-checked]');
        let clicked = 0;
        const clickedLabels = [];
        
        // Find which checkboxes are inside a dropdown/popover/menu container
        for (const cb of allCheckboxes) {
          const container = cb.closest('[class*="menu"], [class*="popover"], [class*="dropdown"], [class*="list"], [role="listbox"], [role="menu"]');
          if (container) {
            cb.click();
            clicked++;
            clickedLabels.push(cb.textContent?.trim().substring(0, 30) || cb.getAttribute('aria-label') || 'unknown');
          }
        }
        
        // If no scoped checkboxes found, try a different approach:
        // Find the container that has "Select all" text and click all checkboxes in it
        if (clicked === 0) {
          const selectAllEl = Array.from(document.querySelectorAll('*')).find(
            el => el.textContent?.trim().toLowerCase() === 'select all' && el.children.length === 0
          );
          if (selectAllEl) {
            // Find the dropdown container (parent with multiple similar siblings)
            let container = selectAllEl.parentElement;
            for (let i = 0; i < 5; i++) {
              if (!container) break;
              const checkboxesInside = container.querySelectorAll('[role="checkbox"], input[type="checkbox"], [class*="checkbox"], label, [data-checked]');
              if (checkboxesInside.length >= 3) {
                // Found the dropdown container
                checkboxesInside.forEach(c => { c.click(); clicked++; });
                break;
              }
              container = container.parentElement;
            }
          }
        }
        
        return { clicked, labels: clickedLabels.slice(0, 10) };
      });
      
      if (result.clicked > 0 && result.clicked < 20) {
        selected = true;
        console.log(`  ✅ Scoped fallback: clicked ${result.clicked} checkboxes: ${result.labels.join(', ')}`);
      } else {
        console.log(`  ⚠️ Scoped fallback: ${result.clicked} checkboxes (${result.clicked >= 20 ? 'too many — skipping' : 'none found'})`);
      }
    } catch (e) {
      console.log(`  ⚠️ Scoped fallback failed: ${e.message.substring(0, 100)}`);
    }
  }
  
  // Approach E: Last resort — click items by their visible text (scoped)
  if (!selected) {
    const options = page.locator('[class*="option"], [class*="Option"], [role="option"], li[role="menuitem"]');
    const optCount = await options.count();
    console.log(`  ℹ️ Found ${optCount} option-like elements`);
    for (let i = 0; i < Math.min(optCount, 15); i++) {
      try {
        await options.nth(i).click({ timeout: 2000 });
        await page.waitForTimeout(200);
        selected = true;
      } catch { break; }
    }
  }
  
  // STEP 3: VERIFY CHIPS/SELECTIONS APPEARED (still inside clickSelectAll)
  // After selecting, chips (multi-value badges) should appear in the control
  const chips = page.locator('[class*="multiValue"], [class*="multi-value"], [class*="chip"], [class*="tag"], [class*="badge"]');
  const chipCount = await chips.count();
  console.log(`  ℹ️ ${dropdownLabel}: chips visible = ${chipCount}`);
  await dbLog('select-all', selected ? 'success' : 'warning', `${dropdownLabel}: ${selected ? 'selected' : 'FAILED'}, ${chipCount} chips visible`);
  
  if (chipCount === 0) {
    await dbShot(page, `select-verify-fail-${dropdownLabel.replace(/\s+/g, '-').toLowerCase()}`, `WARNING: No chips visible after selecting ${dropdownLabel}`);
  }
  
  // STEP 4: CLOSE DROPDOWN
  // Click outside the dropdown to close it
  try {
    const modalTitle = page.getByText('Select the destination', { exact: false }).first();
    await modalTitle.click({ timeout: 2000 });
  } catch {
    try {
      await page.locator('body').click({ position: { x: 10, y: 10 } });
    } catch {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  await page.waitForTimeout(500);
  
  console.log(`  ✅ Done with "${dropdownLabel}"`);
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
  // URL pattern: /replenishment-simulator/UUID or /replenishment/(purchase|transfer)/UUID
  const match = url.match(/\/replenishment(?:-simulator|\/(?:purchase|transfer))\/([a-f0-9-]+)/);
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
  
  // Navigate to inventory forecast page (domcontentloaded — networkidle crashes on heavy SPAs)
  await page.goto(FLIEBER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000); // extra settle time for SPA hydration
  await dbLog('po-nav', 'info', `Page URL after nav: ${page.url()}`);
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
  
  await page.waitForURL('**/replenishment-simulator/**', { timeout: 120000 });
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
  
  // Step 9: Click Save button (big green button top-right)
  console.log('  💾 Clicking Save...');
  try {
    const saveBtn = page.locator('button').filter({ hasText: /^Save$/ }).first();
    await saveBtn.click({ timeout: 10000 });
    await page.waitForTimeout(2000);
    await dbLog('po-save', 'success', 'Clicked Save button');
    await dbShot(page, 'po-9-saved', 'After clicking Save');
  } catch (e) {
    await dbLog('po-save', 'warning', `Save button click failed: ${e.message}`);
  }
  
  // Step 10: Fetch results via GraphQL API
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
  await page.goto(FLIEBER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
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
  
  await page.waitForURL('**/replenishment-simulator/**', { timeout: 120000 });
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
  
  // Step 10: Click Save button (big green button top-right)
  console.log('  💾 Clicking Save...');
  try {
    const saveBtn = page.locator('button').filter({ hasText: /^Save$/ }).first();
    await saveBtn.click({ timeout: 10000 });
    await page.waitForTimeout(2000);
    await dbLog('to-save', 'success', 'Clicked Save button');
    await dbShot(page, 'to-10-saved', 'After clicking Save');
  } catch (e) {
    await dbLog('to-save', 'warning', `Save button click failed: ${e.message}`);
  }
  
  // Step 11: Fetch results via GraphQL API
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
    await dbLog('version', 'info', 'flieber-replenishment-simulator.js v3.0 — simplified pickDate, env RUN_MODE');
    console.log('📌 Script version: v3.0');
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
