// Sellerboard P&L Export v11 — 2026 monthly P&L per market
// Scrapes main P&L table → filters 2026 month columns → upserts monthly_pl to Supabase
// v11: account verify per market, UI market select (BE), zero-export guard
// Skips per-ASIN. June (and current month) may be partial.

const fs = require('fs');
const path = require('path');

// CRITICAL: Load .env from repo root so SUPABASE_KEY works from any cwd
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) { /* dotenv not installed — use hardcoded fallback */ }

const { chromium } = require('playwright');

// --- CONFIG ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const STORAGE_STATE = path.join(__dirname, 'sellerboard-storage-state.json');
const RUN_ID = `sb-${Date.now()}`;
const SELLERBOARD_LOGIN_KEY = 'sellerboard_login';

// Verify key is loaded
if (SUPABASE_KEY) {
  console.log(`🔑 Supabase key geladen (${SUPABASE_KEY.substring(0, 20)}...)`);
} else {
  console.log(`⚠️ Geen Supabase key — debug logging uitgeschakeld`);
}

// Market config
const MARKET_CONFIG = {
  'Amazon.de':     { account: 'eu', urlParam: 'Amazon.de', currency: 'EUR', symbol: '€' },
  'Amazon.co.uk':  { account: 'eu', urlParam: 'Amazon.co.uk', currency: 'GBP', symbol: '£' },
  'Amazon.fr':     { account: 'eu', urlParam: 'Amazon.fr', currency: 'EUR', symbol: '€' },
  'Amazon.it':     { account: 'eu', urlParam: 'Amazon.it', currency: 'EUR', symbol: '€' },
  'Amazon.es':     { account: 'eu', urlParam: 'Amazon.es', currency: 'EUR', symbol: '€' },
  'Amazon.nl':     { account: 'eu', urlParam: 'Amazon.nl', currency: 'EUR', symbol: '€' },
  'Amazon.be': {
    account: 'eu',
    urlParam: 'Amazon.com.be',
    currency: 'EUR',
    symbol: '€',
    uiLabels: ['Amazon.com.be', 'Belgium', 'BE'],
    needsUiMarketSelect: true,
  },
  'Amazon.com':    { account: 'us', urlParam: 'Amazon.com', currency: 'USD', symbol: '$' },
  'Amazon.ca':     { account: 'us', urlParam: 'Amazon.ca', currency: 'CAD', symbol: '$' }
};

const EU_MARKETS = ['Amazon.de', 'Amazon.co.uk', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl'];
const US_MARKETS = ['Amazon.com', 'Amazon.ca'];
const ALL_MARKETS = [...EU_MARKETS, 'Amazon.be', ...US_MARKETS];

const SCOPE_ALIASES = {
  eu: 'eu',
  na: 'us',
  us: 'us',
  usa: 'us',
  all: 'all',
  be: 'Amazon.be',
  bae: 'Amazon.be',
  'amazon.be': 'Amazon.be',
  'amazon.com.be': 'Amazon.be',
};

const MARKET_ALIASES = {
  'Amazon.com.be': 'Amazon.be',
};

function normalizeMarketKey(market) {
  return MARKET_ALIASES[market] || market;
}

function collectScopeTokens(raw) {
  const tokens = [];
  if (raw == null) return tokens;
  if (Array.isArray(raw)) {
    for (const item of raw) tokens.push(...collectScopeTokens(item));
    return tokens;
  }
  if (typeof raw === 'object') {
    if (Array.isArray(raw.markets)) tokens.push(...raw.markets);
    if (raw.scope) tokens.push(raw.scope);
    if (raw.region) tokens.push(raw.region);
    if (raw.market_scope) tokens.push(raw.market_scope);
    return tokens;
  }
  if (typeof raw === 'string' && raw.trim()) tokens.push(raw.trim());
  return tokens;
}

function resolveMarketsToScrape(inputScopes) {
  const scopes = collectScopeTokens(inputScopes).map((s) => String(s).trim()).filter(Boolean);
  if (scopes.length === 0) return ALL_MARKETS;

  const explicitMarkets = scopes
    .map((s) => normalizeMarketKey(s))
    .filter((s) => MARKET_CONFIG[s]);
  if (explicitMarkets.length === scopes.length) return explicitMarkets;

  const selected = new Set();
  for (const raw of scopes) {
    const normalized = normalizeMarketKey(SCOPE_ALIASES[String(raw).toLowerCase()] || raw);
    if (normalized === 'eu') EU_MARKETS.forEach((m) => selected.add(m));
    else if (normalized === 'us') US_MARKETS.forEach((m) => selected.add(m));
    else if (normalized === 'all') ALL_MARKETS.forEach((m) => selected.add(m));
    else if (MARKET_CONFIG[normalized]) selected.add(normalized);
    else {
      console.log(`⚠️ Onbekende scope/markt overgeslagen: ${raw}`);
    }
  }

  if (selected.size === 0) return ALL_MARKETS;
  return ALL_MARKETS.filter((m) => selected.has(m));
}

const EXPORT_YEAR = 2026;
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// --- HELPERS ---
function buildUrl(market) {
  const now = new Date();
  const start = new Date(EXPORT_YEAR, 0, 1);
  const endYear = now.getFullYear() >= EXPORT_YEAR ? now.getFullYear() : EXPORT_YEAR;
  const endMonth = now.getFullYear() === EXPORT_YEAR ? now.getMonth() + 1 : 12;
  const end = new Date(endYear, endMonth, 1);

  const params = new URLSearchParams();
  params.set('viewType', 'table');
  params.set('tablePeriod[start]', Math.floor(start.getTime() / 1000).toString());
  params.set('tablePeriod[end]', Math.floor(end.getTime() / 1000).toString());
  params.set('tablePeriod[forecast]', 'false');
  params.set('tableSorting[field]', 'margin');
  params.set('tableSorting[direction]', 'desc');
  params.set('market[]', market);

  return `https://app.sellerboard.com/en/dashboard/?${params.toString()}`;
}

async function isOnLoginPage(page) {
  const url = page.url();
  if (isLoginUrl(url)) return true;
  return (await page.locator('input#username, input[name="login"]').count()) > 0;
}

async function freshNavigate(page, url, label, config = null) {
  console.log(`      🌐 Navigate: ${url.substring(0, 90)}...`);
  await page.goto('about:blank');
  await page.waitForTimeout(500);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  if (await isOnLoginPage(page)) {
    await debugLog(page, `login-redirect-${label}`, '⚠️ Login redirect — recovering session before scrape');
    const ok = await ensureSellerboardSession(page);
    if (!ok) {
      await debugLog(page, label, `Pagina geladen: ${page.url().substring(0, 80)}...`);
      return false;
    }
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
  }

  let currentUrl = page.url();
  if (!currentUrl.includes('market') && !await isOnLoginPage(page)) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    currentUrl = page.url();
  }

  if (config?.needsUiMarketSelect || config?.uiLabels?.length) {
    await selectMarketInUi(page, config);
    await ensurePlView(page);
    await waitForMarketTable(page, config).catch(() => null);
  }

  await debugLog(page, label, `Pagina geladen: ${currentUrl.substring(0, 80)}...`);
  return !await isOnLoginPage(page);
}

