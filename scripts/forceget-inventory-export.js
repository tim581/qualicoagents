/**
 * forceget-inventory-export.js v3.0
 * 
 * Exports inventory from Forceget Toronto (Angular app).
 * Key fix: proper Angular SPA navigation via menu clicks, not URL navigation.
 * Aggressive debugging with screenshots at every step.
 */

module.exports = async ({ page, context, supabase, dbShot }) => {
  const FORCEGET_URL = 'https://app.forceget.com';
  const fs = require('fs');
  
  const log = (msg) => console.log(`[Forceget] ${msg}`);
  const shot = async (step, msg) => {
    const url = page.url();
    log(`📸 ${step}: ${msg} [URL: ${url}]`);
    if (dbShot) await dbShot(page, step, `${msg} | URL: ${url}`);
  };

  // ── Load saved cookies ──
  const storageStatePath = './forceget-storage-state.json';
  if (fs.existsSync(storageStatePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
      if (state.cookies && state.cookies.length > 0) {
        await context.addCookies(state.cookies);
        log(`Loaded ${state.cookies.length} saved cookies`);
      }
    } catch (e) {
      log('Failed to load cookies: ' + e.message);
    }
  }

  // ── Navigate ──
  log('1/6 Opening Forceget...');
  await page.goto(FORCEGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  await shot('01-initial', 'Initial page loaded');

  // ── Check login ──
  const url = page.url();
  if (url.includes('login') || url.includes('Login') || url.includes('sign-in')) {
    log('Need to login...');
    
    let username, password;
    if (supabase) {
      try {
        const { data } = await supabase.from('Browser_Credentials').select('*').eq('key', 'forceget').single();
        if (data) { username = data.username; password = data.password; }
      } catch (e) { log('Credentials lookup failed: ' + e.message); }
    }
    
    if (!username || !password) {
      return { error: 'No credentials available' };
    }
    
    try {
      // Wait for any input field
      await page.waitForSelector('input', { timeout: 10000 });
      
      // Get all input fields and log them
      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input')).map(i => ({
          type: i.type, name: i.name, id: i.id, placeholder: i.placeholder,
          formcontrolname: i.getAttribute('formcontrolname')
        }));
      });
      log('Input fields found: ' + JSON.stringify(inputs));
      
      // Fill email — try multiple selectors
      const emailSelectors = [
        'input[formcontrolname="email"]',
        'input[type="email"]',
        'input[name="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="Email" i]',
        'input[type="text"]:first-of-type'
      ];
      
      let emailFilled = false;
      for (const sel of emailSelectors) {
        const field = await page.$(sel);
        if (field) {
          await field.click();
          await field.fill('');
          await field.type(username, { delay: 30 });
          await field.dispatchEvent('input');
          await field.dispatchEvent('change');
          log(`Email filled with selector: ${sel}`);
          emailFilled = true;
          break;
        }
      }
      if (!emailFilled) log('WARNING: Could not find email field!');
      
      // Fill password
      const passField = await page.$('input[type="password"]');
      if (passField) {
        await passField.click();
        await passField.fill('');
        await passField.type(password, { delay: 30 });
        await passField.dispatchEvent('input');
        await passField.dispatchEvent('change');
        log('Password filled');
      }
      
      await shot('02-login-filled', 'Credentials filled');
      
      // Click login button
      const btnSelectors = [
        'button[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        'button:has-text("SIGN IN")'
      ];
      
      for (const sel of btnSelectors) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          log(`Clicked login button: ${sel}`);
          break;
        }
      }
      
      await page.waitForTimeout(6000);
      await shot('03-after-login', 'After login');
      
      // Save cookies
      const cookies = await context.cookies();
      fs.writeFileSync(storageStatePath, JSON.stringify({ cookies }));
    } catch (loginErr) {
      await shot('login-error', 'Login failed: ' + loginErr.message);
      return { error: 'Login failed: ' + loginErr.message };
    }
  }
  
  log('Logged in!');
  
  // ── Dump page structure to find navigation ──
  log('2/6 Analyzing page structure...');
  const navInfo = await page.evaluate(() => {
    // Find all links
    const links = Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.textContent.trim().substring(0, 60),
      href: a.href,
      routerLink: a.getAttribute('routerlink') || a.getAttribute('routerLink'),
      class: a.className.substring(0, 60)
    })).filter(a => a.text);
    
    // Find sidebar/nav menus
    const navs = Array.from(document.querySelectorAll('nav, .sidebar, .nav, [role="navigation"], .menu')).map(n => ({
      tag: n.tagName, class: n.className.substring(0, 60),
      text: n.textContent.trim().substring(0, 200)
    }));
    
    return { links: links.slice(0, 50), navs: navs.slice(0, 10) };
  });
  
  log('Links found: ' + navInfo.links.length);
  navInfo.links.forEach(l => log(`  Link: "${l.text}" → ${l.href} [router: ${l.routerLink}]`));
  
  // ── Navigate to Inventory section ──
  log('3/6 Looking for Inventory menu...');
  
  // Strategy 1: Click link with "Inventory" text
  let navigated = false;
  const inventorySelectors = [
    'a:has-text("Inventory at Forceget")',
    'a:has-text("Inventory At Forceget")',
    'a[routerlink*="inventory"]',
    'a[routerLink*="inventory"]',
    'a[href*="inventory"]',
    'a:has-text("Inventory")',
    'a:has-text("Stock")',
    'a:has-text("Warehouse")',
  ];
  
  for (const sel of inventorySelectors) {
    try {
      const link = await page.$(sel);
      if (link) {
        const linkText = await link.textContent();
        log(`Found inventory link: "${linkText.trim()}" with selector ${sel}`);
        await link.click();
        await page.waitForTimeout(4000);
        navigated = true;
        await shot('04-inventory-clicked', `Clicked: ${linkText.trim()}`);
        break;
      }
    } catch (e) {
      log(`Selector ${sel} failed: ${e.message}`);
    }
  }
  
  if (!navigated) {
    log('No inventory link found — trying URL navigation...');
    // Strategy 2: Try common Angular routes
    const routes = [
      '/inventory',
      '/inventory-at-forceget', 
      '/warehouse/inventory',
      '/stock',
      '/#/inventory',
    ];
    for (const route of routes) {
      try {
        await page.goto(FORCEGET_URL + route, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);
        const pageText = await page.textContent('body');
        if (pageText.includes('SKU') || pageText.includes('Stock') || pageText.includes('On Hand')) {
          log(`Route ${route} looks like inventory page!`);
          navigated = true;
          break;
        }
      } catch (e) { /* next route */ }
    }
    await shot('04-nav-attempts', 'After navigation attempts');
  }

  // ── Look for Live Inventory sub-tab ──
  log('4/6 Looking for Live Inventory tab...');
  try {
    const liveSelectors = [
      'a:has-text("Live Inventory")',
      'button:has-text("Live Inventory")',
      'a:has-text("Live")',
      '[routerlink*="live"]',
      'a[href*="live"]',
    ];
    for (const sel of liveSelectors) {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        log(`Found Live Inventory: "${text.trim()}" with ${sel}`);
        await el.click();
        await page.waitForTimeout(4000);
        await shot('05-live-inventory', 'Clicked Live Inventory');
        break;
      }
    }
  } catch (e) {
    log('Live Inventory click failed: ' + e.message);
  }

  // ── Wait for table data ──
  log('5/6 Waiting for data table...');
  
  // First, dump current page text to understand structure
  const pagePreview = await page.evaluate(() => {
    return document.body.innerText.substring(0, 3000);
  });
  log('Page text preview:\n' + pagePreview.substring(0, 1000));
  
  let retries = 0;
  let rowCount = 0;
  const maxRetries = 10;
  
  while (retries < maxRetries && rowCount === 0) {
    await page.waitForTimeout(3000);
    
    // Try multiple table selectors
    rowCount = await page.evaluate(() => {
      // Standard table
      let rows = document.querySelectorAll('table tbody tr');
      if (rows.length > 0) return rows.length;
      
      // AG Grid
      rows = document.querySelectorAll('.ag-row, .ag-center-cols-container [role="row"]');
      if (rows.length > 0) return rows.length;
      
      // Angular material table
      rows = document.querySelectorAll('mat-row, [role="row"]:not([role="columnheader"])');
      if (rows.length > 0) return rows.length;
      
      // Any table-like rows
      rows = document.querySelectorAll('tr:not(:first-child), .row-data, [class*="row"]:not([class*="header"])');
      return rows.length;
    });
    
    retries++;
    log(`Attempt ${retries}/${maxRetries}: ${rowCount} rows`);
    
    if (rowCount === 0 && retries < maxRetries) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
  
  await shot('06-table-data', `${rowCount} rows found after ${retries} attempts`);
  
  if (rowCount === 0) {
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
    return { 
      error: 'No data rows found',
      page_url: page.url(),
      body_preview: bodyText.substring(0, 2000)
    };
  }

  // ── Scrape table ──
  log('6/6 Scraping inventory data...');
  
  const tableData = await page.evaluate(() => {
    // Get headers first
    const headers = [];
    document.querySelectorAll('table thead th, th').forEach(th => {
      const text = th.innerText.trim();
      if (text && !headers.includes(text)) headers.push(text);
    });
    
    // If no standard headers, try AG Grid
    if (headers.length === 0) {
      document.querySelectorAll('.ag-header-cell-text, [role="columnheader"]').forEach(h => {
        const text = h.innerText.trim();
        if (text) headers.push(text);
      });
    }
    
    // Get rows
    const rows = [];
    const trs = document.querySelectorAll('table tbody tr');
    
    trs.forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 2) return;
      
      const row = {};
      cells.forEach((cell, i) => {
        const key = headers[i] || `col_${i}`;
        row[key] = cell.innerText.trim();
      });
      
      if (Object.keys(row).length > 0 && Object.values(row).some(v => v !== '')) {
        rows.push(row);
      }
    });
    
    return { headers, rows };
  });

  log(`Scraped ${tableData.rows.length} items`);
  tableData.rows.forEach((row, i) => {
    const sku = row['SKU'] || row['Sku'] || row['sku'] || row['col_0'] || '';
    const onHand = row['Stock On Hand Unit'] || row['Stock On Hand'] || row['On Hand'] || row['col_1'] || '';
    log(`  ${i+1}. ${sku} — OnHand: ${onHand}`);
  });

  return {
    success: true,
    scraped_at: new Date().toISOString(),
    source: 'forceget',
    page_url: page.url(),
    headers: tableData.headers,
    items: tableData.rows,
    total_rows: tableData.rows.length
  };
};
