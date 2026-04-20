/**
 * mintsoft-product-export.js v3.0
 * 
 * Exports product + inventory data from Mintsoft (WePrepFBA UK).
 * Key fix: aggressive debug logging, URL tracking, proper error handling.
 */

module.exports = async ({ page, context, supabase, dbShot }) => {
  const MINTSOFT_URL = 'https://om.mintsoft.co.uk';
  const fs = require('fs');
  
  const log = (msg) => console.log(`[Mintsoft] ${msg}`);
  const shot = async (step, msg) => {
    try {
      const url = page.url();
      log(`📸 ${step}: ${msg} [URL: ${url}]`);
      if (dbShot) await dbShot(page, step, `${msg} | URL: ${url}`);
    } catch (e) {
      log(`dbShot failed at ${step}: ${e.message}`);
    }
  };

  log('=== Mintsoft Product Export v3.0 ===');
  
  // ── Load saved cookies ──
  const storageStatePath = './mintsoft-storage-state.json';
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

  // ── Navigate to Product page ──
  log('1/5 Opening Mintsoft Product Overview...');
  try {
    await page.goto(`${MINTSOFT_URL}/Product`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    log('Navigation failed, trying without waitUntil: ' + e.message);
    await page.goto(`${MINTSOFT_URL}/Product`, { timeout: 30000 });
  }
  await page.waitForTimeout(5000);
  
  await shot('01-initial', 'Initial page');

  // ── Check login ──
  const currentUrl = page.url();
  log(`Current URL: ${currentUrl}`);
  
  if (currentUrl.includes('LogOn') || currentUrl.includes('login') || currentUrl.includes('Login') || currentUrl.includes('Account/LogOn')) {
    log('Session expired — logging in...');
    
    let username, password;
    if (supabase) {
      try {
        const { data } = await supabase.from('Browser_Credentials').select('*').eq('key', 'mintsoft').single();
        if (data) { username = data.username; password = data.password; }
        log(`Credentials loaded: ${username ? 'yes' : 'no'}`);
      } catch (e) { log('Credentials lookup failed: ' + e.message); }
    }
    
    if (!username || !password) {
      return { error: 'Session expired and no credentials available' };
    }
    
    try {
      // Dump all input fields
      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input, select, button[type="submit"]')).map(i => ({
          tag: i.tagName, type: i.type, name: i.name, id: i.id, 
          placeholder: i.placeholder, value: i.value
        }));
      });
      log('Form fields: ' + JSON.stringify(inputs));
      
      // Fill username — try multiple selectors
      const userSelectors = ['#UserName', 'input[name="UserName"]', 'input[type="email"]', 'input[type="text"]'];
      for (const sel of userSelectors) {
        const field = await page.$(sel);
        if (field) {
          await field.fill(username);
          log(`Username filled with: ${sel}`);
          break;
        }
      }
      
      // Fill password
      const passSelectors = ['#Password', 'input[name="Password"]', 'input[type="password"]'];
      for (const sel of passSelectors) {
        const field = await page.$(sel);
        if (field) {
          await field.fill(password);
          log(`Password filled with: ${sel}`);
          break;
        }
      }
      
      await shot('02-login-filled', 'Credentials filled');
      
      // Click login
      const loginSelectors = ['input[type="submit"]', 'button[type="submit"]', '.btn-primary', '#loginButton', 'button:has-text("Log")'];
      for (const sel of loginSelectors) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          log(`Login clicked: ${sel}`);
          break;
        }
      }
      
      await page.waitForTimeout(6000);
      await shot('03-after-login', 'After login');
      
      // Save cookies
      const cookies = await context.cookies();
      fs.writeFileSync(storageStatePath, JSON.stringify({ cookies }));
      
      // Navigate to product page after login
      log('Navigating to Product page after login...');
      await page.goto(`${MINTSOFT_URL}/Product`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      
    } catch (loginErr) {
      await shot('login-error', 'Login failed: ' + loginErr.message);
      return { error: 'Login failed: ' + loginErr.message };
    }
  }
  
  log('On product page!');
  await shot('04-product-page', 'Product page loaded');

  // ── Cookie popup ──
  try {
    const cookieBtn = await page.$('button:has-text("Accept"), a:has-text("Accept")');
    if (cookieBtn) { await cookieBtn.click(); log('Cookie popup dismissed'); }
  } catch (e) { /* no popup */ }

  // ── Dump page content ──
  log('2/5 Analyzing page...');
  const pageInfo = await page.evaluate(() => {
    const text = document.body.innerText.substring(0, 2000);
    const tables = document.querySelectorAll('table');
    const selects = document.querySelectorAll('select');
    return {
      bodyPreview: text,
      tableCount: tables.length,
      selectCount: selects.length,
      title: document.title
    };
  });
  log(`Page title: ${pageInfo.title}`);
  log(`Tables: ${pageInfo.tableCount}, Selects: ${pageInfo.selectCount}`);
  log(`Body preview: ${pageInfo.bodyPreview.substring(0, 500)}`);

  // ── Expand page size ──
  log('3/5 Expanding page size...');
  try {
    const expanded = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const opts = Array.from(sel.options);
        const hasPageSize = opts.some(o => ['10', '25', '50', '100'].includes(o.value));
        if (hasPageSize) {
          const highest = opts.reduce((max, o) => {
            const v = parseInt(o.value);
            return (!isNaN(v) && v > max) ? v : max;
          }, 0);
          if (highest > 0) {
            sel.value = String(highest);
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return `Set to ${highest}`;
          }
        }
      }
      return null;
    });
    if (expanded) {
      log(`Page size: ${expanded}`);
      await page.waitForTimeout(4000);
    }
  } catch (e) { log('No page size control: ' + e.message); }

  // ── Get total records ──
  const bodyText = await page.textContent('body');
  const match = bodyText.match(/(?:Displaying|Showing)\s+(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d+)/i);
  const totalRecords = match ? parseInt(match[3]) : 0;
  log(`Total records: ${totalRecords}`);

  // ── Get headers ──
  log('4/5 Reading data...');
  const headers = await page.evaluate(() => {
    const ths = document.querySelectorAll('table thead th');
    return Array.from(ths).map(th => th.innerText.trim()).filter(h => h);
  });
  log('Headers: ' + headers.join(' | '));

  if (headers.length === 0) {
    log('WARNING: No table headers found!');
    const htmlSnippet = await page.evaluate(() => document.body.innerHTML.substring(0, 5000));
    log('HTML preview: ' + htmlSnippet.substring(0, 1000));
    return {
      error: 'No table headers found',
      page_url: page.url(),
      body_preview: pageInfo.bodyPreview.substring(0, 2000)
    };
  }

  // ── Paginate and collect ──
  let allRows = [];
  let pageNum = 1;
  const maxPages = 20;
  
  while (pageNum <= maxPages) {
    log(`Page ${pageNum}...`);
    
    const rows = await page.evaluate((hdrs) => {
      const data = [];
      document.querySelectorAll('table tbody tr').forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 2) return;
        const row = {};
        cells.forEach((cell, i) => {
          const key = hdrs[i] || `col_${i}`;
          row[key] = cell.innerText.trim();
        });
        if (Object.values(row).some(v => v !== '')) data.push(row);
      });
      return data;
    }, headers);
    
    allRows = allRows.concat(rows);
    log(`${rows.length} rows on page ${pageNum} (total: ${allRows.length})`);
    
    if (rows.length === 0 || (totalRecords > 0 && allRows.length >= totalRecords)) break;
    
    // Next page
    pageNum++;
    const clicked = await page.evaluate((np) => {
      // Try pagination links
      const links = document.querySelectorAll('.pagination a, .pager a, a[data-page]');
      for (const a of links) {
        if (a.textContent.trim() === String(np) || a.getAttribute('data-page') === String(np)) {
          a.click();
          return true;
        }
      }
      // Try "Next" button
      const nextBtns = document.querySelectorAll('a:has-text("Next"), a:has-text("»"), .pagination .next a');
      for (const btn of nextBtns) {
        btn.click();
        return true;
      }
      return false;
    }, pageNum);
    
    if (!clicked) {
      log(`No page ${pageNum} button found — stopping`);
      break;
    }
    
    await page.waitForTimeout(3000);
  }
  
  await shot('05-scraped', `${allRows.length} products scraped across ${pageNum} pages`);

  log(`\n=== TOTAL: ${allRows.length} products ===`);
  allRows.forEach((row, i) => {
    const sku = row['SKU'] || row['Sku'] || '';
    const name = row['Name'] || row['Product Name'] || '';
    const inv = row['Inventory'] || row['Stock'] || row['Qty'] || '';
    log(`  ${i+1}. ${sku} — ${name} — Inv: ${inv}`);
  });

  return {
    success: true,
    scraped_at: new Date().toISOString(),
    source: 'mintsoft',
    page_url: page.url(),
    headers,
    items: allRows,
    total_rows: allRows.length
  };
};
