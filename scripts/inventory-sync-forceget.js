/**
 * inventory-sync-forceget.js v2.1
 * 
 * Key fixes over v1.0:
 * - Angular-specific login (dispatch input/change/blur events after typing)
 * - Cookie persistence: saves cookies after successful login, reuses next time
 * - Screenshot at every step for debugging
 * - Better error messages
 * 
 * Flow:
 * 1. Try cookie-based login first (skip form entirely)
 * 2. If no cookies / cookies expired → Angular-aware form login
 * 3. Save cookies on success for next run
 * 4. Navigate to Inventory at Forceget WH → Live Inventory
 * 5. Scrape table → map to products → write to Inventory_Levels
 * 
 * Channels: 3PL US, 3PL CA
 * credentials_key: forceget
 */

const SUPABASE_URL = 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsdGVhaHljZm1waWF4ZGJubHZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEwMTY3ODIsImV4cCI6MjA1NjU5Mjc4Mn0.LSAZrrjFnMPMnR9Zx5H17T_Hhy-S7CLFOjRyqGG1CPs';

// Product name mapping
const PRODUCT_MAP = {
  'puzzlup 1000': { product_name: 'PUZZLUP MAT 1000', product_id: 1 },
  'puzzlup mat 1000': { product_name: 'PUZZLUP MAT 1000', product_id: 1 },
  'mat 1000': { product_name: 'PUZZLUP MAT 1000', product_id: 1 },
  '1000 piece': { product_name: 'PUZZLUP MAT 1000', product_id: 1 },
  'puzzlup 1500 eco': { product_name: 'PUZZLUP MAT 1500 ECO', product_id: 2 },
  'mat 1500 eco': { product_name: 'PUZZLUP MAT 1500 ECO', product_id: 2 },
  'puzzlup 1500 gift': { product_name: 'PUZZLUP MAT 1500 GIFT', product_id: 4 },
  'mat 1500 gift': { product_name: 'PUZZLUP MAT 1500 GIFT', product_id: 4 },
  '1500 gift': { product_name: 'PUZZLUP MAT 1500 GIFT', product_id: 4 },
  'puzzlup 1500 lux': { product_name: 'PUZZLUP MAT 1500 LUX', product_id: 5 },
  'mat 1500 lux': { product_name: 'PUZZLUP MAT 1500 LUX', product_id: 5 },
  '1500 lux': { product_name: 'PUZZLUP MAT 1500 LUX', product_id: 5 },
  'puzzlup 3000 eco': { product_name: 'PUZZLUP MAT 3000 ECO', product_id: 6 },
  'mat 3000 eco': { product_name: 'PUZZLUP MAT 3000 ECO', product_id: 6 },
  'puzzlup 3000 gift': { product_name: 'PUZZLUP MAT 3000 GIFT', product_id: 7 },
  'mat 3000 gift': { product_name: 'PUZZLUP MAT 3000 GIFT', product_id: 7 },
  '3000 gift': { product_name: 'PUZZLUP MAT 3000 GIFT', product_id: 7 },
  'puzzlup 5000 gift': { product_name: 'PUZZLUP MAT 5000 GIFT', product_id: 8 },
  'mat 5000 gift': { product_name: 'PUZZLUP MAT 5000 GIFT', product_id: 8 },
  '5000 gift': { product_name: 'PUZZLUP MAT 5000 GIFT', product_id: 8 },
  'puzzlup 1000 gift': { product_name: 'PUZZLUP MAT 1000 GIFT', product_id: 9 },
  'mat 1000 gift': { product_name: 'PUZZLUP MAT 1000 GIFT', product_id: 9 },
  '1000 gift': { product_name: 'PUZZLUP MAT 1000 GIFT', product_id: 9 },
  'puzzlup tray 1500': { product_name: 'PUZZLUP TRAYS 1500 BLACK', product_id: 10 },
  'tray 1500': { product_name: 'PUZZLUP TRAYS 1500 BLACK', product_id: 10 },
  'trays 1500 black': { product_name: 'PUZZLUP TRAYS 1500 BLACK', product_id: 10 },
  'puzzlup tray 3000': { product_name: 'PUZZLUP TRAYS 3000 BLACK', product_id: 12 },
  'tray 3000': { product_name: 'PUZZLUP TRAYS 3000 BLACK', product_id: 12 },
  'trays 3000 black': { product_name: 'PUZZLUP TRAYS 3000 BLACK', product_id: 12 },
};

