/**
 * forceget-inventory-export.js v2.0
 * 
 * Exports inventory from Forceget Toronto (Angular app).
 * module.exports pattern — receives { page, context, supabase, dbShot } from executor.
 * Returns inventory data as JSON in Browser_Tasks.result.
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
  console.log('1/5 Opening Forceget...');
  await page.goto(FORCEGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  
  if (dbShot) await dbShot(page, 'after-navigate', 'Forceget: initial page');
  
  // ── Check login ──
  const url = page.url();
  if (url.includes('login') || url.includes('Login')) {
    console.log('Cookies expired — attempting auto-login...');
    
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
    
    // Angular login — dispatch input events
    try {
      await page.waitForSelector('input[type="text"], input[type="email"], input[formcontrolname]', { timeout: 10000 });
      
      // Find and fill username
      const emailField = await page.$('input[type="email"], input[formcontrolname="email"], input[placeholder*="email" i], input[type="text"]');
      if (emailField) {
        await emailField.click();
        await emailField.fill('');
        await emailField.type(username, { delay: 50 });
        // Angular needs input event
        await emailField.dispatchEvent('input');
        await emailField.dispatchEvent('change');
      }
      
      // Find and fill password
      const passField = await page.$('input[type="password"]');
      if (passField) {
        await passField.click();
        await passField.fill('');
        await passField.type(password, { delay: 50 });
        await passField.dispatchEvent('input');
        await passField.dispatchEvent('change');
      }
      
      if (dbShot) await dbShot(page, 'login-filled', 'Forceget: credentials filled');
      
      // Click login button
      const loginBtn = await page.$('button[type="submit"], button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in")');
      if (loginBtn) {
        await loginBtn.click();
        await page.waitForTimeout(5000);
      }
      
      if (dbShot) await dbShot(page, 'after-login', 'Forceget: after login');
      
      // Save cookies
      const cookies = await context.cookies();
      fs.writeFileSync(storageStatePath, JSON.stringify({ cookies }));
      console.log('Saved cookies for next run');
    } catch (loginErr) {
      if (dbShot) await dbShot(page, 'login-error', `Login failed: ${loginErr.message}`);
      return { error: `Login failed: ${loginErr.message}` };
    }
  }
  
  console.log('   Logged in!');

  // ── Navigate to Inventory at Forceget WH ──
  console.log('2/5 Navigating to Inventory...');
  try {
    // Try clicking navigation link
    const invLink = await page.$('a:has-text("Inventory at Forceget"), a:has-text("Inventory"), [routerlink*="inventory"]');
    if (invLink) {
      await invLink.click();
      await page.waitForTimeout(3000);
    } else {
      // Try direct navigation
      await page.goto(`${FORCEGET_URL}/inventory`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    }
  } catch (e) {
    console.log('Nav click failed, trying menu:', e.message);
  }
  
  if (dbShot) await dbShot(page, 'inventory-page', 'Forceget: inventory page');

  // ── Click Live Inventory ──
  console.log('3/5 Looking for Live Inventory...');
  try {
    const liveInv = await page.$('a:has-text("Live Inventory"), button:has-text("Live Inventory"), [routerlink*="live"]');
    if (liveInv) {
      await liveInv.click();
      await page.waitForTimeout(3000);
    }
  } catch (e) {
    console.log('Live Inventory click failed:', e.message);
  }
  
  if (dbShot) await dbShot(page, 'live-inventory', 'Forceget: live inventory page');

  // ── Wait for Angular table to render (KEY FIX) ──
  console.log('4/5 Waiting for data table...');
  
  let retries = 0;
  let rowCount = 0;
  const maxRetries = 8;
  
  while (retries < maxRetries && rowCount === 0) {
    await page.waitForTimeout(3000);
    
    rowCount = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr, .ag-row, tr.ng-star-inserted, [role="row"]');
      return rows.length;
    });
    
    retries++;
    console.log(`   Attempt ${retries}/${maxRetries}: ${rowCount} rows found`);
    
    if (rowCount === 0 && retries < maxRetries) {
      // Try scrolling to trigger lazy load
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
  
  if (dbShot) await dbShot(page, 'table-loaded', `Forceget: ${rowCount} rows after ${retries} attempts`);
  
  if (rowCount === 0) {
    // Take full page screenshot for debugging
    if (dbShot) await dbShot(page, 'no-data', 'Forceget: NO DATA — taking full screenshot');
    
    // Try to get any text that might indicate what happened
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
    return { 
      error: 'No data rows found after waiting',
      page_url: page.url(),
      body_preview: bodyText
    };
  }

  // ── Scrape table ──
  console.log('5/5 Scraping data...');
  
  const tableData = await page.evaluate(() => {
    // Get headers
    const headers = [];
    const ths = document.querySelectorAll('table thead th, th');
    ths.forEach(th => {
      const text = th.innerText.trim();
      if (text) headers.push(text);
    });
    
    // Get rows
    const rows = [];
    const trs = document.querySelectorAll('table tbody tr, tr.ng-star-inserted');
    trs.forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 2) return;
      
      const row = {};
      let colIdx = 0;
      cells.forEach(cell => {
        // Skip checkbox columns
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

  console.log(`Scraped ${tableData.rows.length} products`);
  tableData.rows.forEach((row, i) => {
    const sku = row['Sku'] || row['SKU'] || row['sku'] || '';
    const onHand = row['Stock On Hand Unit'] || row['On Hand'] || '';
    console.log(`  ${i+1}. ${sku} — OnHand: ${onHand}`);
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
