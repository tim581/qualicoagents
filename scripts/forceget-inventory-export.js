/**
 * forceget-inventory-export.js v3.0
 * 
 * Exports inventory from Forceget Toronto (Angular SPA).
 * FIX: Angular client-side routing — use multiple URL patterns + text-based nav.
 * module.exports pattern — receives { page, context, supabase, dbShot } from executor.
 */

module.exports = async ({ page, context, supabase, dbShot }) => {
  const FORCEGET_URL = 'https://app.forceget.com';
  const fs = require('fs');
  
  // ── Load saved cookies ──
  const storageStatePath = './forceget-storage-state.json';
  if (fs.existsSync(storageStatePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
      if (state.cookies && state.cookies.length > 0) {
        await context.addCookies(state.cookies);
        console.log(`Loaded ${state.cookies.length} saved cookies`);
      }
    } catch (e) {
      console.log('Failed to load cookies:', e.message);
    }
  }

  // ── Navigate ──
  console.log('1/6 Opening Forceget...');
  await page.goto(FORCEGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  
  if (dbShot) await dbShot(page, 'after-navigate', `Forceget: ${page.url()}`);
  
  // ── Check login ──
  const url = page.url();
  if (url.includes('login') || url.includes('Login')) {
    console.log('   Cookies expired — attempting auto-login...');
    
    let username, password;
    if (supabase) {
      try {
        const { data } = await supabase.from('Browser_Credentials').select('*').eq('key', 'forceget').single();
        if (data) { username = data.username; password = data.password; }
      } catch (e) { console.log('Credentials lookup failed:', e.message); }
    }
    
    if (!username || !password) {
      return { error: 'Cookies expired and no credentials. Run forceget-save-cookies.js first.' };
    }
    
    try {
      await page.waitForSelector('input[type="text"], input[type="email"], input[formcontrolname]', { timeout: 10000 });
      const emailField = await page.$('input[type="email"], input[formcontrolname="email"], input[placeholder*="email" i], input[type="text"]');
      if (emailField) {
        await emailField.click();
        await emailField.fill('');
        await emailField.type(username, { delay: 50 });
        await emailField.dispatchEvent('input');
      }
      const passField = await page.$('input[type="password"]');
      if (passField) {
        await passField.click();
        await passField.fill('');
        await passField.type(password, { delay: 50 });
        await passField.dispatchEvent('input');
      }
      const loginBtn = await page.$('button[type="submit"], button:has-text("Log in"), button:has-text("Login")');
      if (loginBtn) {
        await loginBtn.click();
        await page.waitForTimeout(5000);
      }
      const cookies = await context.cookies();
      fs.writeFileSync(storageStatePath, JSON.stringify({ cookies }));
      console.log('   Saved cookies');
    } catch (loginErr) {
      if (dbShot) await dbShot(page, 'login-error', `Login failed: ${loginErr.message}`);
      return { error: `Login failed: ${loginErr.message}` };
    }
  }
  
  console.log('   ✅ Logged in! Current URL:', page.url());

  // ── Step 2: Discover page structure ──
  console.log('2/6 Discovering page structure...');
  
  // Log all visible links and menu items for debugging
  const pageInfo = await page.evaluate(() => {
    const links = [];
    document.querySelectorAll('a, [routerlink], .nav-link, .menu-item, li a, .sidebar a, nav a').forEach(el => {
      const text = el.innerText.trim();
      const href = el.getAttribute('href') || '';
      const routerLink = el.getAttribute('routerlink') || '';
      if (text || href || routerLink) {
        links.push({ text: text.substring(0, 80), href, routerLink, tag: el.tagName });
      }
    });
    return {
      url: window.location.href,
      title: document.title,
      links: links.slice(0, 50),
      bodyPreview: document.body.innerText.substring(0, 1500)
    };
  });
  
  console.log(`   Page title: ${pageInfo.title}`);
  console.log(`   Found ${pageInfo.links.length} links`);
  pageInfo.links.forEach((l, i) => {
    if (l.text.toLowerCase().includes('inventory') || l.text.toLowerCase().includes('warehouse') || l.routerLink.includes('inventory')) {
      console.log(`   🎯 Link ${i}: "${l.text}" href=${l.href} routerLink=${l.routerLink}`);
    }
  });
  
  if (dbShot) await dbShot(page, 'page-structure', `Links: ${JSON.stringify(pageInfo.links.slice(0, 20))}`);

  // ── Step 3: Navigate to Inventory ──
  console.log('3/6 Navigating to Inventory...');
  
  let navigated = false;
  
  // Strategy 1: Click text that contains "Inventory at Forceget"
  if (!navigated) {
    try {
      const el = page.getByText(/Inventory at Forceget/i).first();
      if (await el.count() > 0) {
        console.log('   Strategy 1: Clicking "Inventory at Forceget"...');
        await el.click();
        await page.waitForTimeout(4000);
        navigated = true;
        console.log('   ✅ Clicked! URL:', page.url());
      }
    } catch (e) { console.log('   Strategy 1 failed:', e.message); }
  }
  
  // Strategy 2: Click any link/element containing "Inventory"
  if (!navigated) {
    try {
      const el = page.getByText(/Inventory/i).first();
      if (await el.count() > 0) {
        console.log('   Strategy 2: Clicking first "Inventory" text...');
        await el.click();
        await page.waitForTimeout(4000);
        navigated = true;
        console.log('   ✅ Clicked! URL:', page.url());
      }
    } catch (e) { console.log('   Strategy 2 failed:', e.message); }
  }
  
  // Strategy 3: Try common Angular URL patterns
  if (!navigated) {
    const urlPatterns = [
      '/system/inventory',
      '/inventory',
      '/warehouse/inventory',
      '/dashboard/inventory',
      '/app/inventory',
      '/forceget-warehouse/inventory'
    ];
    for (const pattern of urlPatterns) {
      try {
        console.log(`   Strategy 3: Trying ${FORCEGET_URL}${pattern}...`);
        await page.goto(`${FORCEGET_URL}${pattern}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(3000);
        const newUrl = page.url();
        if (!newUrl.includes('login') && !newUrl.includes('404') && newUrl !== url) {
          navigated = true;
          console.log(`   ✅ Route works! URL: ${newUrl}`);
          break;
        }
      } catch (e) { /* try next */ }
    }
  }
  
  // Strategy 4: Use Angular router directly
  if (!navigated) {
    try {
      console.log('   Strategy 4: Injecting Angular router navigation...');
      await page.evaluate(() => {
        // Try to find Angular router
        const el = document.querySelector('[routerlink*="inventory"]');
        if (el) { el.click(); return; }
        // Try ng.getComponent approach
        const nav = document.querySelector('app-root, router-outlet');
        if (nav && window.ng) {
          const router = window.ng.getInjector(nav).get(window.ng.Router || 'Router');
          if (router) router.navigate(['/inventory']);
        }
      });
      await page.waitForTimeout(4000);
      navigated = page.url() !== url;
      if (navigated) console.log('   ✅ Angular router worked! URL:', page.url());
    } catch (e) { console.log('   Strategy 4 failed:', e.message); }
  }
  
  if (dbShot) await dbShot(page, 'after-inventory-nav', `Forceget: navigated=${navigated}, URL=${page.url()}`);

  // ── Step 4: Click Live Inventory ──
  console.log('4/6 Looking for Live Inventory...');
  
  try {
    const liveInv = page.getByText(/Live Inventory/i).first();
    if (await liveInv.count() > 0) {
      console.log('   Clicking "Live Inventory"...');
      await liveInv.click();
      await page.waitForTimeout(4000);
      console.log('   ✅ URL:', page.url());
    } else {
      console.log('   "Live Inventory" text not found — checking if already on right page');
    }
  } catch (e) {
    console.log('   Live Inventory click failed:', e.message);
  }
  
  if (dbShot) await dbShot(page, 'live-inventory-page', `Forceget: ${page.url()}`);

  // ── Step 5: Wait for table ──
  console.log('5/6 Waiting for data table...');
  
  let retries = 0;
  let rowCount = 0;
  const maxRetries = 10;
  
  while (retries < maxRetries && rowCount === 0) {
    await page.waitForTimeout(3000);
    
    rowCount = await page.evaluate(() => {
      // Try multiple table selectors (Angular apps use various patterns)
      const selectors = [
        'table tbody tr',
        '.ag-row',
        'tr.ng-star-inserted',
        '[role="row"]',
        'mat-row',
        '.mat-row',
        '.p-datatable-tbody tr',
        'cdk-row',
        '.table-row',
        'tbody tr'
      ];
      for (const sel of selectors) {
        const rows = document.querySelectorAll(sel);
        if (rows.length > 0) return rows.length;
      }
      return 0;
    });
    
    retries++;
    console.log(`   Attempt ${retries}/${maxRetries}: ${rowCount} rows found`);
    
    if (rowCount === 0 && retries < maxRetries) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
  
  // ── Extra debug: dump page content if no rows ──
  if (rowCount === 0) {
    const debugInfo = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        tables: document.querySelectorAll('table').length,
        allTrs: document.querySelectorAll('tr').length,
        bodyText: document.body.innerText.substring(0, 3000)
      };
    });
    console.log('   ⚠️ No rows found. Debug info:');
    console.log(`   URL: ${debugInfo.url}`);
    console.log(`   Tables: ${debugInfo.tables}, TRs: ${debugInfo.allTrs}`);
    console.log(`   Body preview: ${debugInfo.bodyText.substring(0, 500)}`);
    
    if (dbShot) await dbShot(page, 'no-data-debug', `Tables: ${debugInfo.tables}, TRs: ${debugInfo.allTrs}. Text: ${debugInfo.bodyText.substring(0, 500)}`);
    
    return { 
      error: 'No data rows found after waiting',
      page_url: debugInfo.url,
      tables_found: debugInfo.tables,
      trs_found: debugInfo.allTrs,
      body_preview: debugInfo.bodyText.substring(0, 1000)
    };
  }

  if (dbShot) await dbShot(page, 'table-loaded', `Forceget: ${rowCount} rows after ${retries} attempts`);

  // ── Step 6: Scrape table ──
  console.log('6/6 Scraping data...');
  
  const tableData = await page.evaluate(() => {
    const headers = [];
    // Try multiple header patterns
    const headerEls = document.querySelectorAll('table thead th, th, .ag-header-cell, mat-header-cell, .p-column-title');
    headerEls.forEach(th => {
      const text = th.innerText.trim();
      if (text && !headers.includes(text)) headers.push(text);
    });
    
    const rows = [];
    const trEls = document.querySelectorAll('table tbody tr, tr.ng-star-inserted, .ag-row, mat-row');
    trEls.forEach(tr => {
      const cells = tr.querySelectorAll('td, .ag-cell, mat-cell');
      if (cells.length < 2) return;
      
      const row = {};
      let colIdx = 0;
      cells.forEach(cell => {
        if (cell.querySelector('input[type=checkbox]')) return;
        const key = headers[colIdx] || `col_${colIdx}`;
        row[key] = cell.innerText.trim();
        colIdx++;
      });
      
      if (Object.keys(row).length > 0 && Object.values(row).some(v => v !== '')) {
        rows.push(row);
      }
    });
    
    return { headers, rows };
  });

  console.log(`\n✅ Scraped ${tableData.rows.length} products`);
  tableData.rows.forEach((row, i) => {
    const sku = row['Sku'] || row['SKU'] || row['sku'] || '';
    const name = row['Product Name'] || row['Name'] || row['name'] || '';
    const onHand = row['Stock On Hand Unit'] || row['On Hand'] || row['Stock On Hand'] || '';
    const available = row['Available'] || '';
    console.log(`  ${i+1}. ${sku} — ${name} — OnHand: ${onHand} — Available: ${available}`);
  });

  return {
    success: true,
    scraped_at: new Date().toISOString(),
    source: 'forceget',
    headers: tableData.headers,
    items: tableData.rows,
    total_rows: tableData.rows.length
  };
};
