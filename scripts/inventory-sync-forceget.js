/**
 * inventory-sync-forceget.js v2.4
 *
 * Key fixes over v1.0:
 * - Angular-specific login (dispatch input/change/blur events after typing)
 * - Cookie persistence: saves cookies after successful login, reuses next time
 * - Screenshot at every step for debugging
 * - Better error messages
 *
 * v2.3: Two Forceget locations — Toronto (CA) + LA Perris (US); key = (source, ean, warehouse)
 * v2.4: Live Inventory defaults to ~10 rows/page — expand page size + paginate + scroll
 *       so LA Perris rows beyond the first page are not dropped. Completeness guard via
 *       Total Records / max row #. Keep qty=0 portal rows. Prefer Sku (not Shopify Sku).
 *
 * Flow:
 * 1. Try cookie-based login first (skip form entirely)
 * 2. If no cookies / cookies expired → Angular-aware form login
 * 3. Save cookies on success for next run
 * 4. Navigate to Inventory at Forceget WH → Live Inventory
 * 5. Expand page size / paginate / scroll → scrape all rows → write Inventory_Levels
 *
 * Channels: 3PL US, 3PL CA
 * credentials_key: forceget
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SUPABASE_URL,
  resolveProductFromText,
  loadPortalNameMappings,
  classifyForcegetWarehouse,
  buildInventoryItem,
} = require('./inventory-helpers');
const { writeInventoryToSupabase } = require('./inventory-supabase');

const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const SHOT_DIR = process.env.FORCEGET_SHOT_DIR || path.join(os.tmpdir(), 'forceget-shots');

function shotPath(name) {
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  } catch (_) {
    /* ignore */
  }
  return path.join(SHOT_DIR, name);
}

function extractEan(cells) {
  for (const cell of cells) {
    const match = String(cell || '').match(/\b(541998\d{7})\b/);
    if (match) return match[1];
  }
  return null;
}

/** One row per EAN + warehouse (Toronto vs LA Perris stay separate). */
function aggregateInventoryRows(rawItems) {
  const byKey = new Map();
  for (const item of rawItems) {
    if (!item.ean) continue;
    const warehouse = item.warehouse || '';
    const key = `${item.ean}|${warehouse}`;
    const existing = byKey.get(key);
    if (existing) {
      // Prefer the latest scrape value (do not double-count pagination duplicates)
      existing.on_hand = item.on_hand;
    } else {
      byKey.set(key, { ...item });
    }
  }
  return Array.from(byKey.values());
}

/** Prefer exact "Sku" over "Shopify Sku". */
function findHeaderIndex(headersLower, matcher) {
  if (typeof matcher === 'string') {
    const exact = headersLower.findIndex((h) => h === matcher);
    if (exact >= 0) return exact;
    return headersLower.findIndex((h) => h.includes(matcher));
  }
  return headersLower.findIndex(matcher);
}

