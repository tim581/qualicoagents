// Sellerboard P&L Export v14 — 2026 monthly P&L per market
// Scrapes main P&L table → filters 2026 month columns → upserts monthly_pl to Supabase
// v14: fix Estimated payout drop (pad-as-child false positive); soft payout label match;
//      Long term storage warn-only; robust Amazon fees expand; marketplace-chip account detect;
//      force US switch before NA; refuse € on US/CA markets
// v13: Amazon fees sub-lines (`Amazon fees > …`) via native CSV or expanded DOM;
//      CA Select2 harden (search + header confirm); refuse USA→CA duplicate/$ mixups
// v12: deterministic post-switch wait, Sales-row duplicate + all-zero Sales guard (3× retry),
//      Estimated payout row, soft warning for isolated zero months
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
  'Amazon.com': {
    account: 'us',
    urlParam: 'Amazon.com',
    currency: 'USD',
    symbol: '$',
    // Sellerboard chips render lowercase "amazon.com" (exact — do not match amazon.com.be).
    uiLabels: ['amazon.com', 'Amazon.com', 'United States', 'USA'],
    needsUiMarketSelect: true,
  },
  'Amazon.ca': {
    account: 'us',
    urlParam: 'Amazon.ca',
    currency: 'CAD',
    symbol: '$',
    // Exact Select2 chip is "amazon.ca" — do not include amazon.com.ca (steals longest-match search).
    uiLabels: ['amazon.ca', 'Amazon.ca'],
    needsUiMarketSelect: true,
  },
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
  ca: 'Amazon.ca',
  usa: 'Amazon.com',
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

const MAX_MARKET_SWITCH_RETRIES = 3;
const ESTIMATED_PAYOUT_LABELS = [
  'Estimated payout',
  'Estimated Payout',
  'Est. payout',
  'Est. Payout',
  'Estimated Payout:',
  'Payout (est.)',
  'Payout (estimated)',
];
const ESTIMATED_PAYOUT_RE = /^(?:amazon fees\s*>\s*)?(?:estimated\s+payout|est\.?\s*payout|payout\s*\((?:est\.?|estimated)\))\s*:?$/i;
const PL_NETWORK_URL_RE = /sellerboard\.com.*(?:\/api\/|table|dashboard|profit|pl|market|period)/i;

/** Core Amazon fees children required for ingest fee split (rest → residual). */
const REQUIRED_AMAZON_FEE_SUBLINES = [
  'Referral fee',
  'FBA per unit fulfilment fee',
  'FBA storage fee',
  'FBA disposal fee',
];
/** Present on some markets/months only — never hard-fail the market. */
const OPTIONAL_AMAZON_FEE_SUBLINES = [
  'Long term storage fee',
];
const AMAZON_FEES_PARENT = 'Amazon fees';

/** Known top-level P&L rows — never treat as Amazon fees children / never drop. */
const TOP_LEVEL_PL_LABELS = new Set([
  'sales', 'units', 'ads', 'advertising', 'advertising cost', 'promo', 'promotions',
  'refunds', 'amazon fees', 'cost of goods', 'cogs', 'vat', 'gross profit',
  'indirect expenses', 'net profit', 'estimated payout', 'real acos', '% refunds',
  'sellable returns', 'margin', 'roi', 'sessions', 'browser sessions', 'mobile app sessions',
  'ppc cost', 'ppc', 'other', 'other income', 'other expenses',
].map((s) => s.toLowerCase()));

// --- HELPERS ---
function barePlLabel(label) {
  return String(label || '')
    .trim()
    .replace(/^Amazon fees\s*>\s*/i, '')
    .replace(/:$/, '')
    .trim();
}

function isEstimatedPayoutLabel(label) {
  const bare = barePlLabel(label);
  if (!bare) return false;
  if (ESTIMATED_PAYOUT_LABELS.some((l) => l.toLowerCase() === bare.toLowerCase())) return true;
  return ESTIMATED_PAYOUT_RE.test(String(label || '').trim()) || ESTIMATED_PAYOUT_RE.test(bare);
}

function isTopLevelPlLabel(label) {
  const bare = barePlLabel(label).toLowerCase();
  if (!bare) return false;
  if (TOP_LEVEL_PL_LABELS.has(bare)) return true;
  if (isEstimatedPayoutLabel(bare)) return true;
  return false;
}

function normalizeRowLabel(label) {
  const trimmed = (label || '').trim();
  if (isEstimatedPayoutLabel(trimmed)) return 'Estimated payout';
  return trimmed;
}

function normalizeExportedRows(rows) {
  return (rows || []).map((row) => [normalizeRowLabel(row[0]), ...row.slice(1)]);
}

/**
 * Sellerboard CSV / expanded DOM uses leading spaces for children.
 * Keep Amazon fees children as `Amazon fees > Referral fee`; drop other children
 * (Sales > Organic, etc.) so Sellerboard_Exports stays ingest-friendly.
 * Known top-level metrics are never dropped even if DOM padding looked "indented".
 */
function attachAmazonFeeSublinePrefixes(rows) {
  const out = [];
  let currentParent = null;

  for (const row of rows || []) {
    const raw = String(row?.[0] ?? '');
    if (!raw.trim()) continue;

    // Already prefixed from a prior pass
    if (/^amazon fees\s*>/i.test(raw.trim())) {
      const bare = barePlLabel(raw);
      // Accidental "Amazon fees > Estimated payout" from pad false-positive → promote
      if (isEstimatedPayoutLabel(bare) || isTopLevelPlLabel(bare)) {
        const promoted = isEstimatedPayoutLabel(bare) ? 'Estimated payout' : bare;
        out.push([promoted, ...row.slice(1)]);
        currentParent = promoted;
        continue;
      }
      out.push([raw.trim().replace(/\s*>\s*/g, ' > ').replace(/^amazon fees/i, AMAZON_FEES_PARENT), ...row.slice(1)]);
      currentParent = AMAZON_FEES_PARENT;
      continue;
    }

    const indented = /^\s+/.test(raw);
    const label = raw.trim();

    // Top-level metrics always kept (DOM sometimes pads them like children).
    if (!indented || isTopLevelPlLabel(label)) {
      currentParent = label;
      out.push([isEstimatedPayoutLabel(label) ? 'Estimated payout' : label, ...row.slice(1)]);
      continue;
    }

    if (currentParent === AMAZON_FEES_PARENT) {
      out.push([`${AMAZON_FEES_PARENT} > ${label}`, ...row.slice(1)]);
    }
    // Non-Amazon-fees children are intentionally dropped
  }

  return out;
}

function amazonFeeSublineNames(rows) {
  const names = [];
  for (const row of rows || []) {
    const label = String(row?.[0] ?? '').trim();
    const m = label.match(/^Amazon fees\s*>\s*(.+)$/i);
    if (m) names.push(m[1].trim());
  }
  return names;
}

