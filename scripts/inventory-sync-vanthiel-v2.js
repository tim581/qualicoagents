/**
 * inventory-sync-vanthiel-v2.js
 *
 * Canonical Corax/Vanthiel inventory writer.
 *
 * Source values are COLLI. This task reads every portal page, resolves each
 * source row to a unique EAN, aggregates duplicate articles by EAN, converts
 * only with Puzzlup_Product_Info.units_per_master, then calls one atomic DB RPC.
 *
 * It is intentionally self-contained so the running executor can download it
 * as a new task without relying on the legacy Kamps scripts.
 */
'use strict';

const CORAX_URL = 'https://kampspijnacker.coraxwms.nl';
const MAX_PORTAL_PAGES = 50;

function text(value) {
  return String(value ?? '').trim();
}

function normalizePortalName(value) {
  return text(value)
    .split(/,\s*(?=ean\b)/i)[0]
    .split(',')[0]
    .replace(/puzzleup/gi, 'puzzlup')
    .replace(/([a-z])(\d)/gi, '$1 $2')
    .replace(/(\d)([a-z])/gi, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractEan(rawName) {
  const matches = [...text(rawName).matchAll(/\b(\d{13})\b/g)].map((match) => match[1]);
  const unique = [...new Set(matches)];
  if (unique.length > 1) {
    throw new Error(`Corax row contains multiple EANs: ${rawName}`);
  }
  return unique[0] || null;
}

function parseColliCell(value) {
  const raw = text(value);
  if (!raw) return 0;
  const match = raw.match(/^(-?\d+)\s*(colli|koli)\b/i);
  if (!match) {
    throw new Error(`Expected a COLLI quantity, received: ${raw}`);
  }
  const quantity = Number(match[1]);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error(`Invalid COLLI quantity: ${raw}`);
  }
  return quantity;
}

function buildMasterByEan(masterRows) {
  const byEan = new Map();
  for (const row of masterRows || []) {
    const ean = text(row.ean);
    const unitsPerMaster = Number(row.units_per_master);
    if (!/^\d{13}$/.test(ean)) throw new Error(`Invalid master EAN: ${ean || '(blank)'}`);
    if (!Number.isSafeInteger(unitsPerMaster) || unitsPerMaster <= 0) {
      throw new Error(`Missing/invalid units_per_master for EAN ${ean}`);
    }
    if (byEan.has(ean)) throw new Error(`Duplicate selling product-master EAN: ${ean}`);
    byEan.set(ean, {
      ean,
      sku: text(row.sku),
      product_type: text(row.product_type).toUpperCase(),
      brand: text(row.brand).toUpperCase(),
      color: text(row.color).toUpperCase(),
      version: text(row.version).toUpperCase(),
      size: text(row.size),
      units_per_master: unitsPerMaster,
    });
  }
  if (byEan.size === 0) throw new Error('No eligible selling products in product master');
  return byEan;
}

function buildCoraxAliasIndex(mappingRows, masterByEan) {
  const aliases = new Map();
  for (const row of mappingRows || []) {
    if (text(row.source).toLowerCase() !== 'corax') continue;
    const ean = text(row.ean);
    const key = normalizePortalName(row.source_name);
    if (!key || !masterByEan.has(ean)) continue;
    if (!aliases.has(key)) aliases.set(key, new Set());
    aliases.get(key).add(ean);
  }
  return aliases;
}

function inferMasterCandidates(rawName, masterByEan) {
  const normalized = normalizePortalName(rawName);
  if (!normalized) return [];

  const hasQualico = /\bqualico\b/.test(normalized);
  const hasPuzzlup = /\bpuzzlup\b/.test(normalized);
  const brand = hasQualico ? 'QUALICO' : hasPuzzlup ? 'PUZZLUP' : null;
  const productType = /\btray(?:s)?\b/.test(normalized)
    ? 'TRAY'
    : /\bmat\b/.test(normalized)
      ? 'MAT'
      : null;
  const sizeMatch = normalized.match(/\b(1000|1500|3000|5000)\b/);
  const versionMatch = normalized.match(/\b(gift|eco|lux)\b/i);
  const colorMatch = normalized.match(/\b(black|white)\b/i);

  // A generic packaging row (for example "Q1, Ompak dozen Qualico") must
  // never resolve to a sellable product merely because it names a brand.
  if (!sizeMatch) return [];

  return [...masterByEan.values()].filter((candidate) => {
    if (brand && candidate.brand !== brand) return false;
    if (productType && candidate.product_type !== productType) return false;
    if (sizeMatch && candidate.size !== sizeMatch[1]) return false;
    if (versionMatch && candidate.version !== versionMatch[1].toUpperCase()) return false;
    if (colorMatch && candidate.color !== colorMatch[1].toUpperCase()) return false;
    return true;
  });
}

function resolveCoraxRow(rawName, masterByEan, aliasIndex) {
  const sourceEan = extractEan(rawName);
  if (sourceEan) {
    const master = masterByEan.get(sourceEan);
    if (!master) throw new Error(`Corax EAN is not an eligible selling product: ${sourceEan}`);
    return master;
  }

  const normalized = normalizePortalName(rawName);
  const exact = aliasIndex.get(normalized);
  if (exact?.size === 1) return masterByEan.get([...exact][0]);
  if (exact?.size > 1) throw new Error(`Ambiguous exact Corax alias: ${rawName}`);

  const inferred = inferMasterCandidates(rawName, masterByEan);
  if (inferred.length === 1) return inferred[0];
  if (inferred.length > 1) throw new Error(`Ambiguous Corax article mapping: ${rawName}`);
  return null;
}

/**
 * Pure transform, exposed for adversarial tests.
 * All master EANs must be represented by at least one portal article, including
 * a zero-COLLI article. This is the pagination/completeness gate.
 */
function buildSnapshotPayload(rawRows, masterRows, mappingRows) {
  const masterByEan = buildMasterByEan(masterRows);
  const aliases = buildCoraxAliasIndex(mappingRows, masterByEan);
  const totals = new Map(
    [...masterByEan.values()].map((product) => [product.ean, {
      ean: product.ean,
      raw_colli: 0,
      units_per_master: product.units_per_master,
      source_article_count: 0,
    }]),
  );
  const ignoredZeroRows = [];

  for (const row of rawRows || []) {
    const rawName = text(row.article);
    const rawColli = parseColliCell(row.stock_text);
    if (!rawName) {
      if (rawColli > 0) throw new Error('Positive Corax stock row without an article name');
      continue;
    }

    const product = resolveCoraxRow(rawName, masterByEan, aliases);
    if (!product) {
      if (rawColli > 0) {
        throw new Error(`Unresolved positive Corax stock row: ${rawName}`);
      }
      ignoredZeroRows.push(rawName);
      continue;
    }

    const total = totals.get(product.ean);
    total.raw_colli += rawColli;
    total.source_article_count += 1;
  }

  const missingEans = [...totals.values()]
    .filter((row) => row.source_article_count === 0)
    .map((row) => row.ean);
  if (missingEans.length) {
    throw new Error(`Incomplete Corax result; selling EANs absent from source: ${missingEans.join(', ')}`);
  }

  const rows = [...totals.values()]
    .map((row) => {
      const onHand = row.raw_colli * row.units_per_master;
      if (!Number.isSafeInteger(onHand) || onHand < 0) {
        throw new Error(`Invalid converted on-hand quantity for EAN ${row.ean}`);
      }
      return { ...row, on_hand: onHand };
    })
    .sort((left, right) => left.ean.localeCompare(right.ean));

  return {
    rows,
    source_row_count: (rawRows || []).length,
    expected_ean_count: masterByEan.size,
    total_units: rows.reduce((sum, row) => sum + row.on_hand, 0),
    ignored_zero_rows: ignoredZeroRows.sort(),
  };
}

async function visible(locator) {
  return locator.isVisible({ timeout: 1500 }).catch(() => false);
}

/**
 * Compatibility fallback for executors that predate credential injection.
 * It is only called after an authenticated storage state proved insufficient.
 * The value is never logged or returned in a task result.
 */
async function loadCoraxCredentials(credentials, supabase) {
  const injectedUsername = text(credentials?.username);
  const injectedPassword = text(credentials?.password);
  if (injectedUsername && injectedPassword) {
    return { username: injectedUsername, password: injectedPassword };
  }

  if (!supabase || typeof supabase.from !== 'function') {
    throw new Error('Corax credentials are unavailable');
  }

  const { data, error } = await supabase
    .from('Browser_Credentials')
    .select('username,password')
    .eq('key', 'vanthiel_corax_wms')
    .single();
  if (error || !text(data?.username) || !text(data?.password)) {
    throw new Error('Corax credentials are unavailable');
  }
  return { username: text(data.username), password: text(data.password) };
}

async function ensureCoraxSession(page, credentials, supabase) {
  await page.goto(CORAX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  const needsLogin = /microsoftonline\.com|login/i.test(page.url());
  if (!needsLogin) return;
  const usableCredentials = await loadCoraxCredentials(credentials, supabase);

  const email = page.locator('input[type="email"], input[name="loginfmt"], #i0116').first();
  await email.waitFor({ state: 'visible', timeout: 30000 });
  await email.fill(usableCredentials.username);
  const next = page.locator('#idSIButton9, input[type="submit"], button[type="submit"]').first();
  await next.click();
  await page.waitForTimeout(2000);

  const password = page.locator('input[type="password"], input[name="passwd"], #i0118').first();
  await password.waitFor({ state: 'visible', timeout: 30000 });
  await password.fill(usableCredentials.password);
  await page.locator('#idSIButton9, input[type="submit"], button[type="submit"]').first().click();
  await page.waitForTimeout(4000);

  const staySignedIn = page.locator('#idSIButton9, input[type="submit"][value="Yes"], button:has-text("Ja")').first();
  if (await visible(staySignedIn)) {
    await staySignedIn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  if (/microsoftonline\.com|login/i.test(page.url())) {
    const pageText = await page.locator('body').innerText().catch(() => '');
    if (/authenticator|verification code|approve|verify/i.test(pageText)) {
      throw new Error('Corax MFA is required; no inventory was written');
    }
    throw new Error('Corax login did not complete; no inventory was written');
  }
}

async function openStocksPerArticle(page) {
  const voorraad = page.locator('button, a, [role="button"]').filter({ hasText: /^\s*Voorraad\b/i }).first();
  await voorraad.waitFor({ state: 'visible', timeout: 30000 });
  await voorraad.click();
  await page.waitForTimeout(800);

  const stocks = page.locator('a, button, [role="menuitem"], [role="button"]').filter({ hasText: /Stocks per artikel/i }).first();
  await stocks.waitFor({ state: 'visible', timeout: 30000 });
  await stocks.click();
  await page.waitForTimeout(2500);

  await page.waitForFunction(() => {
    return [...document.querySelectorAll('table')].some((table) => {
      const headers = [...table.querySelectorAll('thead th, thead td')]
        .map((cell) => (cell.textContent || '').toLowerCase());
      return headers.some((header) => header.includes('artikel'))
        && headers.some((header) => header.includes('aantal in voorraad'));
    });
  }, null, { timeout: 30000 });
}

async function selectLargestPageSize(page) {
  const selects = page.locator('select');
  const candidates = await selects.evaluateAll((nodes) => nodes.map((node, index) => ({
    index,
    options: [...node.options].map((option) => ({
      value: option.value,
      label: (option.textContent || '').trim(),
      quantity: Number((option.textContent || '').match(/\d+/)?.[0] || NaN),
    })),
  }))).catch(() => []);

  const viable = candidates
    .map((candidate) => ({
      ...candidate,
      largest: candidate.options
        .filter((option) => Number.isFinite(option.quantity) && option.quantity > 0)
        .sort((left, right) => right.quantity - left.quantity)[0],
    }))
    .filter((candidate) => candidate.largest && candidate.largest.quantity >= 25)
    .sort((left, right) => right.largest.quantity - left.largest.quantity)[0];

  if (!viable) return null;
  await selects.nth(viable.index).selectOption(viable.largest.value).catch(() => null);
  await page.waitForTimeout(1200);
  return viable.largest.quantity;
}

async function extractStockPage(page) {
  return page.evaluate(() => {
    const normalizedHeader = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const table of document.querySelectorAll('table')) {
      const headers = [...table.querySelectorAll('thead th, thead td')].map((cell) => normalizedHeader(cell.textContent));
      const articleIndex = headers.findIndex((header) => header.includes('artikel'));
      const stockIndex = headers.findIndex((header) => header.includes('aantal in voorraad'));
      if (articleIndex < 0 || stockIndex < 0) continue;

      const rows = [...table.querySelectorAll('tbody tr')]
        .filter((row) => {
          const style = window.getComputedStyle(row);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((row) => {
          const cells = [...row.querySelectorAll('td')].map((cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim());
          return {
            article: cells[articleIndex] || '',
            stock_text: cells[stockIndex] || '',
          };
        })
        .filter((row) => row.article || row.stock_text);
      return { headers, rows };
    }
    return { headers: [], rows: [] };
  });
}

async function nextPaginationControl(page) {
  const controls = page.locator('button, a, [role="button"]');
  const match = await controls.evaluateAll((nodes) => nodes
    .map((node, index) => {
      const text = (node.textContent || '').trim();
      const aria = node.getAttribute('aria-label') || '';
      const title = node.getAttribute('title') || '';
      const klass = typeof node.className === 'string' ? node.className : '';
      const parentClass = typeof node.parentElement?.className === 'string' ? node.parentElement.className : '';
      const haystack = `${text} ${aria} ${title} ${klass} ${parentClass}`.toLowerCase();
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return {
        index,
        next: /\b(next|volgende)\b/.test(haystack) || /pagination[-_ ]?next/.test(haystack),
        disabled: node.hasAttribute('disabled')
          || node.getAttribute('aria-disabled') === 'true'
          || /\bdisabled\b/.test(haystack),
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      };
    })
    .find((entry) => entry.next && entry.visible) || null,
  ).catch(() => null);
  if (!match) return null;
  return { locator: controls.nth(match.index), disabled: match.disabled };
}

async function scrapeAllStockPages(page) {
  const rows = [];
  const fingerprints = new Set();
  let pageCount = 0;

  for (let pageNumber = 1; pageNumber <= MAX_PORTAL_PAGES; pageNumber += 1) {
    const current = await extractStockPage(page);
    if (!current.rows.length) throw new Error('Corax stock table has no visible article rows');
    const fingerprint = JSON.stringify(current.rows);
    if (fingerprints.has(fingerprint)) {
      throw new Error('Corax pagination did not advance; refusing incomplete source data');
    }
    fingerprints.add(fingerprint);
    rows.push(...current.rows);
    pageCount += 1;

    const next = await nextPaginationControl(page);
    if (!next || next.disabled) break;
    await next.locator.click();
    await page.waitForTimeout(1200);
  }

  if (pageCount === MAX_PORTAL_PAGES) {
    throw new Error('Corax pagination exceeded the safety limit');
  }
  return { rows, page_count: pageCount };
}

async function loadMaster(supabase) {
  const { data, error } = await supabase
    .from('Puzzlup_Product_Info')
    .select('id,sku,product_type,brand,color,version,size,ean,status,units_per_master')
    .eq('status', 'Selling')
    .in('brand', ['Puzzlup', 'Qualico'])
    .in('product_type', ['MAT', 'TRAY'])
    .not('ean', 'is', null)
    .not('units_per_master', 'is', null)
    .order('ean', { ascending: true });
  if (error) throw new Error(`Could not load product master: ${error.message}`);
  return data || [];
}

async function loadCoraxMappings(supabase) {
  const { data, error } = await supabase
    .from('Product_Name_Mapping')
    .select('source_name,source,canonical_name,product_id,ean')
    .eq('source', 'corax')
    .not('ean', 'is', null)
    .order('id', { ascending: true });
  if (error) throw new Error(`Could not load Corax name mappings: ${error.message}`);
  return data || [];
}

async function logStep(log, step, message) {
  if (typeof log === 'function') await log(step, message);
}

async function run({ page, supabase, credentials, log }) {
  if (!page || !supabase) throw new Error('Executor did not provide required browser/database context');

  await logStep(log, 'vanthiel-v2-start', 'Loading authoritative product and Corax mapping data.');
  const [masterRows, mappingRows] = await Promise.all([
    loadMaster(supabase),
    loadCoraxMappings(supabase),
  ]);
  const masterByEan = buildMasterByEan(masterRows);

  await ensureCoraxSession(page, credentials, supabase);
  await openStocksPerArticle(page);
  const pageSize = await selectLargestPageSize(page);
  const scraped = await scrapeAllStockPages(page);
  await logStep(log, 'vanthiel-v2-source', `Read ${scraped.rows.length} portal rows across ${scraped.page_count} page(s); page size ${pageSize || 'unchanged'}.`);

  const snapshot = buildSnapshotPayload(scraped.rows, masterRows, mappingRows);
  if (snapshot.rows.length !== masterByEan.size) {
    throw new Error('Vanthiel snapshot completeness mismatch');
  }

  const rpcRows = snapshot.rows.map((row) => ({
    ean: row.ean,
    raw_colli: row.raw_colli,
    units_per_master: row.units_per_master,
    on_hand: row.on_hand,
  }));
  const { data, error } = await supabase.rpc('apply_vanthiel_inventory_snapshot', {
    p_rows: rpcRows,
    p_dry_run: false,
  });
  if (error) throw new Error(`Vanthiel atomic snapshot rejected: ${error.message}`);
  if (!data || data.dry_run) throw new Error('Vanthiel snapshot RPC did not confirm a live write');

  const result = {
    warehouse: 'Vanthiel',
    source: 'corax_wms',
    source_unit: 'COLLI',
    source_row_count: snapshot.source_row_count,
    source_page_count: scraped.page_count,
    expected_ean_count: snapshot.expected_ean_count,
    canonical_ean_count: snapshot.rows.length,
    total_colli: snapshot.rows.reduce((sum, row) => sum + row.raw_colli, 0),
    total_units: snapshot.total_units,
    ignored_zero_rows: snapshot.ignored_zero_rows,
    records: snapshot.rows,
    database: data,
  };
  await logStep(log, 'vanthiel-v2-complete', `Atomic snapshot applied: ${result.canonical_ean_count} EANs, ${result.total_units} units.`);
  return result;
}

module.exports = run;
module.exports._private = {
  normalizePortalName,
  extractEan,
  parseColliCell,
  loadCoraxCredentials,
  buildMasterByEan,
  buildCoraxAliasIndex,
  inferMasterCandidates,
  resolveCoraxRow,
  buildSnapshotPayload,
};