function rowFingerprint(cells) {
  return cells
    .map((c) => String(c || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('|');
}

/** DOM extract for the currently rendered Live Inventory page. */
async function readInventoryTableDom(page) {
  return page.evaluate(() => {
    const rows = [];

    const pushFromCells = (cellEls) => {
      if (!cellEls || cellEls.length < 3) return;
      const cells = Array.from(cellEls).map((c) => (c.innerText || c.textContent || '').trim());
      const hasData = cells.some((c) => c && c !== '0');
      const hasWarehouse = cells.some((c) => /forceget|toronto|perris|warehouse/i.test(c));
      const hasEanOrName = cells.some((c) => /541998\d{7}/.test(c) || /^(mat|tray|puzzl)/i.test(c));
      if (!hasData && !hasWarehouse && !hasEanOrName) return;
      if (!hasWarehouse && !hasEanOrName) return;
      rows.push({ cells, cellCount: cells.length });
    };

    for (const table of document.querySelectorAll('table')) {
      for (const tr of table.querySelectorAll('tbody tr')) {
        pushFromCells(tr.querySelectorAll('td'));
      }
    }

    if (rows.length === 0) {
      for (const row of document.querySelectorAll('mat-row, [role="row"]')) {
        pushFromCells(row.querySelectorAll('mat-cell, [role="cell"], [role="gridcell"]'));
      }
    }

    if (rows.length === 0) {
      for (const row of document.querySelectorAll('.ag-row, [class*="ag-row"]')) {
        pushFromCells(row.querySelectorAll('.ag-cell, [class*="ag-cell"]'));
      }
    }

    const headers = [];
    for (const th of document.querySelectorAll('th, mat-header-cell, [role="columnheader"], .ag-header-cell')) {
      headers.push((th.innerText || th.textContent || '').trim());
    }

    const bodyText = document.body?.innerText || '';
    const totalMatch =
      bodyText.match(/Total\s*Records?\s*[:=]?\s*(\d+)/i) ||
      bodyText.match(/(\d+)\s*Total\s*Records?/i) ||
      bodyText.match(/Showing\s+\d+\s*[-–]\s*\d+\s+of\s+(\d+)/i);

    let maxRowNum = 0;
    for (const row of rows) {
      const n = parseInt(row.cells[1], 10);
      if (!isNaN(n) && n > maxRowNum) maxRowNum = n;
    }

    const pageSizeText =
      document.querySelector('.ant-pagination-options-size-changer')?.textContent?.trim() ||
      document.querySelector('.ant-select-selection-item')?.textContent?.trim() ||
      null;

    return {
      rows,
      headers,
      tableCount: document.querySelectorAll('table').length,
      expectedTotalRecords: totalMatch ? parseInt(totalMatch[1], 10) : null,
      maxRowNum,
      pageSizeText,
      paginationPresent: !!document.querySelector('.ant-pagination, [class*="pagination"]'),
    };
  });
}

/** Scroll ant-table body so virtualized / overflow rows enter the DOM. */
async function scrollInventoryTable(page) {
  await page.evaluate(async () => {
    const bodies = [
      ...document.querySelectorAll('.ant-table-body'),
      ...document.querySelectorAll('.ant-table-content'),
      ...document.querySelectorAll('[class*="table-body"]'),
    ];
    for (const el of bodies) {
      let guard = 0;
      let last = -1;
      while (guard < 40 && el.scrollTop !== last) {
        last = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        await new Promise((r) => setTimeout(r, 150));
        guard += 1;
      }
      el.scrollTop = 0;
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(500);
}

/**
 * Ant Design default page size is often 10 — that is why LA Perris rows 11+ were missing.
 * Expand to the largest available option (100 / 200 / 50 / ...).
 */
async function expandInventoryPageSize(page, log) {
  const changers = [
    '.ant-pagination-options-size-changer',
    '.ant-pagination .ant-select',
    '[class*="pagination"] .ant-select',
  ];

  let opened = false;
  for (const sel of changers) {
    const el = await page.$(sel);
    if (!el) continue;
    try {
      await el.click({ timeout: 2000 });
      opened = true;
      await log('page_size', `Opened size changer: ${sel}`);
      break;
    } catch (_) {
      /* next */
    }
  }

  if (!opened) {
    // Some Forceget builds put "10 / page" in a generic ant-select near the table footer
    const candidates = await page.$$('.ant-select-selector');
    for (const el of candidates) {
      const text = ((await el.textContent().catch(() => '')) || '').toLowerCase();
      if (text.includes('/ page') || text.includes('page') || /\b10\b/.test(text)) {
        try {
          await el.click({ timeout: 1500 });
          opened = true;
          await log('page_size', `Opened size changer via ant-select text: ${text.trim()}`);
          break;
        } catch (_) {
          /* next */
        }
      }
    }
  }

  if (!opened) {
    await log('page_size', 'No page-size changer found (may already show all rows)');
    return false;
  }

  await page.waitForTimeout(400);

  const optionTexts = ['200 / page', '100 / page', '50 / page', '200', '100', '50'];
  for (const text of optionTexts) {
    try {
      const opt = page.locator('.ant-select-item-option, .ant-select-dropdown [title], div[title]').filter({ hasText: text }).first();
      if ((await opt.count()) === 0) continue;
      await opt.click({ timeout: 2000 });
      await page.waitForTimeout(2500);
      await page.waitForLoadState('networkidle').catch(() => {});
      await log('page_size', `Selected page size option: ${text}`);
      return true;
    } catch (_) {
      /* next */
    }
  }

  // Keyboard fallback: arrow to largest then Enter
  try {
    await page.keyboard.press('End');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await log('page_size', 'Selected largest page size via keyboard End+Enter');
    return true;
  } catch (e) {
    await log('page_size_warn', `Could not select larger page size: ${e.message}`);
    return false;
  }
}

async function clickNextInventoryPage(page) {
  const nextSelectors = [
    'li.ant-pagination-next:not(.ant-pagination-disabled) button',
    'li.ant-pagination-next:not(.ant-pagination-disabled)',
    'button.ant-pagination-item-link[aria-label="Next page"]',
    '[aria-label="Next Page"]:not([disabled])',
    '[aria-label="next page"]:not([disabled])',
    'button:has-text("Next"):not([disabled])',
  ];
  for (const sel of nextSelectors) {
    const btn = await page.$(sel);
    if (!btn) continue;
    const disabled =
      (await btn.getAttribute('disabled').catch(() => null)) != null ||
      ((await btn.getAttribute('aria-disabled').catch(() => '')) || '') === 'true' ||
      ((await btn.getAttribute('class').catch(() => '')) || '').includes('disabled');
    if (disabled) continue;
    try {
      await btn.click({ timeout: 2000 });
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle').catch(() => {});
      return true;
    } catch (_) {
      /* next */
    }
  }
  return false;
}

/**
 * Collect every Live Inventory row across page size, scroll, and pagination.
 * Dedupes by cell fingerprint so virtualization / re-renders do not inflate counts.
 */
async function scrapeAllInventoryRows(page, log) {
  await expandInventoryPageSize(page, log);
  await scrollInventoryTable(page);

  const allRows = [];
  const seen = new Set();
  let headers = [];
  let expectedTotalRecords = null;
  let pagesScraped = 0;
  let maxRowNum = 0;

  for (let pageNum = 1; pageNum <= 25; pageNum++) {
    await scrollInventoryTable(page);
    const snap = await readInventoryTableDom(page);
    if (snap.headers?.length) headers = snap.headers;
    if (snap.expectedTotalRecords != null) expectedTotalRecords = snap.expectedTotalRecords;
    if (snap.maxRowNum > maxRowNum) maxRowNum = snap.maxRowNum;

    let added = 0;
    for (const row of snap.rows || []) {
      const fp = rowFingerprint(row.cells);
      if (!fp || seen.has(fp)) continue;
      seen.add(fp);
      allRows.push(row);
      added += 1;
    }
    pagesScraped = pageNum;

    await log(
      'table_page',
      JSON.stringify({
        pageNum,
        pageRows: snap.rows?.length || 0,
        added,
        totalUnique: allRows.length,
        expectedTotalRecords,
        maxRowNum: snap.maxRowNum,
        pageSizeText: snap.pageSizeText,
        paginationPresent: snap.paginationPresent,
      })
    );

    const completeByTotal =
      expectedTotalRecords != null && allRows.length >= expectedTotalRecords;
    const completeByMaxRow =
      expectedTotalRecords != null && maxRowNum >= expectedTotalRecords;
    if (completeByTotal || completeByMaxRow) break;

    const moved = await clickNextInventoryPage(page);
    if (!moved) break;
  }

  return {
    rows: allRows,
    headers,
    tableCount: 1,
    expectedTotalRecords,
    maxRowNum,
    pagesScraped,
  };
}

// ============ CREDENTIALS ============

async function loadForcegetCredentials(log) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.forceget&select=username,password`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (data?.[0]?.username && data[0].password) {
      await log('credentials_loaded', `Using Supabase credentials for ${data[0].username}`);
      return { username: data[0].username, password: data[0].password };
    }
  } catch (e) {
    await log('credentials_error', e.message);
  }
  return null;
}

// ============ COOKIE PERSISTENCE ============

async function loadCookies(log) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.forceget_cookies&select=password`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (data && data.length > 0 && data[0].password) {
      const parsed = JSON.parse(data[0].password);
      if (parsed.cookies && parsed.saved_at) {
        const ageMs = Date.now() - new Date(parsed.saved_at).getTime();
        const ageHours = ageMs / 3600000;
        if (ageHours < 24) {
          await log('cookies_loaded', `Found saved cookies (${Math.round(ageHours)}h old)`);
          return parsed.cookies;
        }
        await log('cookies_expired', `Cookies too old (${Math.round(ageHours)}h), need fresh login`);
      }
    }
  } catch (e) {
    await log('cookies_load_error', e.message);
  }
  return null;
}

async function saveCookies(page, log) {
  try {
    const cookies = await page.context().cookies();
    const payload = JSON.stringify({ cookies, saved_at: new Date().toISOString() });
    
    // Upsert to Browser_Credentials
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.forceget_cookies&select=key`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const exists = await checkRes.json();
    
    if (exists && exists.length > 0) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.forceget_cookies`,
        {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ password: payload })
        }
      );
    } else {
      await fetch(
        `${SUPABASE_URL}/rest/v1/Browser_Credentials`,
        {
          method: 'POST',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ key: 'forceget_cookies', service_name: 'Forceget (session cookies)', username: 'auto-saved', password: payload, base_url: 'https://app.forceget.com' })
        }
      );
    }
    await log('cookies_saved', 'Session cookies saved for next run');
  } catch (e) {
    await log('cookies_save_error', e.message);
  }
}