function feeSublineSet(rows) {
  const have = new Set(amazonFeeSublineNames(rows).map((n) => n.toLowerCase()));
  // US spelling variant of fulfilment
  if (have.has('fba per unit fulfillment fee')) {
    have.add('fba per unit fulfilment fee');
  }
  return have;
}

function missingRequiredAmazonFeeSublines(rows) {
  const have = feeSublineSet(rows);
  return REQUIRED_AMAZON_FEE_SUBLINES.filter((n) => !have.has(n.toLowerCase()));
}

function missingOptionalAmazonFeeSublines(rows) {
  const have = feeSublineSet(rows);
  return OPTIONAL_AMAZON_FEE_SUBLINES.filter((n) => !have.has(n.toLowerCase()));
}

/** Minimal CSV parser that preserves leading spaces in field 1. */
function parseSellerboardCsvText(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  const parseLine = (line) => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',' || ch === ';') {
        result.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine).filter((r) => r.some((c) => String(c || '').trim()));
  return { headers, rows, source: 'csv' };
}

function getSalesRow(rows) {
  return (rows || []).find((r) => normalizeRowLabel(r?.[0]) === 'Sales') || null;
}

function findEstimatedPayoutRow(rows) {
  return (rows || []).find((r) => isEstimatedPayoutLabel(r?.[0])) || null;
}

function salesRowsIdentical(rowA, rowB) {
  if (!rowA || !rowB) return false;
  const a = rowA.map((c) => String(c ?? '').trim());
  const b = rowB.map((c) => String(c ?? '').trim());
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}

function salesRowHasNonZeroValue(salesRow) {
  if (!salesRow?.length) return false;
  return salesRow.slice(1).some((cell) => Math.abs(parseNumericCell(cell)) > 0);
}

function createPlNetworkTracker(page) {
  let inflight = 0;
  let lastCompleteAt = Date.now();

  const onRequest = (req) => {
    if (!PL_NETWORK_URL_RE.test(req.url())) return;
    inflight += 1;
  };
  const onResponse = (resp) => {
    if (!PL_NETWORK_URL_RE.test(resp.url())) return;
    inflight = Math.max(0, inflight - 1);
    lastCompleteAt = Date.now();
  };

  page.on('request', onRequest);
  page.on('response', onResponse);

  return {
    async waitForIdle(timeoutMs = 20000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const quietFor = Date.now() - lastCompleteAt;
        if (inflight === 0 && quietFor >= 600) return true;
        await page.waitForTimeout(250);
      }
      return false;
    },
    detach() {
      page.off('request', onRequest);
      page.off('response', onResponse);
    },
  };
}

async function readSalesRowFromPage(page) {
  return page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      for (const row of table.querySelectorAll('tr')) {
        const cells = Array.from(row.querySelectorAll('th, td')).map((c) => (c.innerText || '').split('\n')[0].trim());
        if (cells[0] === 'Sales') return cells;
      }
    }
    return null;
  });
}

function marketChipPatterns(config) {
  const labels = [config.urlParam, ...(config.uiLabels || [])];
  const patterns = [
    config.urlParam.replace(/^Amazon\./i, 'amazon.').toLowerCase(),
    config.urlParam.toLowerCase(),
    ...labels.map((l) => String(l).toLowerCase()),
  ];
  // Prefer exact amazon.* domain chips (longest first → amazon.com.be before amazon.com).
  // Keep short CA/BE tokens only as Select2 search hints, not primary click targets.
  const domainPatterns = [...new Set(patterns.filter((p) => p && p.includes('amazon.')))]
    .sort((a, b) => b.length - a.length);
  return domainPatterns.length ? domainPatterns : [...new Set(patterns.filter(Boolean))];
}

async function readMarketHeaderLabel(page, config) {
  const chipWanted = marketChipPatterns(config);
  return page.evaluate((wanted) => {
    const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const isWanted = (text) => wanted.some((t) => text === t);

    // Select2 single-select rendered value (US marketplaces filter).
    const rendered = document.querySelector(
      '.filter-item.marketplaces .select2-selection__rendered, .select-marketplaces-wrapper .select2-selection__rendered',
    );
    if (rendered) {
      const text = norm(rendered.textContent || rendered.title || '');
      if (text && isWanted(text)) return true;
    }

    const firstLine = (el) => norm((el.innerText || el.textContent || '').split('\n')[0]);
    const nodes = Array.from(document.querySelectorAll('a, button, label, span, div, li, input'));
    for (const el of nodes) {
      const text = firstLine(el);
      if (!text || text.length > 40 || !isWanted(text)) continue;
      const cls = `${el.className || ''} ${el.parentElement?.className || ''}`;
      const selected = el.getAttribute('aria-selected') === 'true'
        || el.getAttribute('aria-checked') === 'true'
        || (el.tagName === 'INPUT' && el.checked)
        || /active|selected|checked|current|is-active|isSelected/i.test(cls);
      if (selected) return true;
    }

    try {
      const url = new URL(window.location.href);
      const markets = [...url.searchParams.getAll('market[]'), ...url.searchParams.getAll('market')]
        .map(norm)
        .filter(Boolean);
      if (markets.length && markets.every((m) => isWanted(m))) return true;
    } catch {
      /* ignore */
    }
    return false;
  }, chipWanted);
}

async function waitForMarketDataRefresh(page, config, options = {}) {
  const {
    networkTracker = null,
    previousSalesRow = null,
    timeoutMs = config?.account === 'us' ? 45000 : 30000,
    requireNonZeroSales = config?.account === 'us',
  } = options;

  if (networkTracker) {
    await networkTracker.waitForIdle(Math.min(timeoutMs, 20000));
  }

  const started = Date.now();
  let lastPreview = null;

  while (Date.now() - started < timeoutMs) {
    const headerOk = await readMarketHeaderLabel(page, config).catch(() => false);
    const salesRow = await readSalesRowFromPage(page);

    if (salesRow?.length > 1) {
      const values = salesRow.slice(1);
      const hasExpectedSymbol = config.symbol === '$'
        ? values.some((v) => v.includes('$'))
        : values.some((v) => v.includes(config.symbol));
      const janValue = values[0] || '';
      const differsFromPrevious = previousSalesRow
        ? !salesRowsIdentical(salesRow, previousSalesRow)
        : true;
      const hasNonZeroSales = salesRowHasNonZeroValue(salesRow);

      lastPreview = { janValue, hasExpectedSymbol, headerOk, differsFromPrevious, hasNonZeroSales };

      const ready = hasExpectedSymbol
        && differsFromPrevious
        && (headerOk || !config.needsUiMarketSelect)
        && (!requireNonZeroSales || hasNonZeroSales);

      if (ready) {
        console.log(`      Ô£à Market data refreshed (Sales jan: ${janValue.substring(0, 24)})`);
        return { ok: true, salesRow, preview: lastPreview };
      }
    }

    await page.waitForTimeout(500);
  }

  console.log(`      ÔÜá´©Å Market refresh timeout (${config.urlParam}) preview=${JSON.stringify(lastPreview)}`);
  return { ok: false, salesRow: await readSalesRowFromPage(page), preview: lastPreview };
}

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

