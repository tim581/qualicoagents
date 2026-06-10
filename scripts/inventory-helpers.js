/**
 * Shared helpers for Playwright inventory scrapers.
 * Each script: scrape → JSON + Supabase only.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'inventory-results');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlteahycfmpiaxdbnlvr.supabase.co';

const PRODUCT_CATALOG = [
  { ean: '5419980414717', product_name: 'PUZZLUP 1000 GIFT', units_per_master: 12, cogs_product_name: 'MAT 1000 GIFT' },
  { ean: '5419980047458', product_name: 'PUZZLUP 1500 GIFT', units_per_master: 10, cogs_product_name: 'MAT 1500 GIFT' },
  { ean: '5419980047489', product_name: 'PUZZLUP 1500 ECO', units_per_master: 10, cogs_product_name: 'MAT 1500 ECO' },
  { ean: '5419980047427', product_name: 'QUALICO 1500', units_per_master: 10, cogs_product_name: 'QUALICO 1500' },
  { ean: '5419980414731', product_name: '1500 MAT WHITE', units_per_master: 12, cogs_product_name: 'MAT 1500 WHITE' },
  { ean: '5419980414748', product_name: '1500 MAT LUX', units_per_master: 10, cogs_product_name: 'MAT 1500 LUX' },
  { ean: '5419980047465', product_name: 'PUZZLUP 3000 GIFT', units_per_master: 6, cogs_product_name: 'MAT 3000 GIFT' },
  { ean: '5419980047472', product_name: 'PUZZLUP 3000 ECO', units_per_master: 9, cogs_product_name: 'MAT 3000 ECO' },
  { ean: '5419980047441', product_name: 'QUALICO 3000', units_per_master: 6, cogs_product_name: 'QUALICO 3000' },
  { ean: '5419980414724', product_name: 'PUZZLUP 5000 GIFT', units_per_master: 6, cogs_product_name: 'MAT 5000 GIFT' },
  { ean: '5419980414700', product_name: 'TRAYS 1500 BLACK', units_per_master: 8, cogs_product_name: 'TRAYS 1500 BLACK' },
  { ean: '5419980414779', product_name: 'TRAYS 1500 WHITE', units_per_master: 8, cogs_product_name: 'TRAYS 1500 WHITE' },
  { ean: '5419980414762', product_name: 'TRAYS 3000 BLACK', units_per_master: 4, cogs_product_name: 'TRAYS 3000 BLACK' },
  { ean: '5419980047496', product_name: 'PUZZL BOARD 1500', units_per_master: null, cogs_product_name: null },
  { ean: '5419980414755', product_name: 'BAG LUX 1500', units_per_master: null, cogs_product_name: null },
  { ean: '5419980047410', product_name: 'SS175', units_per_master: null, cogs_product_name: null },
];

const EAN_BY_PRODUCT = Object.fromEntries(PRODUCT_CATALOG.map((p) => [p.product_name, p.ean]));
const COGS_BY_PRODUCT = Object.fromEntries(
  PRODUCT_CATALOG.filter((p) => p.cogs_product_name).map((p) => [p.product_name, p.cogs_product_name])
);

const PORTAL_ALIASES = {
  'puzzlup 1000 gift': 'PUZZLUP 1000 GIFT',
  'mat 1000 gift': 'PUZZLUP 1000 GIFT',
  '1000 gift': 'PUZZLUP 1000 GIFT',
  'puzzlup 1500 gift': 'PUZZLUP 1500 GIFT',
  'mat 1500 gift': 'PUZZLUP 1500 GIFT',
  '1500 gift': 'PUZZLUP 1500 GIFT',
  'puzzlup 1500 eco': 'PUZZLUP 1500 ECO',
  'mat 1500 eco': 'PUZZLUP 1500 ECO',
  '1500 eco': 'PUZZLUP 1500 ECO',
  'puzzlup 1500 lux': '1500 MAT LUX',
  'mat 1500 lux': '1500 MAT LUX',
  '1500 lux': '1500 MAT LUX',
  '1500 mat lux': '1500 MAT LUX',
  'puzzlup 3000 gift': 'PUZZLUP 3000 GIFT',
  'mat 3000 gift': 'PUZZLUP 3000 GIFT',
  '3000 gift': 'PUZZLUP 3000 GIFT',
  'puzzlup 3000 eco': 'PUZZLUP 3000 ECO',
  'mat 3000 eco': 'PUZZLUP 3000 ECO',
  '3000 eco': 'PUZZLUP 3000 ECO',
  'puzzlup 5000 gift': 'PUZZLUP 5000 GIFT',
  'mat 5000 gift': 'PUZZLUP 5000 GIFT',
  '5000 gift': 'PUZZLUP 5000 GIFT',
  'qualico 1500': 'QUALICO 1500',
  'qualico 3000': 'QUALICO 3000',
  'trays 1500 black': 'TRAYS 1500 BLACK',
  'tray 1500 black': 'TRAYS 1500 BLACK',
  'puzzlup tray 1500': 'TRAYS 1500 BLACK',
  'trays 1500 white': 'TRAYS 1500 WHITE',
  'tray 1500 white': 'TRAYS 1500 WHITE',
  'trays 3000 black': 'TRAYS 3000 BLACK',
  'tray 3000 black': 'TRAYS 3000 BLACK',
  'puzzlup tray 3000': 'TRAYS 3000 BLACK',
  '1500 mat white': '1500 MAT WHITE',
};

function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function resultPath(warehouse) {
  ensureResultsDir();
  return path.join(RESULTS_DIR, `${warehouse}.json`);
}

function errorScreenshotPath(warehouse) {
  ensureResultsDir();
  return path.join(RESULTS_DIR, `${warehouse}-error.png`);
}

/** Tasklet pickup format: { warehouse, updated_at, products } */
function toJsonProduct(item) {
  const row = {
    ean: item.ean || null,
    product_name: item.product_name,
    on_hand: Number(item.on_hand) || 0,
  };
  if (item.country) row.country = item.country;
  if (item.available_qty != null) row.available_qty = item.available_qty;
  if (item.colli != null) row.colli = item.colli;
  if (item.units_per_master != null) row.units_per_master = item.units_per_master;
  if (item.missing) row.missing = true;
  return row;
}

