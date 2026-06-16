'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

/**
 * flieber-inventory-forecast-sync.js v1.0
 *
 * Opens Flieber inventory forecast (cookie auth), verifies login, then pulls
 * all rows via GraphQL `inventory_forecast` and upserts to Supabase
 * `flieber_inventory_forecast` with Puzzlup product_id mapping.
 *
 * Usage:
 *   node flieber-inventory-forecast-sync.js
 *
 * Cookies: scripts/flieber-auth.json (Playwright format) or path in FLIEBER_COOKIE_FILE
 * GraphQL token: FLIEBER_GRAPHQL_TOKEN env or captured from page network requests
 */

require('dotenv').config();

const FLIEBER_URL = 'https://app.flieber.com/app/inventory-forecast';
const GRAPHQL_URL = 'https://app.flieber.com/api/graphql';
const DEFAULT_COOKIE_FILE = path.join(__dirname, 'flieber-auth.json');
const RUN_ID = `fif_${Date.now()}`;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const INVENTORY_FORECAST_QUERY = `
  query InventoryForecastPage($limit: Int!, $offset: Int!) {
    inventory_forecast(pagination: { limit: $limit, offset: $offset }) {
      items {
        productId
        productName
        productCode
        inventoryLocationId
        inventoryLocationName
        onHandInventoryUnits
        onHandDaysOfStock
        totalInventoryUnits
        totalDaysOfStock
        onOrderInventoryUnits
        onOrderDaysOfStock
        lastStockoutDate
        lastStockoutDateOnHand
        firstStockoutDate
        replenishmentNeedsUnits
        replenishmentType
        inventoryStatus
        inventoryStatusLabel
        tier
        optimalOrderDate
        optimalDeliveryDate
        daysOfStockAtArrival
        totalAvailableAtOriginUnits
        isOnHandOutOfStock
        isTotalOutOfStock
      }
      pageInfo { hasNext }
    }
  }
`;

function loadCookieFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const list = raw.cookies || raw;
  return list.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.expires && c.expires > 0 ? c.expires : c.expirationDate ? Math.floor(c.expirationDate) : undefined,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: c.sameSite === 'None' || c.sameSite === 'no_restriction' ? 'None'
      : c.sameSite === 'Strict' || c.sameSite === 'strict' ? 'Strict' : 'Lax',
  }));
}

async function verifyLoginWithPlaywright(cookies) {
  console.log('🌐 Opening Flieber inventory forecast (Playwright)...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();

  let capturedToken = process.env.FLIEBER_GRAPHQL_TOKEN
    || 'Bearer 019cca1e-4959-72af-8113-f95bb6dba3a1:iJd1NgmpCqzORumpBDNjmQSMTa1LisjrKLPXXM4n1os';

  page.on('request', (req) => {
    if (!req.url().includes('/api/graphql')) return;
    const auth = req.headers()['authorization'];
    if (auth?.startsWith('Bearer ')) capturedToken = auth;
  });

  await page.goto(FLIEBER_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(4000);

  const url = page.url();
  if (url.includes('/sign-in')) {
    await browser.close();
    throw new Error('Flieber login failed — cookies expired. Refresh flieber-auth.json');
  }

  console.log(`✅ Logged in — ${url}`);
  await browser.close();
  return capturedToken;
}

async function gqlFetch(token, variables) {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    },
    body: JSON.stringify({
      operationName: 'InventoryForecastPage',
      query: INVENTORY_FORECAST_QUERY,
      variables,
    }),
  });
  if (!resp.ok) throw new Error(`GraphQL HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors[0].message}`);
  return json.data.inventory_forecast;
}

async function fetchAllInventoryForecast(token) {
  const all = [];
  let offset = 0;
  const limit = 200;
  let hasNext = true;

  while (hasNext) {
    const page = await gqlFetch(token, { limit, offset });
    all.push(...(page.items || []));
    hasNext = page.pageInfo?.hasNext ?? false;
    offset += limit;
    console.log(`  📦 Fetched ${all.length} rows (hasNext: ${hasNext})`);
    if (!page.items?.length) break;
  }
  return all;
}

async function loadProductMapping() {
  const { data, error } = await supabase
    .from('flieber_product_skus')
    .select('id, product_id, flieber_product_name, flieber_product_code');
  if (error) throw error;

  const byName = new Map();
  const byCode = new Map();
  for (const row of data || []) {
    const name = row.flieber_product_name?.toLowerCase().trim();
    const code = row.flieber_product_code?.toLowerCase().trim();
    if (name) byName.set(name, row);
    if (code) byCode.set(code, row);
  }
  return { byName, byCode };
}