async function freshNavigate(page, url, label, config = null, options = {}) {
  const { networkTracker = null, previousSalesRow = null } = options;
  console.log(`      🌐 Navigate: ${url.substring(0, 90)}...`);

  await page.goto('about:blank');
  await page.waitForTimeout(500);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await dismissSellerboardOverlays(page);

  if (await isOnLoginPage(page)) {
    await debugLog(page, `login-redirect-${label}`, '⚠️ Login redirect — recovering session before scrape');
    const ok = await ensureSellerboardSession(page);
    if (!ok) {
      await debugLog(page, label, `Pagina geladen: ${page.url().substring(0, 80)}...`);
      return { ok: false, uiMarketSelected: false };
    }
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }

  let currentUrl = page.url();
  if (!currentUrl.includes('market') && !await isOnLoginPage(page)) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    currentUrl = page.url();
  }

  let uiMarketSelected = false;
  if (config?.needsUiMarketSelect || config?.uiLabels?.length) {
    uiMarketSelected = await selectMarketInUi(page, config, {
      networkTracker,
      previousSalesRow,
    });
    await ensurePlView(page);
    // Hard confirm for US/CA — both use $ so URL alone is not enough.
    if (uiMarketSelected && config.account === 'us') {
      const headerOk = await readMarketHeaderLabel(page, config).catch(() => false);
      if (!headerOk) {
        console.log(`      ⚠️ US market header mismatch after select (${config.urlParam})`);
        uiMarketSelected = false;
      }
    }
  }

  if (config) {
    const refresh = await waitForMarketDataRefresh(page, config, {
      networkTracker,
      previousSalesRow,
    });
    if (!refresh.ok) {
      await waitForMarketTable(page, config).catch(() => null);
    }
  }

  await debugLog(page, label, `Pagina geladen: ${currentUrl.substring(0, 80)}...`);
  const ok = !await isOnLoginPage(page);
  return { ok, uiMarketSelected };
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
  // Native Sellerboard CSV cells are bare numbers — stamp the market symbol.
  const trimmed = raw.trim();
  if (!/[€$£]/.test(trimmed) && /^-?\d/.test(trimmed)) {
    const neg = trimmed.startsWith('-');
    const num = trimmed.replace(/^-/, '');
    return neg ? `-${expectedSymbol} ${num}` : `${expectedSymbol} ${num}`;
  }
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

/**
 * Bug 2 hard block: do not upload when Sales are effectively all-zero.
 * - Missing Sales row / empty cells → zero
 * - Sum of ALL month Sales == 0 → zero
 * - Sum of all completed (non-partial) month Sales == 0 → also zero
 *   (catches stale USA scrapes where only the current partial month has noise)
 */
function isZeroExport(monthlyRows, months = null) {
  if (!Array.isArray(monthlyRows) || monthlyRows.length === 0) return true;
  const sales = getSalesRow(monthlyRows);
  if (!sales) return true;
  const salesVals = sales.slice(1);
  if (salesVals.length === 0) return true;

  const salesSum = salesVals.reduce((sum, cell) => sum + Math.abs(parseNumericCell(cell)), 0);
  if (salesSum === 0) return true;

  const monthKeys = Array.isArray(months) && months.length === salesVals.length
    ? months
    : null;
  if (monthKeys) {
    const completedIdx = monthKeys
      .map((m, i) => ({ m: String(m || ''), i }))
      .filter(({ m }) => !/_partial$/i.test(m) && !/partial/i.test(m))
      .map(({ i }) => i);
    if (completedIdx.length > 0) {
      const completedSum = completedIdx.reduce(
        (sum, i) => sum + Math.abs(parseNumericCell(salesVals[i])),
        0,
      );
      if (completedSum === 0) return true;
    }
  }

  return false;
}

/** Soft warning: Sales=0 months flanked by >€/$1000 neighbors (still upload). */
function findSuspiciousZeroMonths(monthly) {
  const sales = getSalesRow(monthly?.rows);
  if (!sales?.length || !Array.isArray(monthly?.months)) return [];
  const warnings = [];
  const values = sales.slice(1).map(parseNumericCell);
  for (let i = 0; i < values.length; i += 1) {
    if (Math.abs(values[i]) >= 0.01) continue;
    const prev = i > 0 ? values[i - 1] : 0;
    const next = i < values.length - 1 ? values[i + 1] : 0;
    if (Math.abs(prev) > 1000 || Math.abs(next) > 1000) {
      warnings.push(`${monthly.months[i] || `month-${i + 1}`}: Sales is 0 but adjacent month > 1000`);
    }
  }
  return warnings;
}

async function detectAccountMarketplaceProfile(page) {
  try {
    return await page.evaluate(() => {
      const body = (document.body?.innerText || '').toLowerCase();
      const hasUsChips = /\bamazon\.com\b/.test(body) && /\bamazon\.ca\b/.test(body);
      const hasEuChips = /\bamazon\.de\b/.test(body)
        || /\bamazon\.co\.uk\b/.test(body)
        || /\bamazon\.fr\b/.test(body)
        || /\bamazon\.com\.be\b/.test(body);
      if (hasUsChips && !hasEuChips) return 'us';
      if (hasEuChips && !hasUsChips) return 'eu';
      // Select2 rendered marketplace value is a strong signal.
      const rendered = document.querySelector(
        '.filter-item.marketplaces .select2-selection__rendered, .select-marketplaces-wrapper .select2-selection__rendered',
      );
      const renderedText = (rendered?.textContent || rendered?.title || '').trim().toLowerCase();
      if (/amazon\.ca|amazon\.com$/.test(renderedText) && !/amazon\.com\.be/.test(renderedText)) return 'us';
      if (/amazon\.(de|fr|it|es|nl|co\.uk|com\.be)/.test(renderedText)) return 'eu';
      return null;
    });
  } catch {
    return null;
  }
}

async function detectAccountOnPage(page) {
  try {
    // Only trust top-right account badge (avoid false AMZ USA hits in hidden menus).
    const badge = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll(
        'header *, nav *, [class*="header"] *, [class*="account"] *, [class*="user"] *, [class*="avatar"] *',
      ));
      for (const el of nodes) {
        const t = (el.innerText || '').trim();
        if (!t || t.length > 40) continue;
        const r = el.getBoundingClientRect();
        if (r.top > 90 || r.height < 4 || r.width < 4) continue;
        if (r.left < window.innerWidth * 0.55) continue;
        if (/^AMZ USA$/i.test(t) || /^AMZ\s+USA$/i.test(t)) return 'us';
        if (/tim@qualico\.be/i.test(t)) return 'eu';
      }
      return null;
    });
    if (badge) return badge;
  } catch {
    /* ignore */
  }
  return null;
}

async function salesPreviewHasEuro(page) {
  try {
    const sales = await readSalesRowFromPage(page);
    return !!(sales && sales.slice(1).some((c) => String(c || '').includes('€')));
  } catch {
    return false;
  }
}

