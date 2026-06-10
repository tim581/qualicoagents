/**
 * Supabase REST writes for inventory scrapers (Inventory_Levels)
 * Pattern: DELETE by channel → POST fresh rows
 */
'use strict';

const { SUPABASE_URL, COGS_BY_PRODUCT } = require('./inventory-helpers');

const SUPABASE_KEY = process.env.SUPABASE_KEY;

const CHANNEL_META = {
  forceget: { channel: '3PL CA', source: 'playwright_forceget', region: 'Canada', warehouse: 'Forceget' },
  kamps: { channel: '3PL EU', source: 'playwright_kamps', region: 'Europe', warehouse: 'Kamps' },
  mintsoft: { channel: '3PL UK', source: 'playwright_mintsoft', region: 'UK', warehouse: 'WePrep' },
  us_combined: { channel: '3PL US', source: 'forceget_us_glc', region: 'US', warehouse: 'GLC+Forceget US' },
};

async function fetchCogsMap() {
  const map = new Map();
  if (!SUPABASE_KEY) return map;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/COGS_Landed?region=in.(Europe,UK,US,Canada)&select=product,region,l0_std_cogs_usd,l1_total_per_unit`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) return map;

  for (const row of await res.json()) {
    const l1 = Number(row.l0_std_cogs_usd || 0) + Number(row.l1_total_per_unit || 0);
    map.set(`${row.product}|${row.region}`, l1);
  }
  return map;
}

function enrichRows(items, meta, cogsMap) {
  return items.map((item) => {
    const cogsProduct = COGS_BY_PRODUCT[item.product_name] || item.product_name;
    const cogs = cogsMap.get(`${cogsProduct}|${meta.region}`) ?? null;
    const onHand = Number(item.on_hand) || 0;

    return {
      product_name: item.product_name,
      ean: item.ean || null,
      channel: meta.channel,
      channel_type: '3PL',
      warehouse: meta.warehouse,
      region: meta.region,
      on_hand: onHand,
      on_order: null,
      cogs_per_unit: cogs,
      cogs_level: 'L1',
      inventory_value: cogs != null ? Number((onHand * cogs).toFixed(4)) : null,
      cogs_product_name: cogsProduct,
      source: meta.source,
      last_synced_at: new Date().toISOString(),
    };
  });
}

async function deleteByChannel(channel) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/Inventory_Levels?channel=eq.${encodeURIComponent(channel)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE channel=${channel} failed: ${res.status} ${text}`);
  }
}

async function insertRows(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/Inventory_Levels`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST Inventory_Levels failed: ${res.status} ${text}`);
  }
}

async function writeInventoryToSupabase(metaKey, items) {
  if (!SUPABASE_KEY) {
    console.warn('⚠️ SUPABASE_KEY missing — skipping Supabase write');
    return 0;
  }

  const meta = CHANNEL_META[metaKey];
  if (!meta) throw new Error(`Unknown channel meta: ${metaKey}`);

  const cogsMap = await fetchCogsMap();
  const rows = enrichRows(items, meta, cogsMap);
  if (!rows.length) {
    console.log(`⏭️ No rows for ${meta.channel}`);
    return 0;
  }

  console.log(`💾 ${meta.channel}: DELETE + POST ${rows.length} rows`);
  await deleteByChannel(meta.channel);
  await insertRows(rows);
  return rows.length;
}

function combineUsInventory(forcegetProducts, glcProducts) {
  const totals = new Map();

  for (const item of forcegetProducts || []) {
    if (item.country !== 'US') continue;
    const key = item.ean || item.product_name;
    totals.set(key, { ...item, on_hand: Number(item.on_hand) || 0 });
  }

  for (const item of glcProducts || []) {
    const key = item.ean || item.product_name;
    const qty = item.available_qty != null ? item.available_qty : item.on_hand;
    const prev = totals.get(key);
    if (prev) {
      prev.on_hand += Number(qty) || 0;
    } else {
      totals.set(key, {
        ...item,
        on_hand: Number(qty) || 0,
        country: 'US',
        channel: '3PL US',
        region: 'US',
      });
    }
  }

  return Array.from(totals.values());
}

module.exports = {
  CHANNEL_META,
  writeInventoryToSupabase,
  combineUsInventory,
};
