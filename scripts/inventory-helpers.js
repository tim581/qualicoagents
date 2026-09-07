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
const PRODUCT_BY_EAN = Object.fromEntries(PRODUCT_CATALOG.map((p) => [p.ean, p]));
const COGS_BY_PRODUCT = Object.fromEntries(
  PRODUCT_CATALOG.filter((p) => p.cogs_product_name).map((p) => [p.product_name, p.cogs_product_name])
);

/** Cached Supabase name→EAN lookups (Product_Name_Mapping + flieber_product_skus). */
let _portalMappingsCache = null;
let _portalMappingsLoadedAt = 0;
/** Cached EAN → units_per_master from Puzzlup_Product_Info (master carton table). */
let _upmByEan = null;
let _upmLoadedAt = 0;
const PORTAL_MAPPINGS_TTL_MS = 15 * 60 * 1000;

const PORTAL_ALIASES = {
  'puzzlup 1000 gift': 'PUZZLUP 1000 GIFT',
  'puzzleup 1000 gift': 'PUZZLUP 1000 GIFT',
  'mat 1000 gift': 'PUZZLUP 1000 GIFT',
  '1000 gift': 'PUZZLUP 1000 GIFT',
  'puzzlup 1500 gift': 'PUZZLUP 1500 GIFT',
  'puzzleup 1500 gift': 'PUZZLUP 1500 GIFT',
  'mat 1500 gift': 'PUZZLUP 1500 GIFT',
  '1500 gift': 'PUZZLUP 1500 GIFT',
  'puzzlup 1500 eco': 'PUZZLUP 1500 ECO',
  'puzzleup 1500 eco': 'PUZZLUP 1500 ECO',
  'mat 1500 eco': 'PUZZLUP 1500 ECO',
  '1500 eco': 'PUZZLUP 1500 ECO',
  'puzzlup 1500 lux': '1500 MAT LUX',
  'puzzleup 1500 lux': '1500 MAT LUX',
  'mat 1500 lux': '1500 MAT LUX',
  '1500 lux': '1500 MAT LUX',
  '1500 mat lux': '1500 MAT LUX',
  'mat 1500 luxury': '1500 MAT LUX',
  '1500 mat luxury': '1500 MAT LUX',
  '1500 luxury': '1500 MAT LUX',
  'puzzlup 3000 gift': 'PUZZLUP 3000 GIFT',
  'puzzleup 3000 gift': 'PUZZLUP 3000 GIFT',
  'mat 3000 gift': 'PUZZLUP 3000 GIFT',
  'puzzlup mat 3000 gift': 'PUZZLUP 3000 GIFT',
  'puzzlup mat 3000gift': 'PUZZLUP 3000 GIFT',
  '3000 gift': 'PUZZLUP 3000 GIFT',
  '3000gift': 'PUZZLUP 3000 GIFT',
  'puzzlup 3000 eco': 'PUZZLUP 3000 ECO',
  'puzzleup 3000 eco': 'PUZZLUP 3000 ECO',
  'mat 3000 eco': 'PUZZLUP 3000 ECO',
  'puzzlup mat 3000 eco': 'PUZZLUP 3000 ECO',
  '3000 eco': 'PUZZLUP 3000 ECO',
  '3000eco': 'PUZZLUP 3000 ECO',
  'puzzlup 5000 gift': 'PUZZLUP 5000 GIFT',
  'puzzleup 5000 gift': 'PUZZLUP 5000 GIFT',
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
  'trays double set black 3000': 'TRAYS 3000 BLACK',
  'trays double set 3000 black': 'TRAYS 3000 BLACK',
  'tray double set black 3000': 'TRAYS 3000 BLACK',
  '1500 mat white': '1500 MAT WHITE',
  // Mintsoft / Seller Central SKU codes
  'uk_1500_mat': 'PUZZLUP 1500 GIFT',
  'uk_1500_eco': 'PUZZLUP 1500 ECO',
  'uk_1500_lux': '1500 MAT LUX',
  'uk_3000_mat': 'PUZZLUP 3000 GIFT',
  'uk_3000_eco': 'PUZZLUP 3000 ECO',
  'uk_1000_mat': 'PUZZLUP 1000 GIFT',
  'puzzlup_tray_1500': 'TRAYS 1500 BLACK',
  'puzzlup_tray_1500_black': 'TRAYS 1500 BLACK',
  'puzzlup_tray_1500_white': 'TRAYS 1500 WHITE',
  'puzzlup_tray_3000': 'TRAYS 3000 BLACK',
  'puzzl_tray_uk': 'TRAYS 1500 BLACK',
  'tray_1500_black': 'TRAYS 1500 BLACK',
  'tray_1500_white': 'TRAYS 1500 WHITE',
  'tray_3000_black': 'TRAYS 3000 BLACK',
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

/** Briefing format: { source, synced_at, success, inventory[] } */
function writeSourceInventoryJson(filename, { source, inventory, success = true, error = null }) {
  ensureResultsDir();
  const file = path.join(RESULTS_DIR, filename);
  const payload = {
    source,
    synced_at: new Date().toISOString(),
    success: success && !error,
    ...(error ? { error } : {}),
    inventory: (inventory || []).map((item) => ({
      ean: item.ean || null,
      product_name: item.product_name,
      on_hand: Number(item.on_hand) || 0,
      ...(item.available_qty != null ? { available_qty: item.available_qty } : {}),
      ...(item.country ? { country: item.country } : {}),
      ...(item.channel ? { channel: item.channel } : {}),
      ...(item.region ? { region: item.region } : {}),
      ...(item.warehouse ? { warehouse: item.warehouse } : {}),
      ...(item.missing ? { missing: true } : {}),
    })),
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

function normalizePortalText(text) {
  return String(text || '')
    .split(',')[0]
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/(\d)(gift|eco|lux)/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/puzzleup/g, 'puzzlup');
}

function catalogEntryByEan(ean) {
  if (!ean) return null;
  return PRODUCT_BY_EAN[String(ean)] || null;
}

function productNameFromEan(ean) {
  return catalogEntryByEan(ean)?.product_name || null;
}

async function loadPortalNameMappings() {
  const now = Date.now();
  if (_portalMappingsCache && now - _portalMappingsLoadedAt < PORTAL_MAPPINGS_TTL_MS) {
    return _portalMappingsCache;
  }

  const byName = new Map();
  const byEan = new Map();
  const supabaseKey = process.env.SUPABASE_KEY;

  if (supabaseKey) {
    try {
      const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      const mappingRes = await fetch(
        `${SUPABASE_URL}/rest/v1/Product_Name_Mapping?select=source_name,canonical_name,ean`,
        { headers }
      );
      if (mappingRes.ok) {
        for (const row of await mappingRes.json()) {
          const ean = row.ean ? String(row.ean) : null;
          if (!ean) continue;
          const key = normalizePortalText(row.source_name);
          if (key) byName.set(key, ean);
        }
      }

      const skuRes = await fetch(
        `${SUPABASE_URL}/rest/v1/flieber_product_skus?select=flieber_product_name,flieber_product_code,flieber_skus`,
        { headers }
      );
      if (skuRes.ok) {
        for (const row of await skuRes.json()) {
          const code = row.flieber_product_code;
          if (/^541998\d{7}$/.test(String(code || ''))) {
            byEan.set(String(code), String(code));
          }
          const aliases = [row.flieber_product_name, ...(row.flieber_skus || [])];
          for (const alias of aliases) {
            const key = normalizePortalText(alias);
            if (key && code && /^541998\d{7}$/.test(String(code))) {
              byName.set(key, String(code));
            }
          }
        }
      }
    } catch (err) {
      console.warn(`⚠️ loadPortalNameMappings failed: ${err.message}`);
    }
  }

  _portalMappingsCache = { byName, byEan };
  _portalMappingsLoadedAt = now;
  return _portalMappingsCache;
}

/** Load units_per_master from Puzzlup_Product_Info (SSOT master carton table). */
async function loadMasterCartonFactors() {
  const now = Date.now();
  if (_upmByEan && now - _upmLoadedAt < PORTAL_MAPPINGS_TTL_MS) {
    return _upmByEan;
  }

  const map = new Map();
  for (const p of PRODUCT_CATALOG) {
    if (p.ean && p.units_per_master != null) map.set(String(p.ean), p.units_per_master);
  }

  const supabaseKey = process.env.SUPABASE_KEY;
  if (supabaseKey) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/Puzzlup_Product_Info?select=ean,units_per_master&ean=not.is.null`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      if (res.ok) {
        for (const row of await res.json()) {
          const ean = row.ean ? String(row.ean) : '';
          if (ean && row.units_per_master != null) map.set(ean, row.units_per_master);
        }
      }
    } catch (err) {
      console.warn(`⚠️ loadMasterCartonFactors failed: ${err.message}`);
    }
  }

  _upmByEan = map;
  _upmLoadedAt = now;
  return map;
}

/** Colli → units factor by EAN (Puzzlup_Product_Info), fallback to static catalog. */
function getUnitsPerMaster(ean, productName) {
  if (ean && _upmByEan?.has(String(ean))) return _upmByEan.get(String(ean));
  const meta = PRODUCT_CATALOG.find((p) => p.product_name === productName);
  return meta?.units_per_master ?? 1;
}

/**
 * Resolve messy portal text → canonical { ean, product_name }.
 * EAN is required — returns null when unresolved.
 */
function resolveProductFromText(text, dbMappings = null) {
  if (!text) return null;
  const raw = String(text).trim();

  const eanMatch = raw.match(/\b(541998\d{7})\b/);
  if (eanMatch) {
    const entry = catalogEntryByEan(eanMatch[1]);
    if (entry) return { ean: entry.ean, product_name: entry.product_name };
  }

  const normalized = normalizePortalText(raw);
  if (PORTAL_ALIASES[normalized]) {
    const product_name = PORTAL_ALIASES[normalized];
    const ean = EAN_BY_PRODUCT[product_name];
    if (ean) return { ean, product_name };
  }

  if (dbMappings?.byName?.has(normalized)) {
    const ean = dbMappings.byName.get(normalized);
    const product_name = productNameFromEan(ean);
    if (product_name) return { ean, product_name };
  }

  for (const [alias, product_name] of Object.entries(PORTAL_ALIASES)) {
    if (normalized.includes(alias)) {
      const ean = EAN_BY_PRODUCT[product_name];
      if (ean) return { ean, product_name };
    }
  }

  if (dbMappings?.byName) {
    for (const [alias, ean] of dbMappings.byName.entries()) {
      if (normalized.includes(alias) || alias.includes(normalized)) {
        const product_name = productNameFromEan(ean);
        if (product_name) return { ean, product_name };
      }
    }
  }

  const upper = raw.toUpperCase();
  const direct = PRODUCT_CATALOG.find((p) => p.product_name === upper);
  if (direct) return { ean: direct.ean, product_name: direct.product_name };

  return null;
}

function matchProductName(text, dbMappings = null) {
  return resolveProductFromText(text, dbMappings)?.product_name || null;
}

function getProductMeta(productName) {
  const entry = PRODUCT_CATALOG.find((p) => p.product_name === productName);
  if (!entry) return null;
  const upm = getUnitsPerMaster(entry.ean, productName);
  return { ...entry, units_per_master: upm };
}

function classifyForcegetWarehouse(warehouseText) {
  const lower = String(warehouseText || '').toLowerCase();
  // LA Perris (USA) — distinct from Toronto; same EAN may exist in both.
  if (
    lower.includes('perris') ||
    lower.includes('la perris') ||
    (lower.includes('los angeles') && !lower.includes('toronto'))
  ) {
    return { country: 'US', channel: '3PL US', region: 'US', warehouse: 'Forceget LA Perris' };
  }
  if (lower.includes('toronto') || lower.includes('canada') || /\bca\b/.test(lower)) {
    return { country: 'CA', channel: '3PL CA', region: 'Canada', warehouse: 'Forceget Toronto' };
  }
  if (
    lower.includes('new york') ||
    lower.includes('united states') ||
    lower.includes('usa') ||
    /\bus\b/.test(lower) ||
    lower.includes('america') ||
    lower.includes('los angeles')
  ) {
    return { country: 'US', channel: '3PL US', region: 'US', warehouse: 'Forceget LA Perris' };
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
  ean,
  on_hand,
  country,
  channel,
  region,
  warehouse,
  colli,
  units_per_master,
  available_qty,
  missing = false,
  raw_name,
}) {
  const resolvedEan = ean || EAN_BY_PRODUCT[product_name] || null;
  const catalog = catalogEntryByEan(resolvedEan);
  const canonicalName = catalog?.product_name || product_name;

  return {
    ean: resolvedEan,
    product_name: canonicalName,
    on_hand: Number(on_hand) || 0,
    ...(colli != null ? { colli } : {}),
    ...(units_per_master != null ? { units_per_master } : {}),
    ...(available_qty != null ? { available_qty } : {}),
    country,
    channel,
    region,
    ...(warehouse ? { warehouse } : {}),
    ...(missing ? { missing: true } : {}),
    ...(raw_name ? { raw_name } : {}),
  };
}

module.exports = {
  RESULTS_DIR,
  SUPABASE_URL,
  PRODUCT_CATALOG,
  EAN_BY_PRODUCT,
  PRODUCT_BY_EAN,
  COGS_BY_PRODUCT,
  resultPath,
  errorScreenshotPath,
  writeWarehouseJson,
  writeWarehouseError,
  writeSourceInventoryJson,
  readResultJson,
  toJsonProduct,
  saveErrorScreenshot,
  normalizePortalText,
  loadPortalNameMappings,
  loadMasterCartonFactors,
  getUnitsPerMaster,
  resolveProductFromText,
  matchProductName,
  getProductMeta,
  classifyForcegetWarehouse,
  fillPassword,
  detectMfaOrCaptcha,
  buildInventoryItem,
};