async function ensureCorrectAccount(page, targetAccount, currentAccount) {
  const nameDetected = await detectAccountOnPage(page);
  const profileDetected = await detectAccountMarketplaceProfile(page);
  let effective = profileDetected || nameDetected || currentAccount;

  if (profileDetected && nameDetected && profileDetected !== nameDetected) {
    console.log(`   ⚠️ Account name=${nameDetected} vs markets=${profileDetected} — trusting marketplace chips`);
    effective = profileDetected;
  }

  // US markets must never scrape while Sales still shows € (EU bleed).
  if (targetAccount === 'us' && effective === 'us') {
    const euroBleed = await salesPreviewHasEuro(page);
    if (euroBleed || profileDetected === 'eu') {
      console.log(`   ⚠️ Claimed US account but ${euroBleed ? '€ Sales' : 'EU markets'} visible — forcing switch`);
      effective = 'eu';
    }
  }

  if (effective === targetAccount) return { ok: true, account: targetAccount };

  console.log(
    `   🔄 Account mismatch (detected=${nameDetected || 'unknown'}`
    + `/markets=${profileDetected || 'unknown'}, need=${targetAccount}) — switching...`,
  );
  const switched = await switchAccount(page, targetAccount);
  if (!switched) return { ok: false, account: effective };

  await page.waitForTimeout(2000);
  const afterProfile = await detectAccountMarketplaceProfile(page);
  const afterName = await detectAccountOnPage(page);
  const after = afterProfile || afterName || targetAccount;

  if (targetAccount === 'us') {
    const euroBleed = await salesPreviewHasEuro(page);
    if (after === 'eu' || euroBleed) {
      console.log(`   ❌ Still on EU after US switch (markets=${afterProfile}, €=${euroBleed})`);
      return { ok: false, account: afterProfile || 'eu' };
    }
  }
  if (targetAccount === 'eu' && afterProfile === 'us') {
    console.log(`   ❌ Still on US markets after EU switch`);
    return { ok: false, account: 'us' };
  }

  return { ok: true, account: targetAccount };
}

async function selectMarketInUi(page, config, options = {}) {
  const {
    networkTracker = null,
    previousSalesRow = null,
  } = options;
  const labels = [config.urlParam, ...(config.uiLabels || [])];
  const chipPatterns = marketChipPatterns(config);
  await debugLog(page, `market-ui-start-${config.urlParam}`, `🎯 UI market select: ${labels.join(', ')}`, false);

  // Open markets filter if collapsed.
  for (const opener of [/markets?/i, /marketplace/i, /filter/i]) {
    try {
      const btn = page.locator('button, a, [role="button"], label').filter({ hasText: opener }).first();
      if (await btn.count()) {
        await btn.click({ timeout: 2000 });
        await page.waitForTimeout(1000);
        break;
      }
    } catch {
      /* try next opener */
    }
  }

  // Select2 marketplace dropdown (US account uses this — not legacy chips).
  // Filter row can sit far off to the right until scrolled into view.
  let clickedLabel = null;
  try {
    const filterItem = page.locator('.filter-item.marketplaces, .select-marketplaces-wrapper').first();
    if (await filterItem.count()) {
      await filterItem.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const selection = filterItem.locator('.select2-selection, .select2-selection__rendered').first();
      const openTarget = (await selection.count()) ? selection : filterItem;
      await openTarget.click({ timeout: 3000 });
      await page.waitForTimeout(600);

      // Type the most specific domain into Select2 search (critical for amazon.ca vs amazon.com).
      const searchHint = chipPatterns[0] || config.urlParam;
      const searchBox = page.locator(
        '.select2-container--open .select2-search__field, .select2-search__field, input.select2-search__field',
      ).first();
      if (await searchBox.count()) {
        await searchBox.fill('');
        await searchBox.type(String(searchHint).replace(/^amazon\./i, ''), { delay: 40 });
        await page.waitForTimeout(400);
      }

      // Prefer the open select2 dropdown results (appended to body).
      for (const pattern of chipPatterns) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const option = page.locator(
          '.select2-container--open .select2-results__option, .select2-results__option, li[role="option"]',
        ).filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i') }).first();
        if (!(await option.count())) continue;
        await option.scrollIntoViewIfNeeded().catch(() => null);
        if (!(await option.isVisible().catch(() => false))) continue;
        await option.click({ timeout: 3000 });
        clickedLabel = pattern;
        break;
      }
      if (!clickedLabel) {
        await page.keyboard.press('Escape').catch(() => null);
      }
    }
  } catch {
    /* fall through to chip/evaluate paths */
  }

  // Playwright-native exact chip click (longest pattern first → amazon.com.be before amazon.com).
  if (!clickedLabel) {
    for (const pattern of chipPatterns) {
      try {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const chip = page.locator('a, button, span, div, label, li').filter({
          hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i'),
        }).first();
        if (!(await chip.count())) continue;
        if (!(await chip.isVisible().catch(() => false))) continue;
        const box = await chip.boundingBox().catch(() => null);
        // Skip off-screen Select2 clones (left >> viewport width).
        if (box && box.x > 2000) continue;
        await chip.click({ timeout: 3000 });
        clickedLabel = pattern;
        break;
      } catch {
        /* try next pattern */
      }
    }
  }

  if (!clickedLabel) {
    const clicked = await page.evaluate((wanted) => {
      const norm = (s) => (s || '').trim().toLowerCase();
      const firstLine = (el) => norm((el.innerText || el.textContent || '').split('\n')[0]);
      const isMarketChip = (text) => wanted.some((t) => text === t);

      const chipCandidates = Array.from(document.querySelectorAll('a, button, label, span, div, li'));
      for (const el of chipCandidates) {
        const text = firstLine(el);
        if (!text || text.length > 40) continue;
        if (!isMarketChip(text)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5 || rect.top > 420 || rect.left > 2000) continue;
        el.click();
        return { ok: true, label: text };
      }
      return { ok: false };
    }, chipPatterns);
    if (clicked?.ok) clickedLabel = clicked.label;
  }

  if (clickedLabel) {
    console.log(`      ✅ UI market geklikt: ${clickedLabel}`);
    const refresh = await waitForMarketDataRefresh(page, config, {
      networkTracker,
      previousSalesRow,
      requireNonZeroSales: true,
      timeoutMs: config.account === 'us' ? 60000 : 35000,
    });
    // Confirm Select2 / header actually landed on the requested market (CA vs USA both use $).
    const headerOk = await readMarketHeaderLabel(page, config).catch(() => false);
    if (!headerOk) {
      console.log(`      ⚠️ Market header not confirmed after click (${config.urlParam})`);
      await debugLog(page, `market-ui-unconfirmed-${config.urlParam}`, '⚠️ Select2 click did not confirm market header', true);
      return false;
    }
    if (!refresh.ok) {
      await waitForMarketTable(page, config).catch(() => null);
    }
    await debugLog(page, `market-ui-done-${config.urlParam}`, `✅ UI market geselecteerd: ${clickedLabel}`, true);
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

// Enhanced table detection: supports both <table> and div-based grids.
// Preserves leading spaces / indent so Amazon fees children survive into exports.
async function findTableData(page) {
  return await page.evaluate((topLevelLabels) => {
    const topSet = new Set((topLevelLabels || []).map((s) => String(s).toLowerCase()));
    const isTop = (label) => {
      const t = (label || '').trim().toLowerCase().replace(/:$/, '');
      if (!t) return false;
      if (topSet.has(t)) return true;
      if (/^estimated\s+payout|^est\.?\s*payout/i.test(t)) return true;
      return false;
    };

    const labelFromCell = (cell, row) => {
      // Prefer dedicated label span in <th>; avoid dumping all cell text for value cells.
      const rawLabel = row.querySelector('th') === cell
        ? ((cell.querySelector('span.ng-binding, span')?.innerText || cell.innerText || '').split('\n')[0] || '')
        : ((cell?.innerText || cell?.textContent || '').split('\n')[0] || '');
      const raw = rawLabel;
      const trimmed = raw.trim();
      if (!trimmed) return '';
      // Never demote known top-level metrics — Sellerboard pads many parent rows.
      if (isTop(trimmed)) return trimmed;

      const leading = (raw.match(/^(\s*)/) || ['', ''])[1].length;
      const depth = Number(row.getAttribute('data-level') || row.getAttribute('aria-level') || 0);
      const cls = `${row.className || ''} ${cell.className || ''}`;
      // Prefer explicit hierarchy signals. Do NOT use paddingLeft alone (false positives).
      // Sellerboard fee children: tr.dashboard-table-table-fieldRow.child
      const isChild = leading >= 2
        || depth > 0
        || /(?:^|\s)child(?:\s|$)/i.test(row.className || '')
        || /(?:^|\s)(?:sub-?row|nested|indent|level-[1-9])(?:\s|$)/i.test(cls);
      if (isChild && leading < 2) return `    ${trimmed}`;
      return leading >= 2 ? raw.replace(/\t/g, '    ') : trimmed;
    };

    // Prefer the monthly P&L field table over calendar / other tables.
    const preferredRows = document.querySelectorAll('tr.dashboard-table-table-fieldRow');
    let bestTable = preferredRows.length > 5 ? preferredRows[0].closest('table') : null;
    let bestRows = preferredRows.length > 5 ? preferredRows.length : 0;

    const tables = document.querySelectorAll('table');
    if (!bestTable) {
      tables.forEach((t) => {
        const rows = t.querySelectorAll('tr');
        if (rows.length > bestRows) {
          bestRows = rows.length;
          bestTable = t;
        }
      });
    }
    if (bestTable && bestRows > 5) {
      const rows = bestTable.querySelectorAll('tr');
      const result = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        const rowData = [];
        let col = 0;
        for (const cell of cells) {
          if (col === 0) rowData.push(labelFromCell(cell, row));
          else rowData.push(cell.innerText?.split('\n')[0]?.trim() || '');
          col += 1;
        }
        if (rowData.some((c) => String(c || '').trim())) result.push(rowData);
      }
      return { source: 'table', tableCount: tables.length, data: result };
    }

    const gridContainers = document.querySelectorAll('[class*="table"], [class*="grid"], [class*="row"], [role="table"], [role="grid"]');
    return { source: 'none', tableCount: tables.length, gridCount: gridContainers.length, bestRows, data: null };
  }, Array.from(TOP_LEVEL_PL_LABELS));
}