const WAREHOUSE_CHANNEL = {
  'us': '3PL US', 'usa': '3PL US', 'united states': '3PL US',
  'los angeles': '3PL US', 'la': '3PL US', 'new york': '3PL US',
  'ca': '3PL CA', 'can': '3PL CA', 'canada': '3PL CA',
  'vancouver': '3PL CA', 'toronto': '3PL CA',
};

function matchProduct(rawName) {
  if (!rawName) return null;
  const lower = rawName.toLowerCase().trim();
  if (PRODUCT_MAP[lower]) return PRODUCT_MAP[lower];
  for (const [key, val] of Object.entries(PRODUCT_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return null;
}

function matchWarehouse(rawWarehouse) {
  if (!rawWarehouse) return null;
  const lower = rawWarehouse.toLowerCase().trim();
  for (const [key, val] of Object.entries(WAREHOUSE_CHANNEL)) {
    if (lower.includes(key)) return val;
  }
  if (lower.includes('us') || lower.includes('america')) return '3PL US';
  if (lower.includes('ca') || lower.includes('canada')) return '3PL CA';
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
  await page.screenshot({ path: '/tmp/forceget-01-login-page.png', fullPage: true });
  
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
  await page.screenshot({ path: '/tmp/forceget-02-filled.png', fullPage: true });
  
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
  await page.screenshot({ path: '/tmp/forceget-03-after-login.png', fullPage: true });
  
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
    
    await page.screenshot({ path: '/tmp/forceget-04-retry.png', fullPage: true });
    
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
        results.error = 'Login failed - check screenshots in /tmp/forceget-*.png';
        return results;
      }
      
      // Save cookies for next time
      await saveCookies(page, log);
    }
    
    // Step 3: Navigate to Inventory at Forceget WH
    await log('nav_inventory', 'Looking for Inventory in sidebar...');
    await page.screenshot({ path: '/tmp/forceget-05-dashboard.png', fullPage: true });
    
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
      await log('sidebar_failed', 'Could not find Inventory link in sidebar');
      await page.screenshot({ path: '/tmp/forceget-06-no-sidebar.png', fullPage: true });
      results.success = false;
      results.error = 'Inventory link not found in sidebar';
      return results;
    }
    
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: '/tmp/forceget-06-inventory-page.png', fullPage: true });
    
    // Step 4: Click "Live Inventory"
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
    
    await page.waitForTimeout(5000);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: '/tmp/forceget-07-live-inventory.png', fullPage: true });
    
    // Step 5: Scrape inventory table
    await log('scrape', 'Scraping inventory table...');
    
    const tableData = await page.evaluate(() => {
      const rows = [];
      
      // Method 1: Standard HTML table
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const trs = table.querySelectorAll('tbody tr');
        for (const tr of trs) {
          const cells = tr.querySelectorAll('td');
          if (cells.length >= 3) {
            rows.push({ cells: Array.from(cells).map(c => c.textContent.trim()), cellCount: cells.length });
          }
        }
      }
      
      // Method 2: Angular Material table (mat-table)
      if (rows.length === 0) {
        const matRows = document.querySelectorAll('mat-row, [role="row"]');
        for (const row of matRows) {
          const cells = row.querySelectorAll('mat-cell, [role="cell"], [role="gridcell"]');
          if (cells.length >= 3) {
            rows.push({ cells: Array.from(cells).map(c => c.textContent.trim()), cellCount: cells.length });
          }
        }
      }
      
      // Method 3: AG-Grid (common in Angular apps)
      if (rows.length === 0) {
        const agRows = document.querySelectorAll('.ag-row, [class*="ag-row"]');
        for (const row of agRows) {
          const cells = row.querySelectorAll('.ag-cell, [class*="ag-cell"]');
          if (cells.length >= 3) {
            rows.push({ cells: Array.from(cells).map(c => c.textContent.trim()), cellCount: cells.length });
          }
        }
      }
      
      // Method 4: Any div-based grid
      if (rows.length === 0) {
        const gridRows = document.querySelectorAll('[class*="row"]:not(style), [class*="Row"]:not(style)');
        for (const row of gridRows) {
          const cells = row.querySelectorAll('[class*="cell"], [class*="Cell"], [class*="col"], [class*="Col"]');
          if (cells.length >= 3) {
            rows.push({ cells: Array.from(cells).map(c => c.textContent.trim()), cellCount: cells.length });
          }
        }
      }
      
      // Get headers
      const headers = [];
      const ths = document.querySelectorAll('th, mat-header-cell, [role="columnheader"], .ag-header-cell');
      for (const th of ths) headers.push(th.textContent.trim());
      
      return { rows, headers, tableCount: document.querySelectorAll('table').length };
    });
    
    await log('table_data', JSON.stringify({
      rowCount: tableData.rows.length,
      headers: tableData.headers,
      tableCount: tableData.tableCount,
      sampleRows: tableData.rows.slice(0, 3)
    }));
    
    // Parse inventory
    const inventoryItems = [];
    
    for (const row of tableData.rows) {
      const cells = row.cells;
      if (cells.length < 3) continue;
      
      // Find numeric quantity
      let qty = 0, qtyIdx = -1;
      for (let i = cells.length - 1; i >= 0; i--) {
        const num = parseInt(cells[i].replace(/[,.\s]/g, ''));
        if (!isNaN(num) && num >= 0) {
          qty = num;
          qtyIdx = i;
          break;
        }
      }
      if (qtyIdx === -1) continue;
      
      let sku = '', warehouse = '', productName = '';
      if (cells.length >= 4) {
        sku = cells[0]; warehouse = cells[1]; productName = cells[2];
      } else {
        sku = cells[0]; productName = cells[1]; warehouse = 'unknown';
      }
      
      const productMatch = matchProduct(productName) || matchProduct(sku);
      const channel = matchWarehouse(warehouse);
      
      if (productMatch && qty > 0) {
        inventoryItems.push({
          product_name: productMatch.product_name,
          product_id: productMatch.product_id,
          channel: channel || '3PL US',
          qty, raw_sku: sku, raw_warehouse: warehouse, raw_name: productName
        });
      } else {
        results.errors.push({ msg: `Unmatched: SKU=${sku}, Name=${productName}, WH=${warehouse}, Qty=${qty}` });
      }
    }
    
    await log('parsed', JSON.stringify({ matched: inventoryItems.length, unmatched: results.errors.length, items: inventoryItems }));
    results.products = inventoryItems;
    
    // Step 6: Write to Inventory_Levels
    if (inventoryItems.length > 0) {
      await log('write_supabase', `Writing ${inventoryItems.length} items to Inventory_Levels...`);
      const now = new Date().toISOString();
      
      for (const item of inventoryItems) {
        try {
          // Check if row exists
          const checkRes = await fetch(
            `${SUPABASE_URL}/rest/v1/Inventory_Levels?product_name=eq.${encodeURIComponent(item.product_name)}&channel=eq.${encodeURIComponent(item.channel)}&select=id`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
          );
          const existing = await checkRes.json();
          
          if (existing && existing.length > 0) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/Inventory_Levels?product_name=eq.${encodeURIComponent(item.product_name)}&channel=eq.${encodeURIComponent(item.channel)}`,
              {
                method: 'PATCH',
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                body: JSON.stringify({ on_hand: item.qty, last_synced_at: now, source: 'forceget_playwright' })
              }
            );
            await log('updated', `${item.product_name} (${item.channel}): ${item.qty}`);
          } else {
            await fetch(
              `${SUPABASE_URL}/rest/v1/Inventory_Levels`,
              {
                method: 'POST',
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                  product_name: item.product_name,
                  channel: item.channel, channel_type: '3PL',
                  on_hand: item.qty, last_synced_at: now, source: 'forceget_playwright'
                })
              }
            );
            await log('inserted', `${item.product_name} (${item.channel}): ${item.qty}`);
          }
        } catch (e) {
          results.errors.push({ product: item.product_name, error: e.message });
        }
      }
      await log('write_done', `Wrote ${inventoryItems.length} items to Inventory_Levels`);
    }
    
    // Final screenshot
    await page.screenshot({ path: '/tmp/forceget-08-final.png', fullPage: true });
    
    results.success = true;
    results.summary = {
      total_products: inventoryItems.length,
      total_units: inventoryItems.reduce((sum, i) => sum + i.qty, 0),
      channels: [...new Set(inventoryItems.map(i => i.channel))],
      synced_at: new Date().toISOString()
    };
    
  } catch (error) {
    results.success = false;
    results.error = error.message;
    await log('error', `Script failed: ${error.message}`);
    try { await page.screenshot({ path: '/tmp/forceget-error.png', fullPage: true }); } catch (e) {}
  }
  
  return results;
};
