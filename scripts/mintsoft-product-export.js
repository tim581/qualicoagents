/**
 * mintsoft-product-export.js v2.1
 * 
 * Exports product + inventory data from Mintsoft (WePrepFBA UK).
 * module.exports pattern — receives { page, context, supabase, dbShot } from executor.
 */

module.exports = async ({ page, context, supabase, dbShot }) => {
  const MINTSOFT_URL = 'https://om.mintsoft.co.uk';
  const fs = require('fs');
  
  // ── Load saved cookies ──
  const storageStatePath = './mintsoft-storage-state.json';
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

  // ── Navigate to Product page ──
  console.log('1/4 Opening Mintsoft Product Overview...');
  await page.goto(`${MINTSOFT_URL}/Product`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  
  if (dbShot) await dbShot(page, 'after-navigate', 'Mintsoft: initial page');
  
  // ── Check login ──
  const url = page.url();
  if (url.includes('LogOn') || url.includes('login') || url.includes('Login')) {
    console.log('Session expired — attempting auto-login...');
    
    let username, password;
    if (supabase) {
      try {
        const { data } = await supabase.from('Browser_Credentials').select('*').eq('key', 'mintsoft_login').single();
        if (data) { username = data.username; password = data.password; }
      } catch (e) { console.log('Credentials lookup failed:', e.message); }
    }
    
    if (!username || !password) {
      return { error: 'Session expired and no credentials available. Run mintsoft-save-cookies.js first.' };
    }
    
    try {
      await page.waitForSelector('input[type="text"], input[type="email"], #UserName, input[name="UserName"]', { timeout: 10000 });
      
      const userField = await page.$('#UserName, input[name="UserName"], input[type="email"], input[type="text"]');
      if (userField) { await userField.fill(username); }
      
      const passField = await page.$('#Password, input[name="Password"], input[type="password"]');
      if (passField) { await passField.fill(password); }
      
      if (dbShot) await dbShot(page, 'login-filled', 'Mintsoft: credentials filled');
      
      const loginBtn = await page.$('button[type="submit"], input[type="submit"], .btn-primary, #loginButton');
      if (loginBtn) {
        await loginBtn.click();
        await page.waitForTimeout(5000);
      }
      
      if (dbShot) await dbShot(page, 'after-login', 'Mintsoft: after login');
      
      // Save cookies
      const cookies = await context.cookies();
      fs.writeFileSync(storageStatePath, JSON.stringify({ cookies }));
      console.log('Saved cookies for next run');
      
      // Navigate to product page
      await page.goto(`${MINTSOFT_URL}/Product`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
    } catch (loginErr) {
      if (dbShot) await dbShot(page, 'login-error', `Login failed: ${loginErr.message}`);
      return { error: `Login failed: ${loginErr.message}` };
    }
  }
  
  console.log('   Logged in!');
  if (dbShot) await dbShot(page, 'product-page', 'Mintsoft: product page loaded');

  // ── Handle cookie popup ──
  try {
    const acceptBtn = await page.$('text=Accept all, button:has-text("Accept")');
    if (acceptBtn) { await acceptBtn.click({ timeout: 2000 }); console.log('   Cookie popup accepted'); }
  } catch (e) { /* no popup */ }

  // ── Try to show more records ──
  console.log('2/4 Expanding page size...');
  try {
    const changed = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const opts = Array.from(sel.options);
        if (opts.some(o => o.value === '10' || o.value === '25')) {
          // Find highest option
          const highest = opts.reduce((max, o) => {
            const v = parseInt(o.value);
            return v > max ? v : max;
          }, 0);
          for (const o of opts) {
            if (parseInt(o.value) === highest) {
              sel.value = o.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return `Set page size to ${o.value}`;
            }
          }
        }
      }
      return null;
    });
    if (changed) {
      console.log(`   ${changed}`);
      await page.waitForTimeout(3000);
    }
  } catch (e) { console.log('   No page size control found'); }

  // ── Check total records ──
  const bodyText = await page.textContent('body');
  const match = bodyText.match(/Displaying (\d+) - (\d+) of (\d+)/i);
  const totalRecords = match ? parseInt(match[3]) : 0;
  console.log(`   Total records: ${totalRecords}`);

  // ── Get headers ──
  console.log('3/4 Reading data...');
  const headers = await page.evaluate(() => {
    const ths = document.querySelectorAll('table thead th');
    return Array.from(ths).map(th => th.innerText.trim());
  });
  console.log('   Headers:', headers.join(' | '));

  // ── Paginate and collect all rows ──
  let allRows = [];
  let pageNum = 1;
  
  while (true) {
    console.log(`   Page ${pageNum}...`);
    
    const rows = await page.evaluate((hdrs) => {
      const data = [];
      const trs = document.querySelectorAll('table tbody tr');
      trs.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        const row = {};
        cells.forEach((cell, i) => {
          const key = hdrs[i] || `col_${i}`;
          row[key] = cell.innerText.trim();
        });
        if (Object.keys(row).length > 0 && Object.values(row).some(v => v !== '')) data.push(row);
      });
      return data;
    }, headers);
    
    allRows = allRows.concat(rows);
    console.log(`   ${rows.length} rows (total: ${allRows.length})`);
    
    if (allRows.length >= totalRecords || totalRecords === 0) break;
    
    // Navigate to next page
    pageNum++;
    const clicked = await page.evaluate((nextPage) => {
      const links = document.querySelectorAll('a');
      for (const a of links) {
        if (a.textContent.trim() === String(nextPage)) {
          const parent = a.closest('ul, nav, .pagination, .paging, li');
          if (parent) { a.click(); return true; }
        }
      }
      return false;
    }, pageNum);
    
    if (!clicked) {
      console.log(`   Could not find page ${pageNum} — stopping`);
      break;
    }
    
    await page.waitForTimeout(3000);
  }
  
  if (dbShot) await dbShot(page, 'scraped', `Mintsoft: ${allRows.length} products scraped`);

  console.log(`\n4/4 TOTAL: ${allRows.length} products`);
  allRows.forEach((row, i) => {
    const sku = row['SKU'] || '';
    const name = row['Name'] || '';
    const inv = row['Inventory'] || '';
    console.log(`  ${i+1}. ${sku} — ${name} — ${inv}`);
  });

  return {
    success: true,
    scraped_at: new Date().toISOString(),
    source: 'mintsoft',
    headers,
    items: allRows,
    total_rows: allRows.length
  };
};