async function pageHasAmazonFeeChild(page, childName = 'Referral fee') {
  return page.evaluate((wanted) => {
    const want = String(wanted || '').toLowerCase();
    const rows = document.querySelectorAll('tr.dashboard-table-table-fieldRow, tr');
    for (const row of rows) {
      const first = (
        row.querySelector('th span.ng-binding, th span, th, td')?.innerText || ''
      ).split('\n')[0].trim().toLowerCase();
      if (first === want) return true;
    }
    return false;
  }, childName).catch(() => false);
}

async function expandAmazonFeeRows(page) {
  await dismissSellerboardOverlays(page);

  for (let attempt = 1; attempt <= 4; attempt++) {
    if (await pageHasAmazonFeeChild(page, 'Referral fee')) {
      if (attempt > 1) console.log(`      ✅ Amazon fees expanded (attempt ${attempt})`);
      return true;
    }

    try {
      // Sellerboard P&L: button.dashboard-table-table-fieldRow-arrow toggles isOpened.
      const clicked = await page.evaluate(() => {
        const rows = document.querySelectorAll('tr.dashboard-table-table-fieldRow, tr');
        for (const row of rows) {
          const th = row.querySelector('th');
          if (!th) continue;
          const label = (
            th.querySelector('span.ng-binding, span')?.innerText || th.innerText || ''
          ).split('\n')[0].trim();
          if (!/^Amazon fees$/i.test(label)) continue;

          const arrow = row.querySelector('button.dashboard-table-table-fieldRow-arrow');
          if (arrow) {
            // Already open → leave it; otherwise click to expand.
            if (!arrow.classList.contains('opened')) arrow.click();
            else th.click(); // toggle if class stale
            return { ok: true, via: 'arrow', opened: arrow.classList.contains('opened') };
          }
          th.click();
          return { ok: true, via: 'th' };
        }
        return { ok: false };
      });
      if (clicked?.ok) {
        console.log(`      ℹ️ Amazon fees expand click via ${clicked.via}`);
      }
    } catch {
      /* ignore */
    }

    // Playwright locator fallback
    try {
      const feeRow = page.locator('tr.dashboard-table-table-fieldRow, tr').filter({
        has: page.locator('th span, th').filter({ hasText: /^Amazon fees$/i }),
      }).first();
      if (await feeRow.count()) {
        const arrow = feeRow.locator('button.dashboard-table-table-fieldRow-arrow').first();
        if (await arrow.count()) {
          await arrow.click({ timeout: 2000, force: true }).catch(() => null);
        } else {
          await feeRow.locator('th').first().click({ timeout: 2000, force: true }).catch(() => null);
        }
      }
    } catch {
      /* ignore */
    }

    await page.waitForTimeout(800 + attempt * 400);
  }

  console.log('      ⚠️ Amazon fees DOM expand did not reveal Referral fee');
  return false;
}

async function dismissSellerboardOverlays(page) {
  try {
    await page.evaluate(() => {
      // New-feature / tour modals block clicks (modal-backdrop.newFeature).
      for (const sel of [
        '.modal-backdrop',
        '.modal.in',
        '.modal.show',
        '[class*="newFeature"]',
        '[class*="onboarding"]',
        '[class*="joyride"]',
        '[class*="shepherd"]',
      ]) {
        document.querySelectorAll(sel).forEach((el) => {
          try { el.remove(); } catch { /* ignore */ }
        });
      }
      document.body?.classList?.remove('modal-open');
      document.documentElement?.classList?.remove('modal-open');
    });
  } catch {
    /* ignore */
  }

  for (const label of [/got it/i, /close/i, /dismiss/i, /skip/i, /not now/i, /^ok$/i, /continue/i]) {
    try {
      const btn = page.locator('button, a, [role="button"]').filter({ hasText: label }).first();
      if (await btn.count() && await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 1500, force: true }).catch(() => null);
        await page.waitForTimeout(300);
      }
    } catch {
      /* next */
    }
  }
  await page.keyboard.press('Escape').catch(() => null);
}

