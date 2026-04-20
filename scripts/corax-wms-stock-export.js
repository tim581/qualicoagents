/**
 * corax-wms-stock-export.js v3.0
 * 
 * Scrapes Vanthiel/Kamps Corax WMS stock data.
 * Key fix: better navigation to correct sub-page, extensive debugging.
 * Auth: cookie-based, with auto-login fallback.
 */

module.exports = async ({ page, context, supabase, dbShot }) => {
  const CORAX_URL = 'https://kampspijnacker.coraxwms.nl';
  const fs = require('fs');
  
  const log = (msg) => console.log(`[Corax] ${msg}`);
  const shot = async (step, msg) => {
    try {
      const url = page.url();
      log(`📸 ${step}: ${msg} [URL: ${url}]`);
      if (dbShot) await dbShot(page, step, `${msg} | URL: ${url}`);
    } catch (e) {
      log(`dbShot failed at ${step}: ${e.message}`);
    }
  };

  log('=== Corax WMS Stock Export v3.0 ===');
  
  // ── Load saved cookies ──
  const storageStatePath = './corax-wms-storage-state.json';
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
  } else {
    log('No cookie file found at ' + storageStatePath);
  }

  // ── Navigate to Stocks page ──
  log('1/6 Opening Corax WMS...');
  try {
    await page.goto(`${CORAX_URL}/Stocks`, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    log('Navigation with networkidle failed, trying load: ' + e.message);
    await page.goto(`${CORAX_URL}/Stocks`, { waitUntil: 'load', timeout: 30000 });
  }
  await page.waitForTimeout(3000);
  
  await shot('01-initial', 'Initial page after /Stocks');

  // ── Check if we need to login ──
  const currentUrl = page.url();
  log(`Current URL: ${currentUrl}`);
  
  if (currentUrl.includes('Login') || currentUrl.includes('login') || currentUrl.includes('Account')) {
    log('Not authenticated — logging in...');
    
    let username, password;
    if (supabase) {
      try {
        const { data } = await supabase.from('Browser_Credentials').select('*').eq('key', 'corax').single();
        if (data) { username = data.username; password = data.password; }
        log(`Credentials loaded: ${username ? 'yes' : 'no'}`);
      } catch (e) { log('Credentials lookup: ' + e.message); }
    }
    
    if (!username || !password) {
      return { error: 'No cookies and no credentials' };
    }
    
    try {
      // Dump form fields
      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input, button')).map(i => ({
          tag: i.tagName, type: i.type, name: i.name, id: i.id, placeholder: i.placeholder
        }));
      });
      log('Form fields: ' + JSON.stringify(inputs));
      
      const userSelectors = ['input[name="username"]', 'input[name="UserName"]', '#UserName', 'input[type="email"]', 'input[type="text"]'];
      for (const sel of userSelectors) {
        const field = await page.$(sel);
        if (field) {
          await field.fill(username);
          log(`Username filled: ${sel}`);
          break;
        }
      }
      
      const passField = await page.$('input[type="password"]');
      if (passField) {
        await passField.fill(password);
        log('Password filled');
      }
      
      await shot('02-login-filled', 'Credentials filled');
      
      const loginBtns = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Log")', 'button:has-text("Inloggen")'];
      for (const sel of loginBtns) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          log(`Login clicked: ${sel}`);
          break;
        }
      }
      
      await page.waitForTimeout(5000);
      await shot('03-after-login', 'After login');
      
      // Save cookies
      const cookies = await context.cookies();
      fs.writeFileSync(storageStatePath, JSON.stringify({ cookies }));
      
      // Navigate to stocks
      await page.goto(`${CORAX_URL}/Stocks`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
      
    } catch (loginErr) {
      await shot('login-error', 'Login failed: ' + loginErr.message);
      return { error: 'Login failed: ' + loginErr.message };
    }
  }
  
  log('Authenticated!');
  await shot('04-stocks-page', 'On stocks page');

  // ── Analyze page structure ──
  log('2/6 Analyzing page...');
  const pageInfo = await page.evaluate(() => {
    const text = document.body.innerText.substring(0, 3000);
    const links = Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.textContent.trim().substring(0, 60),
      href: a.href
    })).filter(a => a.text);
    const tabs = Array.from(document.querySelectorAll('.nav-tabs a, .tab-pane, [role="tab"], .nav-link')).map(t => ({
      text: t.textContent.trim(),
      href: t.href || '',
      active: t.classList.contains('active')
    }));
    return { bodyPreview: text.substring(0, 1000), links: links.slice(0, 30), tabs };
  });
  
  log(`Body: ${pageInfo.bodyPreview.substring(0, 500)}`);
  log(`Tabs: ${JSON.stringify(pageInfo.tabs)}`);
  
  // Look for relevant links
  pageInfo.links.forEach(l => {
    if (l.text.toLowerCase().includes('stock') || l.text.toLowerCase().includes('artikel') || l.text.toLowerCase().includes('product')) {
      log(`  Relevant link: "${l.text}" → ${l.href}`);
    }
  });

  // ── Navigate to "Stocks per artikel" sub-page ──
  log('3/6 Looking for "Stocks per artikel"...');
  
  const artikelSelectors = [
    'a:has-text("Stocks per artikel")',
    'a:has-text("Per artikel")',
    'a:has-text("per artikel")',
    'a[href*="Artikel"]',
    'a[href*="artikel"]',
    'a[href*="PerArtikel"]',
    'a[href*="perartikel"]',
    '.nav-tabs a:has-text("artikel")',
    '.nav-link:has-text("artikel")',
  ];
  
  let foundArtikel = false;
  for (const sel of artikelSelectors) {
    try {
      const link = await page.$(sel);
      if (link) {
        const linkText = await link.textContent();
        log(`Found artikel link: "${linkText.trim()}" with ${sel}`);
        await link.click();
        await page.waitForTimeout(3000);
        foundArtikel = true;
        await shot('05-per-artikel', `Clicked: ${linkText.trim()}`);
        break;
      }
    } catch (e) { /* try next */ }
  }
  
  if (!foundArtikel) {
    log('No "per artikel" link found. Trying URL patterns...');
    const routes = [
      '/Stocks/PerArtikel',
      '/Stocks/Artikel',
      '/Stocks?view=artikel',
      '/Stock/PerArtikel',
      '/Stocks/Index',
    ];
    for (const route of routes) {
      try {
        await page.goto(CORAX_URL + route, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);
        const rows = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
        log(`Route ${route}: ${rows} rows`);
        if (rows > 0) {
          foundArtikel = true;
          break;
        }
      } catch (e) { /* next */ }
    }
    await shot('05-route-attempts', 'After URL attempts');
  }

  // ── Show all results ──
  log('4/6 Expanding pagination...');
  try {
    const expanded = await page.evaluate(() => {
      // Try "Alle" option in select
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const opts = Array.from(sel.options);
        const alleOpt = opts.find(o => o.text.toLowerCase().includes('alle') || o.value === '-1' || o.value === 'all');
        if (alleOpt) {
          sel.value = alleOpt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return `Selected: ${alleOpt.text}`;
        }
        // Or the highest number
        const highest = opts.reduce((max, o) => {
          const v = parseInt(o.value);
          return (!isNaN(v) && v > max) ? v : max;
        }, 0);
        if (highest >= 50) {
          sel.value = String(highest);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return `Selected: ${highest}`;
        }
      }
      return null;
    });
    if (expanded) {
      log(`Pagination: ${expanded}`);
      await page.waitForTimeout(3000);
    }
  } catch (e) { log('No pagination: ' + e.message); }

  // ── Scrape table ──
  log('5/6 Scraping stock data...');
  
  const stockData = await page.evaluate(() => {
    // Headers
    const headers = [];
    document.querySelectorAll('table thead th, table tr:first-child th').forEach(th => {
      const text = th.textContent.trim();
      if (text) headers.push(text);
    });
    
    // Rows
    const items = [];
    document.querySelectorAll('table tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return;
      
      const item = {};
      cells.forEach((cell, i) => {
        const key = headers[i] || `col_${i}`;
        item[key] = cell.textContent.trim();
      });
      
      // Also keep raw cells for debugging
      item._raw = Array.from(cells).map(c => c.textContent.trim());
      
      if (Object.values(item).some(v => v && v !== '')) {
        items.push(item);
      }
    });
    
    return { headers, items, totalRows: items.length };
  });
  
  await shot('06-scraped', `${stockData.totalRows} rows scraped`);
  
  log(`Headers: ${JSON.stringify(stockData.headers)}`);
  log(`Total rows: ${stockData.totalRows}`);
  
  if (stockData.items.length > 0) {
    log('First 3 rows:');
    stockData.items.slice(0, 3).forEach((item, i) => {
      log(`  ${i+1}. ${JSON.stringify(item._raw)}`);
    });
  } else {
    log('WARNING: 0 rows scraped!');
    // Dump page HTML for debugging
    const html = await page.evaluate(() => document.body.innerHTML.substring(0, 5000));
    log('HTML preview: ' + html.substring(0, 2000));
  }

  // Remove _raw from output to save space
  stockData.items.forEach(item => delete item._raw);

  return {
    success: true,
    scraped_at: new Date().toISOString(),
    source: 'corax',
    page_url: page.url(),
    headers: stockData.headers,
    items: stockData.items,
    total_rows: stockData.totalRows
  };
};