// ============ ANGULAR LOGIN ============

async function angularLogin(page, credentials, log) {
  await log('login_start', 'Angular login flow starting...');
  
  // Screenshot before login
  await page.screenshot({ path: shotPath('forceget-01-login-page.png'), fullPage: true });
  
  // Angular-specific: find inputs with multiple selector strategies
  const emailSelectors = [
    'input[type="email"]',
    'input[formcontrolname="email"]',
    'input[formcontrolname="username"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="user" i]',
    'input[placeholder*="mail" i]',
    'input[type="text"]', // fallback — first text input is usually email
  ];
  
  let emailInput = null;
  for (const sel of emailSelectors) {
    emailInput = await page.$(sel);
    if (emailInput) {
      await log('email_found', `Email field: ${sel}`);
      break;
    }
  }
  
  if (!emailInput) {
    // Last resort: get ALL inputs and pick the first visible one
    const allInputs = await page.$$('input:visible');
    if (allInputs.length > 0) emailInput = allInputs[0];
    await log('email_fallback', `Using first visible input (${allInputs.length} found)`);
  }
  
  if (!emailInput) {
    await log('login_failed', 'No email input found');
    return false;
  }
  
  // === TYPE EMAIL with Angular event dispatching ===
  await emailInput.click();
  await page.waitForTimeout(200);
  
  // Triple-click to select all, then delete
  await emailInput.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);
  
  // Type character by character (triggers Angular ngModel / Reactive Forms)
  await emailInput.type(credentials.username, { delay: 30 });
  
  // Dispatch Angular-critical events
  await emailInput.evaluate(el => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  
  // === TYPE PASSWORD ===
  const passInput = await page.$('input[type="password"]');
  if (!passInput) {
    await log('login_failed', 'No password input found');
    return false;
  }
  
  await passInput.click();
  await page.waitForTimeout(200);
  await passInput.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);
  await passInput.type(credentials.password, { delay: 30 });
  
  // Dispatch Angular events
  await passInput.evaluate(el => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  
  // Screenshot after filling
  await page.screenshot({ path: shotPath('forceget-02-filled.png'), fullPage: true });
  
  // === CLICK LOGIN BUTTON ===
  const btnSelectors = [
    'button[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Login")',
    'button:has-text("Log in")',
    'button:has-text("Sign In")',
    'button:has-text("LOG IN")',
    'button.btn-primary',
    'button[mat-raised-button]', // Angular Material
    'button[mat-flat-button]',
    'input[type="submit"]',
  ];
  
  let loginBtn = null;
  for (const sel of btnSelectors) {
    loginBtn = await page.$(sel);
    if (loginBtn) {
      const btnText = await loginBtn.textContent().catch(() => 'unknown');
      await log('btn_found', `Login button: ${sel} (text: ${btnText.trim()})`);
      break;
    }
  }
  
  if (!loginBtn) {
    // Fallback: find any button
    const buttons = await page.$$('button:visible');
    for (const btn of buttons) {
      const text = await btn.textContent().catch(() => '');
      if (text && (text.toLowerCase().includes('sign') || text.toLowerCase().includes('log'))) {
        loginBtn = btn;
        await log('btn_fallback', `Found button by text: ${text.trim()}`);
        break;
      }
    }
  }
  
  if (!loginBtn) {
    await log('login_failed', 'No login button found');
    return false;
  }
  
  // Click and wait for navigation
  await Promise.all([
    loginBtn.click(),
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
  ]);
  
  await page.waitForTimeout(3000);
  
  // Screenshot after click
  await page.screenshot({ path: shotPath('forceget-03-after-login.png'), fullPage: true });
  
  const postUrl = page.url();
  await log('login_result', `Post-login URL: ${postUrl}`);
  
  // Check if still on login page
  const isStillLogin = postUrl.includes('/login') || postUrl.includes('/auth') || postUrl.includes('/signin');
  
  if (isStillLogin) {
    // RETRY: Maybe Angular needs Enter key instead of button click
    await log('login_retry', 'Still on login page — trying Enter key...');
    await passInput?.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000);
    
    await page.screenshot({ path: shotPath('forceget-04-retry.png'), fullPage: true });
    
    const retryUrl = page.url();
    await log('retry_result', `After Enter: ${retryUrl}`);
    
    if (retryUrl.includes('/login') || retryUrl.includes('/auth') || retryUrl.includes('/signin')) {
      // Check for error messages
      const errorText = await page.evaluate(() => {
        const errors = document.querySelectorAll('.error, .alert, .danger, [class*="error"], [class*="alert"], mat-error, .invalid-feedback');
        return Array.from(errors).map(e => e.textContent.trim()).filter(Boolean);
      });
      await log('login_failed', `Login failed. Errors on page: ${JSON.stringify(errorText)}`);
      return false;
    }
  }
  
  await log('login_success', 'Login successful!');
  return true;
}