/** Prefer Sellerboard native CSV — it always includes indented Amazon fees sub-lines. */
async function tryDownloadSellerboardPlCsv(page, market) {
  const dir = path.join(__dirname, 'csv-downloads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await dismissSellerboardOverlays(page);

  const exportTriggers = [
    page.locator('button.viewType-export, .viewType-export').first(),
    page.getByRole('button', { name: /^export$/i }),
    page.getByRole('link', { name: /^export$/i }),
    page.locator('button, a, [role="button"]').filter({ hasText: /^export$/i }),
    page.locator('[title*="Export" i], [aria-label*="Export" i], [data-testid*="export" i]'),
    page.locator('button, a').filter({ hasText: /export.*csv|csv.*export|download/i }),
  ];

  let trigger = null;
  for (const loc of exportTriggers) {
    try {
      if (await loc.count() && await loc.first().isVisible().catch(() => false)) {
        trigger = loc.first();
        break;
      }
    } catch {
      /* next */
    }
  }
  if (!trigger) return null;

  // Attach download waiter with .catch so a failed click never leaves an unhandled rejection.
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);

  try {
    await trigger.click({ timeout: 5000, force: true });
    await page.waitForTimeout(700);
    // Menu item variants after Export click.
    const csvItem = page.locator(
      '.dropdown-menu li a, .dropdown-menu a, [role="menuitem"], [role="option"], button, a, li, div',
    ).filter({ hasText: /csv/i }).first();
    if (await csvItem.count() && await csvItem.isVisible().catch(() => false)) {
      await csvItem.click({ timeout: 4000, force: true });
    }
    const download = await downloadPromise;
    if (!download) {
      console.log('      ℹ️ Native CSV download skipped: no download event');
      await page.keyboard.press('Escape').catch(() => null);
      return null;
    }
    const safe = String(market).replace(/[^\w.-]+/g, '_');
    const dest = path.join(dir, `main_pl_${safe}_${RUN_ID}.csv`);
    await download.saveAs(dest);
    console.log(`      ✅ Native CSV downloaded: ${path.basename(dest)}`);
    return dest;
  } catch (e) {
    // Drain download waiter so it cannot crash the process later.
    await downloadPromise;
    console.log(`      ℹ️ Native CSV download skipped: ${e.message.split('\n')[0]}`);
    await page.keyboard.press('Escape').catch(() => null);
    return null;
  }
}

async function scrapeMainPlTable(page, market = 'unknown') {
  await dismissSellerboardOverlays(page);

  // Prefer CSV (always has Amazon fees sub-lines with leading spaces).
  const csvPath = await tryDownloadSellerboardPlCsv(page, market);
  if (csvPath) {
    try {
      const parsed = parseSellerboardCsvText(fs.readFileSync(csvPath, 'utf8'));
      if (parsed?.rows?.length) {
        const prefixed = attachAmazonFeeSublinePrefixes(parsed.rows);
        const missing = missingRequiredAmazonFeeSublines(prefixed);
        // Only accept CSV if core fee children parse — otherwise fall through to DOM expand.
        if (!missing.length || amazonFeeSublineNames(prefixed).length >= 3) {
          console.log(`      📊 Using native CSV (${parsed.rows.length} rows, source=csv)`);
          return parsed;
        }
        console.log(`      ⚠️ Native CSV missing core fee sub-lines (${missing.join(', ') || 'sparse'}) — trying DOM`);
      }
    } catch (e) {
      console.log(`      ⚠️ CSV parse failed, falling back to DOM: ${e.message}`);
    }
  }

  await dismissSellerboardOverlays(page);
  await expandAmazonFeeRows(page);
  // Second pass after expand settles.
  if (!(await pageHasAmazonFeeChild(page, 'Referral fee'))) {
    await page.waitForTimeout(1500);
    await expandAmazonFeeRows(page);
  }

  const result = await findTableData(page);

  if (!result.data || result.data.length === 0) {
    console.log(`      ℹ️ Table info: ${result.tableCount} tables, ${result.gridCount || 0} grids, best: ${result.bestRows || 0} rows`);
    return null;
  }

  return { headers: result.data[0], rows: result.data.slice(1), source: result.source || 'table' };
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
  
  return await scrapeMainPlTable(page, market);
}

async function scrapeTableWithRecovery(page, viewType, market, config = null, navOptions = {}) {
  const first = await scrapeTable(page, viewType, market);
  if (first) return first;

  await debugLog(page, `recover-${viewType}-${market}`, '♻️ Retrying market once after session refresh');
  const ok = await ensureSellerboardSession(page);
  if (!ok) return null;
  const marketConfig = config || MARKET_CONFIG[market];
  const nav = await freshNavigate(
    page,
    buildUrl(marketConfig?.urlParam || market),
    `retry-${viewType}-${market}`,
    marketConfig,
    navOptions,
  );
  if (!nav?.ok) return null;
  return scrapeTable(page, viewType, market);
}

