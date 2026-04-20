/**
 * corax-wms-stock-export.js v2.0
 * 
 * Scrapes Vanthiel/Kamps Corax WMS "Stocks per artikel" page.
 * Returns RAW JSON in Browser_Tasks.result — agent handles mapping + Inventory_Levels write.
 * 
 * Auth: cookie-based (run corax-wms-save-cookies.js first for manual login)
 * Fallback: auto-login using Browser_Credentials key='corax'
 */

module.exports = async ({ page, context, supabase, dbShot }) => {
  const CORAX_URL = 'https://kampspijnacker.coraxwms.nl';
  
  // Try loading saved cookies
  const storageStatePath = './corax-wms-storage-state.json';
  const fs = require('fs');
  
  if (fs.existsSync(storageStatePath)) {
    try {
      const storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
      if (storageState.cookies && storageState.cookies.length > 0) {
        await context.addCookies(storageState.cookies);
        console.log(`Loaded ${storageState.cookies.length} saved cookies`);
      }
    } catch (e) {
      console.log('Failed to load cookies:', e.message);
    }
  }
  
  // Navigate to stock page
  await page.goto(`${CORAX_URL}/Stocks`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  if (dbShot) await dbShot(page, 'after-navigate', 'Navigated to stocks page');
  
  // Check if we need to login
  const currentUrl = page.url();
  if (currentUrl.includes('Login') || currentUrl.includes('login') || currentUrl.includes('Account')) {
    console.log('Not authenticated — attempting auto-login...');
    
    // Get credentials from Supabase
    let username, password;
    if (supabase) {
      try {
        const { data } = await supabase.from('Browser_Credentials').select('*').eq('key', 'corax').single();
        if (data) {
          username = data.username;
          password = data.password;
        }
      } catch (e) {
        console.log('Failed to get credentials:', e.message);
      }
    }
    
    if (!username || !password) {
      return { error: 'No saved cookies and no credentials available. Run corax-wms-save-cookies.js first.' };
    }
    
    // Try to login
    try {
      // Wait for login form
      await page.waitForSelector('input[type="text"], input[name="username"], input[name="UserName"], #UserName, input[type="email"]', { timeout: 10000 });
      
      // Fill username
      const usernameField = await page.$('input[type="text"], input[name="username"], input[name="UserName"], #UserName, input[type="email"]');
      if (usernameField) {
        await usernameField.click({ clickCount: 3 });
        await usernameField.fill(username);
      }
      
      // Fill password
      const passwordField = await page.$('input[type="password"]');
      if (passwordField) {
        await passwordField.click({ clickCount: 3 });
        await passwordField.fill(password);
      }
      
      if (dbShot) await dbShot(page, 'login-filled', 'Credentials filled');
      
      // Click login button
      const loginBtn = await page.$('button[type="submit"], input[type="submit"], .btn-primary, button:has-text("Log in"), button:has-text("Login"), button:has-text("Inloggen")');
      if (loginBtn) {
        await loginBtn.click();
        await page.waitForTimeout(5000);
      }
      
      if (dbShot) await dbShot(page, 'after-login', 'After login attempt');
      
      // Save cookies for next time
      const cookies = await context.cookies();
      fs.writeFileSync(storageStatePath, JSON.stringify({ cookies }));
      console.log('Saved cookies for next run');
      
      // Navigate to stocks page
      await page.goto(`${CORAX_URL}/Stocks`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
    } catch (loginErr) {
      if (dbShot) await dbShot(page, 'login-error', `Login failed: ${loginErr.message}`);
      return { error: `Login failed: ${loginErr.message}` };
    }
  }
  
  if (dbShot) await dbShot(page, 'stocks-page', 'On stocks page');
  
  // Check if we're on the right page
  const pageTitle = await page.title();
  console.log('Page title:', pageTitle);
  
  // Look for "Stocks per artikel" link/tab and click it
  try {
    const artikelLink = await page.$('a:has-text("Stocks per artikel"), a:has-text("Per artikel"), a[href*="artikel"], a[href*="Artikel"]');
    if (artikelLink) {
      await artikelLink.click();
      await page.waitForTimeout(3000);
      if (dbShot) await dbShot(page, 'per-artikel', 'Clicked stocks per artikel');
    }
  } catch (e) {
    console.log('Could not find "per artikel" link, may already be on right page');
  }
  
  // Try to show all results (pagination)
  try {
    const showAll = await page.$('select[name*="length"], select.form-control');
    if (showAll) {
      await showAll.selectOption({ label: 'Alle' });
      await page.waitForTimeout(2000);
    }
  } catch (e) {
    console.log('No pagination control found');
  }
  
  // Scrape the table
  const stockData = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    const items = [];
    
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        const item = {
          raw_cells: Array.from(cells).map(c => c.textContent.trim())
        };
        items.push(item);
      }
    });
    
    // Also get headers
    const headers = [];
    const headerCells = document.querySelectorAll('table thead th, table tr:first-child th');
    headerCells.forEach(th => headers.push(th.textContent.trim()));
    
    return { headers, items, totalRows: rows.length };
  });
  
  if (dbShot) await dbShot(page, 'scraped', `Scraped ${stockData.totalRows} rows`);
  
  console.log(`Found ${stockData.totalRows} stock rows`);
  console.log('Headers:', JSON.stringify(stockData.headers));
  if (stockData.items.length > 0) {
    console.log('Sample row:', JSON.stringify(stockData.items[0]));
  }
  
  return {
    success: true,
    scraped_at: new Date().toISOString(),
    headers: stockData.headers,
    items: stockData.items,
    total_rows: stockData.totalRows
  };
};