// ============ MAIN ============

module.exports = async function run({ page, credentials, log }) {
  const results = { products: [], errors: [], channel: 'forceget' };

  if (!credentials?.username || !credentials?.password) {
    credentials = await loadForcegetCredentials(log);
  }
  if (!credentials?.username || !credentials?.password) {
    results.success = false;
    results.error = 'No Forceget credentials — set Browser_Credentials key=forceget';
    return results;
  }
  
  try {
    // Step 1: Try cookie login first
    const savedCookies = await loadCookies(log);
    
    if (savedCookies) {
      await log('cookie_login', 'Trying saved cookies...');
      await page.context().addCookies(savedCookies);
      await page.goto('https://app.forceget.com/', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      const url = page.url();
      if (url.includes('/login') || url.includes('/auth')) {
        await log('cookie_expired', 'Cookies expired, falling back to login form');
      } else {
        await log('cookie_success', `Cookie login worked! URL: ${url}`);
      }
    }
    
    // Step 2: Check if we need to login
    const currentUrl = page.url();
    const needsLogin = !currentUrl || currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl.includes('/signin') || currentUrl === 'about:blank';
    
    if (needsLogin) {
      if (!savedCookies) {
        await page.goto('https://app.forceget.com/', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);
      }
      
      const loginOk = await angularLogin(page, credentials, log);
      if (!loginOk) {
        results.success = false;
        results.error = `Login failed - check screenshots in ${SHOT_DIR}`;
        return results;
      }
      
      // Save cookies for next time
      await saveCookies(page, log);
    }
    
    // Step 3: Navigate to Inventory at Forceget WH
    await log('nav_inventory', 'Looking for Inventory in sidebar...');
    await page.screenshot({ path: shotPath('forceget-05-dashboard.png'), fullPage: true });
    
    // Dump all visible text for debugging
    const pageText = await page.evaluate(() => {
      const els = document.querySelectorAll('a, button, span, li, div.menu-item, mat-list-item, [class*="nav"], [class*="menu"], [class*="sidebar"]');
      return Array.from(els).slice(0, 50).map(e => ({
        tag: e.tagName,
        text: e.textContent.trim().substring(0, 80),
        href: e.href || '',
        classes: e.className?.toString().substring(0, 60) || ''
      })).filter(e => e.text.length > 0);
    });
    await log('page_elements', JSON.stringify(pageText.slice(0, 30)));
    
    // Try sidebar navigation
    const inventorySelectors = [
      'a:has-text("Inventory at Forceget")',
      'text="Inventory at Forceget WH"',
      'span:has-text("Inventory at Forceget")',
      'a:has-text("Inventory")',
      'mat-list-item:has-text("Inventory")',
      '[class*="nav"] >> text="Inventory"',
      '[class*="sidebar"] >> text="Inventory"',
      '[class*="menu"] >> text="Inventory"',
    ];
    
    let clicked = false;
    for (const sel of inventorySelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          clicked = true;
          await log('sidebar_click', `Clicked: ${sel}`);
          break;
        }
      } catch (e) { /* next */ }
    }
    
    if (!clicked) {
      // Scan all links
      const allLinks = await page.$$('a, button, span, li');
      for (const link of allLinks) {
        const text = await link.textContent().catch(() => '');
        if (text && text.toLowerCase().includes('inventory')) {
          await link.click();
          clicked = true;
          await log('sidebar_scan', `Clicked: ${text.trim()}`);
          break;
        }
      }
    }
    
    if (!clicked) {
      await log('sidebar_failed', 'Could not find Inventory link in sidebar — trying direct URL');
      await page.screenshot({ path: shotPath('forceget-06-no-sidebar.png'), fullPage: true });
      await page.goto('https://app.forceget.com/inventory-management/inventory', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await page.waitForTimeout(4000);
    }
    
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: shotPath('forceget-06-inventory-page.png'), fullPage: true });
    
    // Step 4: Click "Live Inventory" (or land via direct URL)
    await log('nav_live', 'Looking for Live Inventory...');
    
    const liveSelectors = [
      'text="Live Inventory"',
      'a:has-text("Live Inventory")',
      'button:has-text("Live Inventory")',
      'span:has-text("Live Inventory")',
      'mat-tab:has-text("Live")',
      '[role="tab"]:has-text("Live")',
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
      } catch (e) { /* next */ }
    }

    if (!clicked && !page.url().includes('/inventory-management/inventory')) {
      await page.goto('https://app.forceget.com/inventory-management/inventory', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await log('live_direct', 'Opened Live Inventory via direct URL');
    }
    
    await page.waitForTimeout(5000);
    await page.waitForLoadState('networkidle').catch(() => {});

    // Wait until at least one data row appears
    for (let attempt = 1; attempt <= 15; attempt++) {
      const n = await page.evaluate(
        () => document.querySelectorAll('table tbody tr, mat-row, .ag-row').length
      );
      if (n > 0) {
        await log('table_ready', `Table rows visible after attempt ${attempt}: ${n}`);
        break;
      }
      await page.waitForTimeout(1500);
    }

    await page.screenshot({ path: shotPath('forceget-07-live-inventory.png'), fullPage: true });
    
    // Step 5: Scrape ALL inventory rows (page size + scroll + pagination)
    await log('scrape', 'Scraping inventory table (expand page size + paginate)...');
    const tableData = await scrapeAllInventoryRows(page, log);
    
    await log('table_data', JSON.stringify({
      rowCount: tableData.rows.length,
      headers: tableData.headers,
      tableCount: tableData.tableCount,
      expectedTotalRecords: tableData.expectedTotalRecords,
      maxRowNum: tableData.maxRowNum,
      pagesScraped: tableData.pagesScraped,
      sampleRows: tableData.rows.slice(0, 3),
    }));

    if (
      tableData.expectedTotalRecords != null &&
      tableData.rows.length < tableData.expectedTotalRecords
    ) {
      await log(
        'scrape_incomplete',
        `Scraped ${tableData.rows.length} rows but Total Records=${tableData.expectedTotalRecords} (maxRow#=${tableData.maxRowNum})`
      );
      results.errors.push({
        msg: `Incomplete scrape: got ${tableData.rows.length}/${tableData.expectedTotalRecords} portal rows`,
      });
    }
    
    // Parse inventory — resolve every row to EAN via shared catalog + Supabase mappings
    const parsedRows = [];
    const portalMappings = await loadPortalNameMappings();

    const headersLower = (tableData.headers || []).map((h) => (h || '').toLowerCase());
    // Prefer exact "sku" so "Shopify Sku" does not win; same for stock-on-hand unit
    const skuHeaderIdx = findHeaderIndex(headersLower, (h) => h === 'sku');
    const nameHeaderIdx = findHeaderIndex(headersLower, 'product name');
    const warehouseHeaderIdx = findHeaderIndex(headersLower, 'warehouse name');
    const qtyHeaderIdx = findHeaderIndex(headersLower, (h) => h === 'stock on hand unit');
    const asinHeaderIdx = findHeaderIndex(headersLower, (h) => h === 'asin');

    for (const row of tableData.rows) {
      const cells = row.cells;
      if (cells.length < 3) continue;

      let sku = '';
      let warehouse = '';
      let productName = '';
      let asin = '';
      if (skuHeaderIdx >= 0 && skuHeaderIdx < cells.length) sku = cells[skuHeaderIdx];
      if (nameHeaderIdx >= 0 && nameHeaderIdx < cells.length) productName = cells[nameHeaderIdx];
      if (warehouseHeaderIdx >= 0 && warehouseHeaderIdx < cells.length) warehouse = cells[warehouseHeaderIdx];
      if (asinHeaderIdx >= 0 && asinHeaderIdx < cells.length) asin = cells[asinHeaderIdx];

      if (!sku && cells.length >= 5) sku = cells[4];
      if (!productName && cells.length >= 7) productName = cells[6];
      if (!warehouse && cells.length >= 4) warehouse = cells[3];

      // Canonical key is EAN (541998…). ASIN-looking values are never the EAN key —
      // resolve via EAN in cells, else product name, else ASIN/SKU aliases.
      const ean =
        extractEan(cells) ||
        (/^541998\d{7}$/.test(sku) ? sku : null);

      let qty = 0;
      let qtyFound = false;
      if (qtyHeaderIdx >= 0 && qtyHeaderIdx < cells.length) {
        const rawQty = (cells[qtyHeaderIdx] || '').replace(/[,.\s]/g, '');
        if (rawQty !== '') {
          const parsed = parseInt(rawQty, 10);
          if (!isNaN(parsed)) {
            qty = parsed;
            qtyFound = true;
          }
        }
      }
      if (!qtyFound) {
        // Prefer Stock On Hand Unit region (after product/ASIN cols); avoid carton/pallet
        for (let i = 8; i < Math.min(cells.length, 12); i++) {
          const raw = (cells[i] || '').replace(/[,.\s]/g, '');
          if (raw === '') continue;
          const num = parseInt(raw, 10);
          if (!isNaN(num) && num >= 0 && num < 1000000) {
            qty = num;
            qtyFound = true;
            break;
          }
        }
      }

      const resolved = resolveProductFromText(
        ean || productName || sku || asin,
        portalMappings
      );
      const regionInfo = classifyForcegetWarehouse(warehouse);

      if (resolved && regionInfo && qtyFound) {
        parsedRows.push(
          buildInventoryItem({
            ean: resolved.ean,
            product_name: resolved.product_name,
            on_hand: qty,
            country: regionInfo.country,
            channel: regionInfo.channel,
            region: regionInfo.region,
            warehouse: regionInfo.warehouse,
            raw_name: productName || sku || asin,
          })
        );
      } else if (qtyFound && qty > 0) {
        results.errors.push({
          msg: `Unmatched (no EAN): SKU=${sku}, ASIN=${asin}, Name=${productName}, WH=${warehouse}, Qty=${qty}`,
        });
      }
    }

    const inventoryItems = aggregateInventoryRows(parsedRows);

    await log('parsed', JSON.stringify({
      matched: inventoryItems.length,
      unmatched: results.errors.filter((e) => String(e?.msg || '').startsWith('Unmatched')).length,
      toronto: inventoryItems.filter((i) => i.country === 'CA').length,
      laPerris: inventoryItems.filter((i) => i.country === 'US').length,
      items: inventoryItems.map((i) => ({
        product_name: i.product_name,
        ean: i.ean,
        warehouse: i.warehouse,
        channel: i.channel,
        on_hand: i.on_hand,
      })),
    }));
    results.products = inventoryItems;

    // Step 6: Single canonical write — DELETE by source/channel + POST with EANs
    if (inventoryItems.length > 0) {
      const caItems = inventoryItems.filter((i) => i.country === 'CA');
      // Include zeros when portal lists them (e.g. Trays 1500 White @ LA = 0)
      const usItems = inventoryItems.filter((i) => i.country === 'US');
      await log(
        'write_supabase',
        `Writing ${caItems.length} Toronto + ${usItems.length} LA Perris rows via inventory-supabase...`
      );

      let written = 0;
      if (caItems.length) written += await writeInventoryToSupabase('forceget', caItems);
      if (usItems.length) {
        written += await writeInventoryToSupabase('forceget_us', usItems);
      } else {
        try {
          const { deleteBySource } = require('./inventory-supabase');
          await deleteBySource('playwright_forceget_us');
          await log('write_supabase', 'Cleared playwright_forceget_us (no LA Perris rows scraped)');
        } catch (e) {
          await log('write_warn', `Could not clear forceget_us: ${e.message}`);
        }
      }
      await log('write_done', `Wrote ${written} rows to Inventory_Levels (Toronto + LA Perris, with EANs)`);
      results.inventory_levels_written = written;
    }
    
    // Final screenshot
    await page.screenshot({ path: shotPath('forceget-08-final.png'), fullPage: true });
    
    const incomplete = results.errors.some((e) => String(e?.msg || '').includes('Incomplete scrape'));
    const writeErrors = results.errors.filter((e) => e?.error);
    if (inventoryItems.length === 0) {
      results.success = false;
      results.error = 'No matched Forceget inventory rows found';
    } else if (writeErrors.length) {
      results.success = false;
      results.error = `Forceget write errors: ${writeErrors.length}`;
    } else if (incomplete) {
      results.success = false;
      results.error = results.errors.find((e) => String(e?.msg || '').includes('Incomplete scrape'))?.msg;
    } else {
      results.success = true;
    }
    results.summary = {
      total_products: inventoryItems.length,
      total_units: inventoryItems.reduce((sum, i) => sum + i.on_hand, 0),
      channels: [...new Set(inventoryItems.map(i => i.channel))],
      expected_total_records: tableData.expectedTotalRecords,
      scraped_rows: tableData.rows.length,
      pages_scraped: tableData.pagesScraped,
      unmatched_rows: results.errors.filter((e) => String(e?.msg || '').startsWith('Unmatched')).length,
      write_errors: results.errors.filter((e) => e?.error).length,
      synced_at: new Date().toISOString(),
    };
    
  } catch (error) {
    results.success = false;
    results.error = error.message;
    await log('error', `Script failed: ${error.message}`);
    try { await page.screenshot({ path: shotPath('forceget-error.png'), fullPage: true }); } catch (e) {}
  }
  
  return results;
};