async function scrapeMarketMonthlyPl(page, market, config, navOptions = {}) {
  const mainData = await scrapeTableWithRecovery(page, 'main_pl', market, config, navOptions);
  if (!mainData) return { ok: false, reason: 'no_table_data' };

  const monthly = extractMonthly2026(mainData.headers, mainData.rows);
  if (!monthly.rows.length || !monthly.months.length) {
    return {
      ok: false,
      reason: 'empty_export',
      row_count: monthly.rows.length,
      month_count: monthly.months.length,
    };
  }

  // Keep Amazon fees children as `Amazon fees > Referral fee` (drop other indented rows).
  monthly.rows = attachAmazonFeeSublinePrefixes(monthly.rows);
  monthly.rows = normalizeExportedRows(monthly.rows);
  monthly.rows = normalizeRowsCurrency(monthly.rows, config.symbol);

  // Refuse EU currency bleed on US/CA markets.
  const symbols = detectCurrencySymbols(monthly.rows);
  if (config.account === 'us' && symbols.includes('€')) {
    console.log(`      ❌ Currency mismatch: US market ${market} still has € (${symbols.join(',')})`);
    return { ok: false, reason: 'currency_mismatch_eur_on_us', symbols };
  }

  const missingFeeSubs = missingRequiredAmazonFeeSublines(monthly.rows);
  const missingOptionalFees = missingOptionalAmazonFeeSublines(monthly.rows);
  if (missingFeeSubs.length) {
    console.log(`      ⚠️ Amazon fees sub-lines missing: ${missingFeeSubs.join(', ')} (source=${mainData.source || 'dom'})`);
    // One more expand+rescrape if DOM path lacked children.
    if ((mainData.source || 'dom') !== 'csv') {
      await expandAmazonFeeRows(page);
      const retryFees = await findTableData(page);
      if (retryFees?.data?.length) {
        const retryMonthly = extractMonthly2026(retryFees.data[0], retryFees.data.slice(1));
        retryMonthly.rows = attachAmazonFeeSublinePrefixes(retryMonthly.rows);
        retryMonthly.rows = normalizeExportedRows(retryMonthly.rows);
        retryMonthly.rows = normalizeRowsCurrency(retryMonthly.rows, config.symbol);
        const stillMissing = missingRequiredAmazonFeeSublines(retryMonthly.rows);
        if (stillMissing.length < missingFeeSubs.length) {
          monthly.headers = retryMonthly.headers;
          monthly.rows = retryMonthly.rows;
          monthly.months = retryMonthly.months;
          console.log(`      ✅ Fee expand recovery improved sub-lines (${missingFeeSubs.length} → ${stillMissing.length} missing)`);
        }
      }
    }
  } else {
    const feeCount = amazonFeeSublineNames(monthly.rows).length;
    console.log(`      ✅ Amazon fees sub-lines: ${feeCount} (incl. required set)`);
  }
  if (missingOptionalFees.length) {
    console.log(`      ℹ️ Optional fee sub-lines absent (warn only): ${missingOptionalFees.join(', ')}`);
  }

  if (!findEstimatedPayoutRow(monthly.rows)) {
    console.log(`      ⚠️ Estimated payout row missing for ${market} — retrying scrape once`);
    await ensurePlView(page);
    const retryData = await scrapeMainPlTable(page, market);
    if (retryData) {
      const retryMonthly = extractMonthly2026(retryData.headers, retryData.rows);
      retryMonthly.rows = attachAmazonFeeSublinePrefixes(retryMonthly.rows);
      retryMonthly.rows = normalizeExportedRows(retryMonthly.rows);
      retryMonthly.rows = normalizeRowsCurrency(retryMonthly.rows, config.symbol);
      if (findEstimatedPayoutRow(retryMonthly.rows)) {
        monthly.headers = retryMonthly.headers;
        monthly.rows = retryMonthly.rows;
        monthly.months = retryMonthly.months;
      }
    }
  }

  if (!findEstimatedPayoutRow(monthly.rows)) {
    const hasSales = !!getSalesRow(monthly.rows);
    const hasNet = (monthly.rows || []).some((r) => /^Net profit$/i.test(String(r?.[0] || '').trim()));
    if (hasSales && hasNet) {
      // Soften hard-fail: label mismatch / DOM hierarchy quirk — continue with warning.
      console.log(`      ⚠️ Estimated payout label not found — continuing (Sales + Net profit present)`);
    } else {
      return { ok: false, reason: 'missing_estimated_payout_row', row_count: monthly.rows.length };
    }
  }

  // US/CA: refuse scrapes that still look like the previous market (both use $).
  if (config.account === 'us' && navOptions.previousSalesRow) {
    const sales = getSalesRow(monthly.rows);
    if (sales && salesRowsIdentical(sales, navOptions.previousSalesRow)) {
      return {
        ok: false,
        reason: 'duplicate_sales_row_detected',
        row_count: monthly.rows.length,
      };
    }
  }

  return {
    ok: true,
    monthly,
    fee_sublines: amazonFeeSublineNames(monthly.rows),
    missing_fee_sublines: missingRequiredAmazonFeeSublines(monthly.rows),
    missing_optional_fee_sublines: missingOptionalAmazonFeeSublines(monthly.rows),
    scrape_source: mainData.source || 'dom',
  };
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
  
  console.log(`📊 Sellerboard P&L Export v14.2 — ${EXPORT_YEAR} monthly`);
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
  let previousSalesRow = null;
  const networkTracker = createPlNetworkTracker(page);
  
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

      let monthly = null;
      let scrapeResult = null;
      let marketRetries = 0;

      while (marketRetries < MAX_MARKET_SWITCH_RETRIES) {
        marketRetries += 1;
        const attemptLabel = marketRetries === 1 ? 'initial' : `retry-${marketRetries}`;
        console.log(`      🔁 Market scrape attempt ${marketRetries}/${MAX_MARKET_SWITCH_RETRIES} (${attemptLabel})`);

        const nav = await freshNavigate(page, mainUrl, `monthly-pl-${market}-${attemptLabel}`, config, {
          networkTracker,
          previousSalesRow,
        });
        if (!nav?.ok) {
          scrapeResult = { ok: false, reason: 'login_redirect_unresolved' };
          break;
        }

        if (config.needsUiMarketSelect && !nav.uiMarketSelected) {
          console.log(`      ⚠️ UI market chip mist for ${market} — retry switch`);
          await debugLog(
            page,
            `market-ui-required-${market}-try${marketRetries}`,
            `⚠️ needsUiMarketSelect but chip click mist attempt ${marketRetries}/${MAX_MARKET_SWITCH_RETRIES}`,
            true,
          );
          if (marketRetries < MAX_MARKET_SWITCH_RETRIES) continue;
          scrapeResult = {
            ok: false,
            reason: 'market_ui_select_failed',
            retries: marketRetries,
          };
          monthly = null;
          break;
        }

        scrapeResult = await scrapeMarketMonthlyPl(page, market, config, {
          networkTracker,
          previousSalesRow,
        });
        if (!scrapeResult.ok) {
          // Allow zero/duplicate failures to retry market switch (esp. USA→CA).
          if (
            ['zero_export_detected', 'duplicate_sales_row_detected', 'currency_mismatch_eur_on_us'].includes(scrapeResult.reason)
            && marketRetries < MAX_MARKET_SWITCH_RETRIES
          ) {
            console.log(`      ⚠️ ${scrapeResult.reason} — retrying UI market select for ${market}`);
            if (scrapeResult.reason === 'currency_mismatch_eur_on_us') {
              const forced = await ensureCorrectAccount(page, 'us', 'eu');
              if (forced.ok) currentAccount = 'us';
            }
            await selectMarketInUi(page, config, { networkTracker, previousSalesRow });
            continue;
          }
          break;
        }

        monthly = scrapeResult.monthly;
        const currentSalesRow = getSalesRow(monthly.rows);
        let needsRetry = false;
        let retryReason = null;

        if (previousSalesRow && currentSalesRow && salesRowsIdentical(currentSalesRow, previousSalesRow)) {
          const janPrev = previousSalesRow[1] || '';
          const janCurr = currentSalesRow[1] || '';
          console.log(`      ⚠️ Duplicate Sales snapshot (${previousMarket} -> ${market}) jan ${janPrev} == ${janCurr}`);
          await debugLog(
            page,
            `dup-sales-${market}-try${marketRetries}`,
            `⚠️ Duplicate Sales row (${previousMarket} -> ${market}) attempt ${marketRetries}/${MAX_MARKET_SWITCH_RETRIES}`,
            true,
          );
          needsRetry = true;
          retryReason = 'duplicate_sales_row_detected';
        }

        if (isZeroExport(monthly.rows, monthly.months)) {
          console.log(`      ❌ Zero Sales export — alle (completed) maanden Sales = 0 voor ${market}`);
          await debugLog(
            page,
            `zero-export-${market}-try${marketRetries}`,
            `❌ Zero Sales export voor ${market} attempt ${marketRetries}/${MAX_MARKET_SWITCH_RETRIES}`,
            true,
          );
          needsRetry = true;
          retryReason = retryReason || 'zero_export_detected';
        }

        if (needsRetry) {
          if (marketRetries < MAX_MARKET_SWITCH_RETRIES) {
            await selectMarketInUi(page, config, { networkTracker, previousSalesRow });
            continue;
          }
          scrapeResult = {
            ok: false,
            reason: retryReason,
            previous_market: previousMarket,
            retries: marketRetries,
          };
          monthly = null;
          break;
        }

        break;
      }

      if (!scrapeResult?.ok || !monthly) {
        const reason = scrapeResult?.reason || 'unknown_scrape_failure';
        if (reason === 'login_redirect_unresolved') summary[market] = '❌ Login redirect';
        else if (reason === 'empty_export') summary[market] = '❌ Lege export';
        else if (reason === 'no_table_data') summary[market] = '❌ Geen data';
        else if (reason === 'missing_estimated_payout_row') summary[market] = '❌ Missing Estimated payout';
        else if (reason === 'duplicate_sales_row_detected') summary[market] = '❌ Duplicate Sales row';
        else if (reason === 'zero_export_detected') summary[market] = '❌ Zero export';
        else if (reason === 'market_ui_select_failed') summary[market] = '❌ Market UI select';
        else if (reason === 'currency_mismatch_eur_on_us') summary[market] = '❌ € on US market';
        else summary[market] = `❌ ${reason}`;
        details[market] = { ok: false, reason, ...scrapeResult };
        hardFailures++;
        continue;
      }

      // Defense in depth: never upload all-zero Sales even after loop exit
      if (isZeroExport(monthly.rows, monthly.months)) {
        summary[market] = '❌ Zero export';
        details[market] = {
          ok: false,
          reason: 'zero_export_detected',
          retries: marketRetries,
          symbols: detectCurrencySymbols(monthly.rows),
        };
        hardFailures++;
        continue;
      }

      const suspiciousZeros = findSuspiciousZeroMonths(monthly);
      if (suspiciousZeros.length) {
        console.log(`      ⚠️ Soft zero-month warnings: ${suspiciousZeros.join('; ')}`);
      }

      const beforeSymbols = detectCurrencySymbols(monthly.rows);
      const afterSymbols = detectCurrencySymbols(monthly.rows);

      const payoutRow = findEstimatedPayoutRow(monthly.rows);
      console.log(`      📅 Maanden: ${monthly.months.join(', ')}`);
      console.log(`      💱 Currency ${config.currency}: symbols ${beforeSymbols.join(',') || 'none'} -> ${afterSymbols.join(',') || 'none'}`);
      console.log(`      💰 Estimated payout jan: ${(payoutRow?.[1] || 'n/a').substring(0, 30)}`);

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
        currency: config.currency,
        estimated_payout_jan: payoutRow?.[1] || null,
        sales_jan: getSalesRow(monthly.rows)?.[1] || null,
        market_retries: marketRetries,
        zero_month_warnings: suspiciousZeros,
        fee_sublines: scrapeResult.fee_sublines || amazonFeeSublineNames(monthly.rows),
        missing_fee_sublines: scrapeResult.missing_fee_sublines || missingRequiredAmazonFeeSublines(monthly.rows),
        scrape_source: scrapeResult.scrape_source || null,
      };
      totalRowsExported += monthly.rows.length;
      previousMarket = market;
      previousSalesRow = getSalesRow(monthly.rows);
    }
    
  } finally {
    networkTracker.detach();
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

module.exports.attachAmazonFeeSublinePrefixes = attachAmazonFeeSublinePrefixes;
module.exports.parseSellerboardCsvText = parseSellerboardCsvText;
module.exports.missingRequiredAmazonFeeSublines = missingRequiredAmazonFeeSublines;
module.exports.amazonFeeSublineNames = amazonFeeSublineNames;
module.exports.extractMonthly2026 = extractMonthly2026;

function runFeeSublineSelfTest() {
  const sample = path.join(__dirname, 'csv-downloads', 'main_pl_Amazon_de_sb-1776948343178.csv');
  if (!fs.existsSync(sample)) {
    console.log('SELFTEST_SKIP|no sample CSV');
    return 0;
  }
  const parsed = parseSellerboardCsvText(fs.readFileSync(sample, 'utf8'));
  const monthly = extractMonthly2026(parsed.headers, parsed.rows);
  const rows = attachAmazonFeeSublinePrefixes(monthly.rows);
  const missing = missingRequiredAmazonFeeSublines(rows);
  const missingOptional = missingOptionalAmazonFeeSublines(rows);
  const names = amazonFeeSublineNames(rows);
  console.log(`SELFTEST_OK|fee_sublines=${names.length}|missing=${missing.join(',') || 'none'}|optional_missing=${missingOptional.join(',') || 'none'}`);
  console.log(names.slice(0, 8).map((n) => `Amazon fees > ${n}`).join('\n'));
  if (missing.length) {
    throw new Error(`SELFTEST_FAIL|missing_required=${missing.join(',')}`);
  }
  if (missingOptional.length) {
    console.log(`SELFTEST_WARN|optional_absent=${missingOptional.join(',')} (ok)`);
  }
  const referral = rows.find((r) => /^Amazon fees > Referral fee$/i.test(r[0]));
  if (!referral) throw new Error('SELFTEST_FAIL|missing Referral fee prefix row');
  const payout = findEstimatedPayoutRow(rows);
  if (!payout) throw new Error('SELFTEST_FAIL|missing Estimated payout');

  // Simulate DOM pad false-positive: top-level rows wrongly indented under Amazon fees.
  const bogus = attachAmazonFeeSublinePrefixes([
    ['Amazon fees', '1'],
    ['    Referral fee', '2'],
    ['    Estimated payout', '3'],
    ['    Net profit', '4'],
  ]);
  if (!findEstimatedPayoutRow(bogus)) throw new Error('SELFTEST_FAIL|payout not promoted from false indent');
  if (!bogus.some((r) => /^Net profit$/i.test(r[0]))) throw new Error('SELFTEST_FAIL|Net profit dropped');
  console.log('SELFTEST_OK|false-indent promotion');
  return 0;
}

if (require.main === module) {
  if (process.argv.includes('--self-test-fee-sublines')) {
    try {
      process.exit(runFeeSublineSelfTest());
    } catch (err) {
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    }
  } else {
    main().catch(err => {
      console.error(`\n❌ Fatal error: ${err.message}`);
      process.exit(1);
    });
  }
}