function writeWarehouseJson(filename, channel, products) {
  ensureResultsDir();
  const file = resultPath(filename);
  const payload = {
    warehouse: channel,
    updated_at: new Date().toISOString(),
    products: (products || []).map(toJsonProduct),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function writeWarehouseError(filename, channel, error) {
  ensureResultsDir();
  const file = resultPath(filename);
  const payload = {
    warehouse: channel,
    updated_at: new Date().toISOString(),
    error,
    products: [],
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function readResultJson(filename) {
  const file = resultPath(filename);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function saveErrorScreenshot(page, source) {
  if (!page) return null;
  try {
    const file = errorScreenshotPath(source);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return null;
  }
}

function matchProductName(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const upper = raw.toUpperCase();

  const eanMatch = raw.match(/\b(541998\d{7})\b/);
  if (eanMatch) {
    const byEan = PRODUCT_CATALOG.find((p) => p.ean === eanMatch[1]);
    if (byEan) return byEan.product_name;
  }

  const lower = raw.toLowerCase().trim();
  if (PORTAL_ALIASES[lower]) return PORTAL_ALIASES[lower];

  for (const [alias, name] of Object.entries(PORTAL_ALIASES)) {
    if (lower.includes(alias)) return name;
  }

  const direct = PRODUCT_CATALOG.find((p) => p.product_name === upper);
  if (direct) return direct.product_name;

  return null;
}

function getProductMeta(productName) {
  return PRODUCT_CATALOG.find((p) => p.product_name === productName) || null;
}

function classifyForcegetWarehouse(warehouseText) {
  const lower = String(warehouseText || '').toLowerCase();
  if (lower.includes('toronto') || lower.includes('canada') || /\bca\b/.test(lower)) {
    return { country: 'CA', channel: '3PL CA', region: 'Canada' };
  }
  if (
    lower.includes('los angeles') ||
    lower.includes('new york') ||
    lower.includes('united states') ||
    lower.includes('usa') ||
    /\bus\b/.test(lower) ||
    lower.includes('america')
  ) {
    return { country: 'US', channel: '3PL US', region: 'US' };
  }
  return null;
}

async function fillPassword(page, selector, password) {
  await page.evaluate(
    ({ sel, pw }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, pw);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { sel: selector, pw: password }
  );
}

async function detectMfaOrCaptcha(page) {
  const body = await page.evaluate(() => document.body.innerText || '');
  const url = page.url();
  const patterns = [
    /more information required/i,
    /verify your identity/i,
    /authenticator/i,
    /approve sign in/i,
    /verification code/i,
    /captcha/i,
    /robot/i,
  ];
  if (patterns.some((p) => p.test(body)) || (url.includes('microsoftonline') && /verify|code|approve/i.test(body))) {
    return true;
  }
  return false;
}

function buildInventoryItem({
  product_name,
  on_hand,
  country,
  channel,
  region,
  colli,
  units_per_master,
  available_qty,
  missing = false,
}) {
  const meta = getProductMeta(product_name);
  return {
    ean: meta?.ean || EAN_BY_PRODUCT[product_name] || null,
    product_name,
    on_hand: Number(on_hand) || 0,
    ...(colli != null ? { colli } : {}),
    ...(units_per_master != null ? { units_per_master } : {}),
    ...(available_qty != null ? { available_qty } : {}),
    country,
    channel,
    region,
    ...(missing ? { missing: true } : {}),
  };
}

module.exports = {
  RESULTS_DIR,
  SUPABASE_URL,
  PRODUCT_CATALOG,
  EAN_BY_PRODUCT,
  COGS_BY_PRODUCT,
  resultPath,
  errorScreenshotPath,
  writeWarehouseJson,
  writeWarehouseError,
  readResultJson,
  toJsonProduct,
  saveErrorScreenshot,
  matchProductName,
  getProductMeta,
  classifyForcegetWarehouse,
  fillPassword,
  detectMfaOrCaptcha,
  buildInventoryItem,
};