function isLoginUrl(url) {
  const u = (url || '').toLowerCase();
  return u.includes('/login') || u.includes('/auth/login') || u.includes('/signin');
}

async function getBrowserCredentials(key) {
  if (!SUPABASE_KEY) return null;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.${encodeURIComponent(key)}&select=username,password`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) && data[0] ? data[0] : null;
  } catch {
    return null;
  }
}

async function ensureSellerboardSession(page) {
  await page.goto('https://app.sellerboard.com/en/dashboard/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  let url = page.url();
  const onLoginPage = isLoginUrl(url) || await page.locator('input#username, input[name="login"]').count() > 0;
  if (!onLoginPage) return true;

  await debugLog(page, 'session-expired', `⚠️ Session expired, attempting login fallback from ${SELLERBOARD_LOGIN_KEY}`);
  const creds = await getBrowserCredentials(SELLERBOARD_LOGIN_KEY);
  if (!creds?.username || !creds?.password) {
    await debugLog(page, 'login-creds-missing', '❌ Missing sellerboard_login credentials');
    return false;
  }

  // Sellerboard login is /en/auth/login/ with text username + password (not type=email)
  if (!page.url().includes('/auth/login')) {
    await page.goto('https://app.sellerboard.com/en/auth/login/', { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(4000);

  const userSelectors = ['input#username', 'input[name="login"]', 'input[type="email"]', 'input[name="email"]', 'input#email'];
  const passSelectors = ['input#password', 'input[name="password"]', 'input[type="password"]'];
  let userFilled = false;
  for (const sel of userSelectors) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: 12000 });
      await loc.fill(creds.username);
      userFilled = true;
      break;
    } catch {
      /* try next selector */
    }
  }
  let passFilled = false;
  for (const sel of passSelectors) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: 12000 });
      await loc.fill(creds.password);
      passFilled = true;
      break;
    } catch {
      /* try next selector */
    }
  }
  if (!userFilled || !passFilled) {
    await debugLog(page, 'login-form-missing', '❌ Login form not detected on Sellerboard');
    return false;
  }

  const submit = page.locator(
    'button[type="submit"], button:has-text("Continue"), button:has-text("Sign"), button:has-text("Log"), input[type="submit"]'
  ).first();
  if (await submit.count()) {
    await submit.click({ timeout: 5000 });
  } else {
    await page.keyboard.press('Enter');
  }

  await page.waitForTimeout(8000);
  url = page.url();
  if (isLoginUrl(url)) {
    await debugLog(page, 'login-failed', `❌ Sellerboard login fallback failed (url=${url})`);
    return false;
  }

  await page.context().storageState({ path: STORAGE_STATE });
  await debugLog(page, 'login-ok', '✅ Sellerboard login fallback succeeded; storage refreshed');
  return true;
}

function monthIndexFromName(name) {
  const n = (name || '').toLowerCase().trim();
  return MONTH_NAMES.findIndex(m => n === m || n.startsWith(`${m} `));
}

function monthKeyFromHeader(header) {
  const h = (header || '').trim();
  if (!h || /^parameter/i.test(h) || /^total$/i.test(h)) return null;

  const partial = h.match(/^(\d+-\d+)\s+(\w+)\s+(20\d{2})$/i);
  if (partial) {
    const idx = monthIndexFromName(partial[2]);
    if (idx < 0 || partial[3] !== String(EXPORT_YEAR)) return null;
    return { index: idx, key: `${MONTH_ABBR[idx]}_${EXPORT_YEAR}_partial`, partial: true };
  }

  if (h.includes(String(EXPORT_YEAR))) {
    const idx = monthIndexFromName(h.replace(/\d{4}/g, '').trim());
    if (idx >= 0) return { index: idx, key: `${MONTH_ABBR[idx]}_${EXPORT_YEAR}` };
    const abbr = MONTH_ABBR.find(a => h.toLowerCase().includes(a.toLowerCase()));
    if (abbr) return { index: MONTH_ABBR.indexOf(abbr), key: `${abbr}_${EXPORT_YEAR}` };
  }

  const idx = monthIndexFromName(h);
  if (idx >= 0) return { index: idx, key: `${MONTH_ABBR[idx]}_${EXPORT_YEAR}` };

  return null;
}

function extractMonthly2026(headers, rows) {
  const keep = [{ col: 0, key: 'Parameter' }];
  let seenJanuary = false;

  for (let i = 1; i < headers.length; i++) {
    const h = (headers[i] || '').trim();
    if (/^total$/i.test(h)) break;

    const parsed = monthKeyFromHeader(h);
    if (!parsed) continue;

    if (/\d{4}/.test(h) && !h.includes(String(EXPORT_YEAR))) break;

    if (!h.includes(String(EXPORT_YEAR))) {
      if (seenJanuary && parsed.index === 11) break;
      if (parsed.index === 0) seenJanuary = true;
    }

    keep.push({ col: i, key: parsed.key });
  }

  const dataCols = keep.slice(1).sort((a, b) => {
    const order = k => {
      const m = k.match(/^(\w+)_/);
      const idx = MONTH_ABBR.indexOf(m?.[1] || '');
      return idx < 0 ? 99 : idx + (k.includes('_partial') ? 0.4 : 0);
    };
    return order(a.key) - order(b.key);
  });

  const newHeaders = ['Parameter', ...dataCols.map(c => c.key)];
  const newRows = rows.map(row => [
    row[0] ?? '',
    ...dataCols.map(c => row[c.col] ?? ''),
  ]);

  return { headers: newHeaders, rows: newRows, months: dataCols.map(c => c.key) };
}

function tableFingerprint(monthlyRows) {
  if (!Array.isArray(monthlyRows) || monthlyRows.length === 0) return '';
  const interesting = ['Sales', 'Net profit', 'Gross profit', 'Estimated payout', 'Units'];
  const picked = monthlyRows
    .filter(r => interesting.includes((r?.[0] || '').trim()))
    .map(r => r.join('|'))
    .join('||');
  return picked || monthlyRows.slice(0, 5).map(r => r.join('|')).join('||');
}

function detectCurrencySymbols(rows) {
  const symbols = new Set();
  for (const row of rows || []) {
    for (let i = 1; i < row.length; i++) {
      const cell = String(row[i] || '');
      if (cell.includes('€')) symbols.add('€');
      if (cell.includes('$')) symbols.add('$');
      if (cell.includes('£')) symbols.add('£');
    }
  }
  return Array.from(symbols);
}

function normalizeMonetaryCell(cell, expectedSymbol) {
  const raw = String(cell ?? '');
  if (!raw) return raw;
  if (/%$/.test(raw) || raw === '—') return raw;
  if (!/\d/.test(raw)) return raw;
  // Normalize a visible currency sign without changing the numeric amount.
  return raw
    .replace(/^-\s*[€$£]\s*/, `-${expectedSymbol} `)
    .replace(/^[€$£]\s*/, `${expectedSymbol} `);
}

function normalizeRowsCurrency(rows, expectedSymbol) {
  return (rows || []).map(row => [
    row[0] ?? '',
    ...row.slice(1).map(cell => normalizeMonetaryCell(cell, expectedSymbol)),
  ]);
}

function parseNumericCell(cell) {
  const raw = String(cell ?? '').replace(/[€$£,\s]/g, '').replace(/%$/, '');
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function isZeroExport(monthlyRows) {
  if (!Array.isArray(monthlyRows) || monthlyRows.length === 0) return true;
  const sales = monthlyRows.find(r => (r?.[0] || '').trim() === 'Sales');
  const units = monthlyRows.find(r => (r?.[0] || '').trim() === 'Units');
  if (!sales && !units) return false;
  const salesVals = sales ? sales.slice(1) : [];
  const unitVals = units ? units.slice(1) : [];
  const salesSum = salesVals.reduce((sum, cell) => sum + Math.abs(parseNumericCell(cell)), 0);
  const unitSum = unitVals.reduce((sum, cell) => sum + Math.abs(parseNumericCell(cell)), 0);
  return salesSum === 0 && unitSum === 0;
}

async function detectAccountOnPage(page) {
  try {
    const topText = await page.evaluate(() => {
      const bits = [];
      for (const el of document.querySelectorAll('header *, nav *, [class*="header"] *, [class*="account"] *')) {
        const t = (el.innerText || '').trim();
        if (t && t.length < 40) bits.push(t);
      }
      return bits.join('\n');
    });
    if (/AMZ USA/i.test(topText)) return 'us';
    if (/tim@qualico\.be/i.test(topText)) return 'eu';
  } catch {
    /* ignore */
  }
  return null;
}

async function ensureCorrectAccount(page, targetAccount, currentAccount) {
  const detected = await detectAccountOnPage(page);
  const effective = detected || currentAccount;
  if (effective === targetAccount) return { ok: true, account: targetAccount };
  console.log(`   🔄 Account mismatch (detected=${detected || 'unknown'}, need=${targetAccount}) — switching...`);
  const switched = await switchAccount(page, targetAccount);
  return { ok: switched, account: switched ? targetAccount : effective };
}

async function selectMarketInUi(page, config) {
  const labels = [config.urlParam, ...(config.uiLabels || [])];
  await debugLog(page, `market-ui-start-${config.urlParam}`, `🎯 UI market select: ${labels.join(', ')}`, false);

  // Open markets filter if collapsed.
  for (const opener of [/markets?/i, /marketplace/i, /filter/i]) {
    try {
      const btn = page.locator('button, a, [role="button"], label').filter({ hasText: opener }).first();
      if (await btn.count()) {
        await btn.click({ timeout: 2000 });
        await page.waitForTimeout(1500);
        break;
      }
    } catch {
      /* try next opener */
    }
  }

  const clicked = await page.evaluate((targets) => {
    const norm = (s) => (s || '').trim().toLowerCase();
    const wanted = targets.map(norm);
    const isMarketChip = (text) => wanted.some((t) => text === t || text === `amazon.${t.replace('amazon.', '')}`);

    // Prefer exact market chips in the marketplace filter row.
    const chipCandidates = Array.from(document.querySelectorAll('a, button, label, span, div, li'));
    for (const el of chipCandidates) {
      const text = norm(el.innerText || '');
      if (!text || text.length > 40) continue;
      if (!isMarketChip(text)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) continue;
      el.click();
      return { ok: true, label: text };
    }

    const nodes = document.querySelectorAll('label, li, span, div, a, button, input[type="checkbox"]');
    for (const el of nodes) {
      const text = norm(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '');
      const value = norm(el.getAttribute('value') || '');
      for (const target of wanted) {
        if ((text && text === target) || (value && value.includes(target))) {
          el.click();
          return { ok: true, label: text || value || target };
        }
      }
    }
    return { ok: false };
  }, labels);

  if (clicked?.ok) {
    console.log(`      ✅ UI market geklikt: ${clicked.label}`);
    await page.waitForTimeout(5000);
    await debugLog(page, `market-ui-done-${config.urlParam}`, `✅ UI market geselecteerd: ${clicked.label}`, true);
    return true;
  }

  await debugLog(page, `market-ui-miss-${config.urlParam}`, '⚠️ UI market selector niet gevonden — vertrouw op URL param', false);
  return false;
}

async function waitForMarketTable(page, config, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const probe = await page.evaluate((symbol) => {
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (rows.length < 5) continue;
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('th, td')).map(c => (c.innerText || '').trim());
          if (cells[0] !== 'Sales') continue;
          const values = cells.slice(1);
          const hasMoney = values.some(v => /[€$£]\s*-?\d/.test(v));
          const hasNonZero = values.some(v => {
            const n = parseFloat(v.replace(/[€$£,\s]/g, ''));
            return Number.isFinite(n) && Math.abs(n) > 0;
          });
          const hasExpectedSymbol = symbol === '$'
            ? values.some(v => v.includes('$'))
            : values.some(v => v.includes(symbol));
          return { hasMoney, hasNonZero, hasExpectedSymbol, preview: values.slice(0, 3) };
        }
      }
      return null;
    }, config.symbol);

    if (probe?.hasExpectedSymbol && probe.hasNonZero) return probe;
    if (probe?.hasMoney && config.needsUiMarketSelect) {
      // BE can be slow — keep polling a bit longer even if still zero.
    }
    await page.waitForTimeout(2000);
  }
  return null;
}

// Debug: screenshot to local + Supabase
async function debugLog(page, step, message, takeScreenshot = true) {
  console.log(`      ${message}`);
  
  let screenshotBase64 = null;
  if (takeScreenshot && page) {
    try {
      const dir = path.join(__dirname, 'debug-screenshots');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `sb-${step}-${Date.now()}.png`);
      const buffer = await page.screenshot({ path: file, fullPage: false });
      screenshotBase64 = buffer.toString('base64').substring(0, 50000); // cap at 50KB for Supabase
      console.log(`      📸 ${path.basename(file)}`);
    } catch (e) { console.log(`      ⚠️ Screenshot failed: ${e.message}`); }
  }
  
  // Write to Supabase debug log
  if (SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Debug_Log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
          run_id: RUN_ID,
          step,
          message,
          screenshot: screenshotBase64,
          created_at: new Date().toISOString()
        })
      });
    } catch (e) { /* fire and forget */ }
  }
}

async function switchAccount(page, targetAccount) {
  const targetName = targetAccount === 'us' ? 'AMZ USA' : 'Tim@qualico.be';
  await debugLog(page, 'account-switch-start', `🔄 Switchen naar ${targetAccount} (${targetName})...`);
  
  try {
    // Click avatar/account button in top navigation bar
    let clicked = false;
    
    for (const text of ['Tim@qualico.be', 'tim@qualico.be', 'AMZ USA', 'AMZ usa']) {
      try {
        const el = page.locator(`text="${text}"`).first();
        const box = await el.boundingBox({ timeout: 2000 });
        if (box && box.y < 80) {
          await el.click({ timeout: 3000 });
          clicked = true;
          console.log(`      ✅ Klikte op: ${text}`);
          break;
        }
      } catch (e) { /* try next */ }
    }
    
    // Fallback: top-right avatar position
    if (!clicked) {
      const vp = page.viewportSize();
      await page.mouse.click(vp.width - 60, 35);
      clicked = true;
      console.log(`      ✅ Klikte op avatar positie`);
    }
    
    await page.waitForTimeout(2000);
    await debugLog(page, 'account-dropdown-open', '📋 Account dropdown geopend');
    
    // Click target account
    let switched = false;
    try {
      await page.locator(`text="${targetName}"`).first().click({ timeout: 3000 });
      switched = true;
      console.log(`      ✅ Geswitcht naar: ${targetName}`);
    } catch (e) {
      const found = await page.evaluate((name) => {
        const items = document.querySelectorAll('li, div[role="menuitem"], a, button, span');
        for (const item of items) {
          if (item.innerText?.trim()?.includes(name)) {
            item.click();
            return true;
          }
        }
        return false;
      }, targetName);
      if (found) {
        switched = true;
        console.log(`      ✅ Geswitcht via evaluate: ${targetName}`);
      }
    }
    
    if (!switched) {
      await debugLog(page, 'account-switch-failed', `❌ Account "${targetName}" niet gevonden`);
      return false;
    }
    
    // Wait for account switch to complete (page redirects + session update)
    await page.waitForTimeout(8000);
    
    // Log the current URL to verify we're on the right account
    const currentUrl = page.url();
    await debugLog(page, 'account-switch-done', `✅ Account switch compleet. URL: ${currentUrl}`);
    return true;
    
  } catch (err) {
    await debugLog(page, 'account-switch-error', `❌ Error: ${err.message}`);
    return false;
  }
}

// Enhanced table detection: supports both <table> and div-based grids
async function findTableData(page) {
  return await page.evaluate(() => {
    // Strategy 1: Regular <table> elements
    const tables = document.querySelectorAll('table');
    let bestTable = null;
    let bestRows = 0;
    
    tables.forEach(t => {
      const rows = t.querySelectorAll('tr');
      if (rows.length > bestRows) {
        bestRows = rows.length;
        bestTable = t;
      }
    });
    
    if (bestTable && bestRows > 5) {
      const rows = bestTable.querySelectorAll('tr');
      const result = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        const rowData = [];
        for (const cell of cells) {
          rowData.push(cell.innerText?.split('\n')[0]?.trim() || '');
        }
        if (rowData.some(c => c)) result.push(rowData);
      }
      return { source: 'table', tableCount: tables.length, data: result };
    }
    
    // Strategy 2: Look for div-based grids (modern React dashboards)
    // Find containers with many rows of similarly-structured divs
    const gridContainers = document.querySelectorAll('[class*="table"], [class*="grid"], [class*="row"], [role="table"], [role="grid"]');
    
    return { source: 'none', tableCount: tables.length, gridCount: gridContainers.length, bestRows, data: null };
  });
}

async function scrapeMainPlTable(page) {
  // Try expanding fee rows
  try {
    await page.evaluate(() => {
      const expandables = document.querySelectorAll('[class*="expand"], [class*="collapse"], [class*="toggle"], tr[class*="parent"]');
      expandables.forEach(el => {
        const text = el.innerText?.toLowerCase() || '';
        if (text.includes('fee') || text.includes('amazon') || text.includes('advertising')) {
          el.click();
        }
      });
    });
    await page.waitForTimeout(1000);
  } catch (e) { /* ignore */ }
  
  const result = await findTableData(page);
  
  if (!result.data || result.data.length === 0) {
    console.log(`      ℹ️ Table info: ${result.tableCount} tables, ${result.gridCount || 0} grids, best: ${result.bestRows || 0} rows`);
    return null;
  }
  
  return { headers: result.data[0], rows: result.data.slice(1) };
}

async function ensurePlView(page) {
  try {
    const plTab = page.locator('a, button, [role="tab"]').filter({ hasText: /^P&L$/ }).first();
    if (await plTab.count()) {
      await plTab.click({ timeout: 3000 });
      await page.waitForTimeout(3000);
    }
  } catch {
    /* already on P&L or tab not found */
  }
}

async function scrapeTable(page, viewType, market) {
  await ensurePlView(page);

  // Enhanced retry with debug logging (attached tables — Sellerboard hides many <table> nodes)
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (await isOnLoginPage(page)) {
      console.log(`      ⚠️ Login pagina gedetecteerd (poging ${attempt}/6)`);
      return null;
    }
    console.log(`      ⏳ Wacht op data (poging ${attempt}/6)...`);
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('table').length > 0,
        { timeout: 10000 }
      );
      break;
    } catch (e) {
      if (attempt === 3) await ensurePlView(page);
      if (attempt === 6) {
        // Take debug screenshot before giving up
        await debugLog(page, `no-table-${viewType}-${market}`, `❌ Geen <table> na 6 pogingen. URL: ${page.url()}`);
        
        // Log what IS on the page
        const pageInfo = await page.evaluate(() => ({
          title: document.title,
          url: window.location.href,
          tableCount: document.querySelectorAll('table').length,
          bodyText: document.body?.innerText?.substring(0, 500) || 'empty'
        }));
        console.log(`      ℹ️ Page: ${pageInfo.title}, Tables: ${pageInfo.tableCount}`);
        console.log(`      ℹ️ URL: ${pageInfo.url}`);
        console.log(`      ℹ️ Body preview: ${pageInfo.bodyText.substring(0, 200)}...`);
        
        return null;
      }
      await page.waitForTimeout(5000);
    }
  }
  
  await page.waitForTimeout(3000);
  await debugLog(page, `table-found-${viewType}-${market}`, `✅ Table gevonden voor ${viewType} ${market}`, true);
  
  return await scrapeMainPlTable(page);
}

async function scrapeTableWithRecovery(page, viewType, market) {
  const first = await scrapeTable(page, viewType, market);
  if (first) return first;

  await debugLog(page, `recover-${viewType}-${market}`, '♻️ Retrying market once after session refresh');
  const ok = await ensureSellerboardSession(page);
  if (!ok) return null;
  const config = MARKET_CONFIG[market];
  const navigated = await freshNavigate(
    page,
    buildUrl(config?.urlParam || market),
    `retry-${viewType}-${market}`,
    config,
  );
  if (!navigated) return null;
  return scrapeTable(page, viewType, market);
}

async function saveToSupabase(market, viewType, headers, rows) {
  if (!SUPABASE_KEY) {
    console.log(`      ⚠️ Skip Supabase save (geen key)`);
    return { ok: true, mode: 'skip', row_count: rows.length };
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };

  const payload = {
    headers: JSON.stringify(headers),
    rows: JSON.stringify(rows),
    row_count: rows.length,
    exported_at: new Date().toISOString(),
  };

  const filter = `market=eq.${encodeURIComponent(market)}&view_type=eq.${encodeURIComponent(viewType)}`;

  try {
    const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Exports?${filter}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    if (patchResp.ok) {
      const updated = await patchResp.json();
      if (Array.isArray(updated) && updated.length > 0) {
        console.log(`      ✅ Supabase updated: ${market} / ${viewType} (${rows.length} rijen)`);
        return { ok: true, mode: 'update', row_count: rows.length };
      }
    }

    const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Exports`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ market, view_type: viewType, ...payload }),
    });

    if (insertResp.ok) {
      console.log(`      ✅ Supabase inserted: ${market} / ${viewType} (${rows.length} rijen)`);
      return { ok: true, mode: 'insert', row_count: rows.length };
    }

    const body = await insertResp.text();
    console.log(`      ❌ Supabase error: ${insertResp.status} ${body.substring(0, 200)}`);
    return { ok: false, error: `Supabase ${insertResp.status}: ${body.substring(0, 200)}` };
  } catch (e) {
    console.log(`      ❌ Supabase fetch error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

function saveCsv(market, viewType, headers, rows) {
  const dir = path.join(__dirname, 'csv-downloads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const safeName = market.replace('Amazon.', '').replace('.', '_').toLowerCase();
  const file = path.join(dir, `sellerboard-${safeName}-${viewType}.csv`);
  
  const escape = (v) => `"${(v || '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  fs.writeFileSync(file, csv, 'utf8');
  console.log(`      ✅ CSV: ${path.basename(file)}`);
}

// --- MAIN ---
async function main() {
  const envScope = process.env.MARKET_SCOPE ? [process.env.MARKET_SCOPE] : [];
  let actionScopes = [];
  try {
    actionScopes = JSON.parse(process.env.TASK_ACTIONS || '[]').filter(a => typeof a === 'string');
  } catch {
    actionScopes = [];
  }
  const args = process.argv.slice(2);
  const inputScopes = args.length ? args : (actionScopes.length ? actionScopes : envScope);
  const marketsToScrape = resolveMarketsToScrape(inputScopes);

  if (marketsToScrape.length === 0) {
    console.log(`❌ Geen markten om te exporteren (input: ${JSON.stringify(inputScopes)})`);
    console.log(`Beschikbaar: ${ALL_MARKETS.join(', ')}`);
    process.exit(1);
  }
  
  console.log(`📊 Sellerboard P&L Export v11 — ${EXPORT_YEAR} monthly`);
  console.log(`   Markten: ${marketsToScrape.join(', ')}`);
  console.log(`   View: monthly_pl (per-ASIN overgeslagen)`);
  console.log(`   Run ID: ${RUN_ID}`);
  console.log(`   Debug: ${SUPABASE_KEY ? 'Supabase logging AAN' : 'GEEN logging (geen key)'}`);
  console.log('');
  
  if (!fs.existsSync(STORAGE_STATE)) {
    console.log(`❌ Geen cookies: ${STORAGE_STATE}`);
    console.log('   Run eerst: node sellerboard-save-cookies.js');
    process.exit(1);
  }
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  page.setDefaultTimeout(20000); // increased from 15s
  
  let currentAccount = 'eu'; // Default after cookie load
  const summary = {};
  const details = {};
  let totalRowsExported = 0;
  let hardFailures = 0;
  let previousMarket = null;
  let previousFingerprint = '';
  
  try {
    const sessionOk = await ensureSellerboardSession(page);
    if (!sessionOk) {
      throw new Error('Sellerboard authentication failed (cookies invalid and fallback login failed)');
    }

    for (let i = 0; i < marketsToScrape.length; i++) {
      const market = marketsToScrape[i];
      const config = MARKET_CONFIG[market];
      
      console.log(`\n📍 [${i + 1}/${marketsToScrape.length}] ${market}`);
      console.log('============================================================');
      
      // Step 1: Ensure correct Sellerboard account (detect from UI, not just tracker)
      const accountResult = await ensureCorrectAccount(page, config.account, currentAccount);
      if (!accountResult.ok) {
        console.log(`   ⚠️ Account switch gefaald — skip ${market}`);
        summary[market] = '❌ Account switch';
        details[market] = { ok: false, reason: 'account_switch_failed' };
        hardFailures++;
        continue;
      }
      currentAccount = accountResult.account;

      console.log(`\n   📋 ${EXPORT_YEAR} Monthly P&L...`);
      const mainUrl = buildUrl(config.urlParam);
      const navigated = await freshNavigate(page, mainUrl, `monthly-pl-${market}`, config);
      if (!navigated) {
        summary[market] = '❌ Login redirect';
        details[market] = { ok: false, reason: 'login_redirect_unresolved' };
        hardFailures++;
        continue;
      }

      const mainData = await scrapeTableWithRecovery(page, 'main_pl', market);
      if (!mainData) {
        summary[market] = '❌ Geen data';
        details[market] = { ok: false, reason: 'no_table_data' };
        hardFailures++;
        continue;
      }

      const monthly = extractMonthly2026(mainData.headers, mainData.rows);
      if (!monthly.rows.length || !monthly.months.length) {
        console.log(`      ❌ Lege export gedetecteerd (${monthly.rows.length} rijen, ${monthly.months.length} maanden)`);
        summary[market] = '❌ Lege export';
        details[market] = {
          ok: false,
          reason: 'empty_export',
          row_count: monthly.rows.length,
          month_count: monthly.months.length
        };
        hardFailures++;
        continue;
      }
      const beforeSymbols = detectCurrencySymbols(monthly.rows);
      monthly.rows = normalizeRowsCurrency(monthly.rows, config.symbol);
      const afterSymbols = detectCurrencySymbols(monthly.rows);

      if (isZeroExport(monthly.rows)) {
        console.log(`      ❌ Zero-export gedetecteerd — geen echte omzet/units voor ${market}`);
        await debugLog(page, `zero-export-${market}`, `❌ Zero export voor ${market} (symbols ${beforeSymbols.join(',') || 'none'})`, true);
        await selectMarketInUi(page, config);
        await page.waitForTimeout(5000);
        const retryZeroData = await scrapeTableWithRecovery(page, 'main_pl', market);
        if (retryZeroData) {
          const retryZeroMonthly = extractMonthly2026(retryZeroData.headers, retryZeroData.rows);
          retryZeroMonthly.rows = normalizeRowsCurrency(retryZeroMonthly.rows, config.symbol);
          if (!isZeroExport(retryZeroMonthly.rows)) {
            monthly.headers = retryZeroMonthly.headers;
            monthly.rows = retryZeroMonthly.rows;
            console.log(`      ♻️ Zero-export retry succeeded for ${market}`);
          }
        }
      }

      if (isZeroExport(monthly.rows)) {
        summary[market] = '❌ Zero export';
        details[market] = { ok: false, reason: 'zero_export_detected', symbols: beforeSymbols };
        hardFailures++;
        continue;
      }

      const fingerprint = tableFingerprint(monthly.rows);
      if (previousMarket && previousFingerprint && previousFingerprint === fingerprint) {
        await debugLog(page, `dup-suspect-${market}`, `⚠️ Mogelijk hergebruikte tabelsnapshot (${previousMarket} -> ${market}), UI retry`);
        await selectMarketInUi(page, config);
        const dupNavigated = await freshNavigate(page, mainUrl, `duplicate-retry-${market}`, config);
        if (!dupNavigated) {
          summary[market] = '❌ Duplicate retry login';
          details[market] = { ok: false, reason: 'duplicate_retry_login' };
          hardFailures++;
          continue;
        }
        const retryData = await scrapeTableWithRecovery(page, 'main_pl', market);
        if (!retryData) {
          summary[market] = '❌ Duplicate retry failed';
          details[market] = { ok: false, reason: 'duplicate_retry_failed' };
          hardFailures++;
          continue;
        }
        const retryMonthly = extractMonthly2026(retryData.headers, retryData.rows);
        retryMonthly.rows = normalizeRowsCurrency(retryMonthly.rows, config.symbol);
        const retryFingerprint = tableFingerprint(retryMonthly.rows);
        if (retryFingerprint === previousFingerprint || isZeroExport(retryMonthly.rows)) {
          console.log(`      ⚠️ Duplicate/zero snapshot na retry (${previousMarket} -> ${market}) — markeren als failure`);
          summary[market] = '❌ Duplicate snapshot';
          details[market] = {
            ok: false,
            reason: 'duplicate_snapshot_detected',
            previous_market: previousMarket,
            zero_after_retry: isZeroExport(retryMonthly.rows),
          };
          hardFailures++;
          continue;
        }
        monthly.headers = retryMonthly.headers;
        monthly.rows = retryMonthly.rows;
      }
      console.log(`      📅 Maanden: ${monthly.months.join(', ')}`);
      console.log(`      💱 Currency ${config.currency}: symbols ${beforeSymbols.join(',') || 'none'} -> ${afterSymbols.join(',') || 'none'}`);

      saveCsv(market, 'monthly_pl', monthly.headers, monthly.rows);
      const saveResult = await saveToSupabase(market, 'monthly_pl', monthly.headers, monthly.rows);
      if (!saveResult?.ok) {
        summary[market] = '❌ Supabase save';
        details[market] = { ok: false, reason: 'supabase_save_failed', error: saveResult?.error || 'unknown' };
        hardFailures++;
        continue;
      }
      summary[market] = `${monthly.rows.length} metrics × ${monthly.months.length} months ✅`;
      details[market] = {
        ok: true,
        row_count: monthly.rows.length,
        month_count: monthly.months.length,
        save_mode: saveResult.mode,
        market: market,
        currency: config.currency
      };
      totalRowsExported += monthly.rows.length;
      previousMarket = market;
      previousFingerprint = tableFingerprint(monthly.rows);
    }
    
  } finally {
    await browser.close();
  }
  
  // Print summary
  console.log('\n\n============================================================');
  console.log('📊 SAMENVATTING');
  console.log('============================================================');
  for (const [market, data] of Object.entries(summary)) {
    console.log(`   ${market.padEnd(18)} ${data}`);
  }
  console.log(`\n   Supabase: Sellerboard_Exports (view_type = monthly_pl, ${EXPORT_YEAR})`);
  console.log(`   CSVs:     ${path.join(__dirname, 'csv-downloads')}`);
  console.log(`   Debug:    ${path.join(__dirname, 'debug-screenshots')}`);
  
  // Save lightweight JSON summary
  const jsonFile = path.join(__dirname, 'sellerboard-pl-data.json');
  fs.writeFileSync(jsonFile, JSON.stringify(summary, null, 2));
  console.log(`   JSON:     ${jsonFile} (${(fs.statSync(jsonFile).size / 1024).toFixed(1)}KB — summary only)`);

  // Hard-fail when script "succeeds" without writing real rows.
  if (totalRowsExported === 0 || hardFailures > 0) {
    const reason = totalRowsExported === 0
      ? `Geen rijen geëxporteerd (${hardFailures} failures)`
      : `${hardFailures} market failure(s)`;
    const error = new Error(`Sellerboard export failed: ${reason}`);
    error.summary = { summary, details, totalRowsExported, hardFailures };
    throw error;
  }

  console.log(`\n✅ Klaar! (${totalRowsExported} total rows)`);
  return { summary, details, totalRowsExported, hardFailures };
}

module.exports = async function runSellerboardPlExport({ task } = {}) {
  const actionTokens = collectScopeTokens(task?.actions);
  if (actionTokens.length > 0) {
    process.argv = ['node', 'sellerboard-pl-export.js', ...actionTokens];
  } else if (process.env.MARKET_SCOPE) {
    process.argv = ['node', 'sellerboard-pl-export.js', process.env.MARKET_SCOPE];
  }
  const result = await main();
  return { success: true, run_id: RUN_ID, ...result };
};

if (require.main === module) {
  main().catch(err => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    process.exit(1);
  });
}