function resolveProduct(row, maps) {
  const code = row.productCode?.toLowerCase().trim();
  const name = row.productName?.toLowerCase().trim();

  if (code && maps.byCode.has(code)) return maps.byCode.get(code);
  if (name && maps.byName.has(name)) return maps.byName.get(name);

  for (const [key, val] of maps.byName.entries()) {
    if (name?.includes(key) || key.includes(name?.slice(0, 20) || '')) return val;
  }
  return null;
}

function toDbRow(item, maps, scrapedAt) {
  const mapped = resolveProduct(item, maps);
  return {
    run_id: RUN_ID,
    scraped_at: scrapedAt,
    flieber_product_id: item.productId,
    flieber_product_name: item.productName,
    flieber_product_code: item.productCode || null,
    inventory_location_id: item.inventoryLocationId,
    inventory_location_name: item.inventoryLocationName,
    product_id: mapped?.product_id ?? null,
    flieber_product_skus_id: mapped?.id ?? null,
    on_hand_units: item.onHandInventoryUnits,
    on_hand_days_of_stock: item.onHandDaysOfStock,
    is_on_hand_out_of_stock: item.isOnHandOutOfStock ?? false,
    total_inventory_units: item.totalInventoryUnits,
    total_days_of_stock: item.totalDaysOfStock,
    is_total_out_of_stock: item.isTotalOutOfStock ?? false,
    on_order_units: item.onOrderInventoryUnits,
    on_order_days_of_stock: item.onOrderDaysOfStock,
    last_stockout_date: item.lastStockoutDate || null,
    last_stockout_date_on_hand: item.lastStockoutDateOnHand || null,
    first_stockout_date: item.firstStockoutDate || null,
    replenishment_needs_units: item.replenishmentNeedsUnits,
    replenishment_type: item.replenishmentType || null,
    total_available_at_origin_units: item.totalAvailableAtOriginUnits,
    optimal_order_date: item.optimalOrderDate || null,
    optimal_delivery_date: item.optimalDeliveryDate || null,
    days_of_stock_at_arrival: item.daysOfStockAtArrival,
    inventory_status: item.inventoryStatus || null,
    inventory_status_label: item.inventoryStatusLabel || null,
    tier: item.tier || null,
  };
}

async function writeToSupabase(rows) {
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('flieber_inventory_forecast')
      .upsert(batch, { onConflict: 'run_id,flieber_product_id,inventory_location_id' });
    if (error) throw new Error(`Supabase upsert: ${error.message}`);
  }
}

async function main() {
  console.log(`\n📊 Flieber Inventory Forecast Sync v1.0`);
  console.log(`🔍 Run ID: ${RUN_ID}\n`);

  const cookieFile = process.env.FLIEBER_COOKIE_FILE || DEFAULT_COOKIE_FILE;
  if (!fs.existsSync(cookieFile)) {
    throw new Error(`Cookie file not found: ${cookieFile}`);
  }

  const cookies = loadCookieFile(cookieFile);
  const token = await verifyLoginWithPlaywright(cookies);
  if (!token) {
    throw new Error('No GraphQL bearer token — set FLIEBER_GRAPHQL_TOKEN in .env');
  }

  console.log('\n📡 Fetching inventory_forecast via GraphQL...');
  const items = await fetchAllInventoryForecast(token);
  console.log(`✅ Total rows from Flieber: ${items.length}`);

  const maps = await loadProductMapping();
  const scrapedAt = new Date().toISOString();
  const dbRows = items.map((item) => toDbRow(item, maps, scrapedAt));

  const mapped = dbRows.filter((r) => r.product_id).length;
  console.log(`🔗 Mapped to Puzzlup product_id: ${mapped}/${dbRows.length}`);

  console.log('\n💾 Writing to flieber_inventory_forecast...');
  await writeToSupabase(dbRows);

  const needs = dbRows.filter((r) => (r.replenishment_needs_units || 0) > 0).length;
  const oos = dbRows.filter((r) => r.is_on_hand_out_of_stock).length;
  console.log(`\n✅ Done — ${dbRows.length} rows written`);
  console.log(`   Replenishment needs > 0: ${needs}`);
  console.log(`   On-hand out of stock: ${oos}`);
  console.log(`   Query: SELECT * FROM flieber_inventory_forecast WHERE run_id = '${RUN_ID}';`);
}

main().catch((err) => {
  console.error('\n❌', err.message);
  process.exit(1);
});
