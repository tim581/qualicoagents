/**
 * bol-price-sync-all.js — Sync BOL.COM price_targets via bol-price-update.js
 *
 * Usage:
 *   BOL_NO_PROXY=1 node scripts/bol-price-sync-all.js          # pending only
 *   BOL_NO_PROXY=1 node scripts/bol-price-sync-all.js --all    # re-sync all BOL targets
 */

'use strict';

require('dotenv').config();

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ROOT = path.join(__dirname, '..');

function resolvePlaywrightBrowsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const local = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (local && fs.existsSync(path.join(local, 'chromium-1217'))) return local;
  const repo = path.join(ROOT, '.playwright-browsers');
  if (fs.existsSync(path.join(repo, 'chromium-1217'))) return repo;
  return local;
}

const PLAYWRIGHT_BROWSERS_PATH = resolvePlaywrightBrowsersPath();
const DEBUG_DIR = path.join(ROOT, '.debug');
const LOG_PATH = path.join(DEBUG_DIR, 'bol-price-sync-all.log');

const OFFER_UID_BY_EAN = {
  '5419980047458': '8cee3ee7-71b2-4e93-aec4-00116b05224b',
  '5419980047489': 'f45cac61-aed6-45fd-aef7-5edb239a1d70',
  '5419980047465': '8f8ed922-7019-427f-b94c-ced43b5a8e0c',
  '5419980047472': '4ab15dc1-f68f-4d87-894b-b26d298c3afa',
  '5419980047427': '64558e54-04fd-436f-9798-7b3e95f94971',
  '5419980047441': '28500c43-d13a-4758-8de8-6b1a309ddb33',
  '5419980414717': '0732e5bf-edbf-4c0b-aab4-a969f1fcf529',
  '5419980414724': 'c61305f7-ee7b-4c76-8ec3-2305a17bd6da',
  '5419980414700': 'ea16b542-e584-48ea-84c2-bb6bfc5c002b',
  '5419980414762': 'a124a4b5-1f5e-4a0e-b872-73f36bf53511',
  '5419980414748': '1dd6c906-0132-4d03-a0f5-0d1c88abf048',
};

const OFFER_UID_BY_BOL_ID = {
  '9300000117610237': '4ab15dc1-f68f-4d87-894b-b26d298c3afa',
  '9300000133618629': 'f45cac61-aed6-45fd-aef7-5edb239a1d70',
  '9300000045283847': '8f8ed922-7019-427f-b94c-ced43b5a8e0c',
  '9300000045218332': '8cee3ee7-71b2-4e93-aec4-00116b05224b',
  '9300000240566062': '0732e5bf-edbf-4c0b-aab4-a969f1fcf529',
  '9300000240566183': 'c61305f7-ee7b-4c76-8ec3-2305a17bd6da',
  '9300000176363501': 'ea16b542-e584-48ea-84c2-bb6bfc5c002b',
  '9300000240566990': 'a124a4b5-1f5e-4a0e-b872-73f36bf53511',
  '9300000240566271': '1dd6c906-0132-4d03-a0f5-0d1c88abf048',
};

const STANDARD_SALE_START = '2026-06-17';
const STANDARD_SALE_END = '2026-12-31';

function sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, line + '\n');
}

function navEan(row) {
  return row.offer_ref || row.ean;
}

async function fetchPendingBolTargets() {
  const params = new URLSearchParams({
    select:
      'id,product_name,ean,offer_ref,target_price,sale_start_date,sale_end_date,channel_name,status',
    status: 'eq.pending',
    channel_name: 'eq.BOL.COM',
    order: 'id.asc',
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/price_targets?${params}`, {
    headers: sbHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`price_targets fetch failed: HTTP ${res.status} ${body.substring(0, 300)}`);
  }
  return res.json();
}

async function fetchAllBolTargets() {
  const params = new URLSearchParams({
    select:
      'id,product_name,ean,offer_ref,target_price,sale_start_date,sale_end_date,channel_name,status',
    channel_name: 'eq.BOL.COM',
    order: 'id.asc',
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/price_targets?${params}`, {
    headers: sbHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`price_targets fetch failed: HTTP ${res.status} ${body.substring(0, 300)}`);
  }
  return res.json();
}

async function fetchOfferUidsFromBrowserTasks() {
  const params = new URLSearchParams({
    select: 'actions',
    task_type: 'eq.bol-price-update',
    status: 'eq.done',
    order: 'completed_at.desc',
    limit: '100',
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/Browser_Tasks?${params}`, {
    headers: sbHeaders(),
  });
  if (!res.ok) return {};
  const rows = await res.json();
  const map = {};
  for (const row of rows) {
    try {
      const actions = typeof row.actions === 'string' ? JSON.parse(row.actions) : row.actions;
      const action = Array.isArray(actions) ? actions[0] : actions;
      if (!action?.offer_uid) continue;
      if (action.ean) map[String(action.ean)] = action.offer_uid;
      if (action.offer_uid && action.ean?.startsWith('930000')) {
        map[String(action.ean)] = action.offer_uid;
      }
    } catch {
      /* ignore malformed actions */
    }
  }
  return map;
}

function resolveOfferUid(row, historyMap) {
  const ean = row.ean ? String(row.ean) : null;
  const bolId = row.offer_ref ? String(row.offer_ref) : null;
  return (
    (ean && (OFFER_UID_BY_EAN[ean] || historyMap[ean])) ||
    (bolId && (OFFER_UID_BY_BOL_ID[bolId] || historyMap[bolId])) ||
    null
  );
}

async function loadBolCookies(context) {
  const storageStatePath = path.join(__dirname, 'bol-storage-state.json');
  if (!fs.existsSync(storageStatePath)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
    if (saved.cookies?.length) {
      await context.addCookies(saved.cookies);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function loadBolCredentials() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.bol_seller&select=username,password`,
    { headers: sbHeaders() }
  );
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('bol_seller credentials not found');
  }
  return data[0];
}

async function bolLoginIfNeeded(page, creds) {
  if (!page.url().includes('login.bol.com')) return;
  let usernameField = page.locator('input[name="j_username"]').first();
  if (!(await usernameField.isVisible({ timeout: 3000 }).catch(() => false))) {
    usernameField = page.locator('input[type="email"], input[type="text"]').first();
  }
  await usernameField.fill(creds.username);
  const passwordField = page.locator('input[name="j_password"], input[type="password"]').first();
  await passwordField.fill(creds.password);
  const loginBtn = page.getByRole('button', { name: /inloggen|log in|aanmelden/i }).first();
  if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await Promise.all([
      page.waitForURL((url) => !url.toString().includes('login.bol.com'), { timeout: 45000 }).catch(() => null),
      loginBtn.click({ force: true }),
    ]);
  } else {
    await passwordField.press('Enter');
    await page.waitForTimeout(12000);
  }
  if (page.url().includes('login.bol.com')) {
    throw new Error('SSO login failed during offer_uid probe');
  }
}

function extractOfferUidFromUrl(url) {
  const match = url.match(/[?&]offerUid=([0-9a-f-]{36})/i);
  return match ? match[1] : null;
}

async function tryMenuNavigateToOffer(page, productId) {
  await page.goto('https://partner.bol.com/sdd/assortment-new/overview/', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForTimeout(2500);

  const enabledLink = (pattern) =>
    page.getByRole('link', { name: pattern }).filter({ hasNot: page.locator('[aria-disabled="true"]') }).first();

  for (const label of [/mijn artikelen/i]) {
    const link = enabledLink(label);
    if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
      await link.click();
      await page.waitForTimeout(2500);
      break;
    }
  }

  const search = page.locator(
    'input[type="search"], input[placeholder*="Zoek" i], input[placeholder*="zoek" i], input[name*="search" i]',
  ).first();
  if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
    await search.fill(String(productId));
    await search.press('Enter');
    await page.waitForTimeout(4000);
  }

  for (const edit of [
    page.getByRole('link', { name: /bewerken/i }).first(),
    page.getByRole('button', { name: /bewerken/i }).first(),
    page.getByText(/^Bewerken$/i).first(),
  ]) {
    if (await edit.isVisible({ timeout: 2000 }).catch(() => false)) {
      await edit.click();
      await page.waitForTimeout(3000);
      break;
    }
  }

  return extractOfferUidFromUrl(page.url());
}

async function probeOfferUid(productId) {
  log(`Probing offer_uid for product ${productId}...`);
  const creds = await loadBolCredentials();
  const launchOptions = {
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (process.env.BOL_NO_PROXY !== '1') {
    launchOptions.proxy = {
      server: 'http://gate.decodo.com:10001',
      username: 'spx615l7f1',
      password: 'BHrGlyvt9mRqv2=j62',
    };
  }

  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'nl-NL',
    });
    await loadBolCookies(context);
    const page = await context.newPage();

    const productUrl = `https://partner.bol.com/sdd/assortment-new/product/${productId}`;
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    await bolLoginIfNeeded(page, creds);

    let offerUid = extractOfferUidFromUrl(page.url());
    if (!offerUid && !page.url().includes(String(productId))) {
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);
      offerUid = extractOfferUidFromUrl(page.url());
    }

    if (!offerUid) {
      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="offerUid="]'))
          .map((a) => a.getAttribute('href'))
          .filter(Boolean)
      );
      for (const href of hrefs) {
        offerUid = extractOfferUidFromUrl(href);
        if (offerUid) break;
      }
    }

    if (!offerUid) {
      offerUid = await tryMenuNavigateToOffer(page, productId);
      if (offerUid) log(`Found offer_uid via Mijn artikelen menu: ${offerUid}`);
    }

    if (!offerUid) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (/geen aanbod voor dit artikel|nog geen aanbod/i.test(bodyText)) {
        throw new Error(
          `No Bol.com offer for EAN ${productId} — add product to assortment in partner portal first`,
        );
      }
      const html = await page.content();
      const match = html.match(/offerUid["'=:\s]+([0-9a-f-]{36})/i);
      if (match) offerUid = match[1];
    }

    if (!offerUid) {
      throw new Error(`Could not extract offer_uid from partner portal for product ${productId}`);
    }
    log(`Probed offer_uid for ${productId}: ${offerUid}`);
    return offerUid;
  } finally {
    await browser.close();
  }
}

async function patchTargetSynced(id) {
  const body = {
    status: 'synced',
    sale_start_date: STANDARD_SALE_START,
    sale_end_date: STANDARD_SALE_END,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/price_targets?id=eq.${id}`, {
    method: 'PATCH',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`price_targets PATCH failed for ${id}: HTTP ${res.status} ${errBody.substring(0, 200)}`);
  }
}

async function patchTargetStatus(id, status) {
  const body = { status };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/price_targets?id=eq.${id}`, {
    method: 'PATCH',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`price_targets PATCH failed for ${id}: HTTP ${res.status} ${errBody.substring(0, 200)}`);
  }
}

function runBolPriceUpdate(params, perProductLog) {
  const env = {
    ...process.env,
    BOL_NO_PROXY: process.env.BOL_NO_PROXY || '1',
    BOL_FORCE_DATE_RANGE: '1',
    PLAYWRIGHT_BROWSERS_PATH,
    TASK_PARAMS: JSON.stringify(params),
  };
  delete env.BROWSER_TASK_ID;

  const result = spawnSync('node', [path.join(__dirname, 'bol-price-update.js')], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  fs.writeFileSync(perProductLog, output);

  const success =
    /\[DB:success\] complete:/.test(output) ||
    (/"success"\s*:\s*true/.test(output) && !/❌ Fatal:/.test(output) && !/\[DB:error\] fatal:/.test(output));
  const fatalMatch = output.match(/❌ Fatal: (.+)|\[DB:error\] fatal: (.+)/);
  const error = success ? null : fatalMatch ? (fatalMatch[1] || fatalMatch[2] || 'Unknown error').trim() : `exit=${result.status}`;

  return { success, error, output, exitCode: result.status };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY required in .env');
  }

  const syncAll = process.argv.includes('--all') || process.env.BOL_SYNC_ALL === '1';

  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  process.env.PLAYWRIGHT_BROWSERS_PATH = PLAYWRIGHT_BROWSERS_PATH;
  log(`=== bol-price-sync-all started (${syncAll ? 'ALL targets' : 'pending only'}) ===`);
  log(`Date range: ${STANDARD_SALE_START} → ${STANDARD_SALE_END}`);

  const targets = syncAll ? await fetchAllBolTargets() : await fetchPendingBolTargets();
  log(`Found ${targets.length} BOL.COM target(s) to process`);
  if (targets.length === 0) {
    log('Nothing to sync.');
    return { synced: 0, failed: [], skipped: [] };
  }

  const historyMap = await fetchOfferUidsFromBrowserTasks();
  log(`Loaded ${Object.keys(historyMap).length} offer_uid(s) from Browser_Tasks history`);

  const synced = [];
  const failed = [];
  const skipped = [];

  for (const row of targets) {
    const label = `#${row.id} ${row.product_name} (${row.ean})`;
    log(`--- Processing ${label} ---`);

    let offerUid = resolveOfferUid(row, historyMap);
    const bolProductId = navEan(row);
    if (!offerUid) {
      try {
        offerUid = await probeOfferUid(bolProductId);
        if (row.ean) OFFER_UID_BY_EAN[String(row.ean)] = offerUid;
        if (row.offer_ref) OFFER_UID_BY_BOL_ID[String(row.offer_ref)] = offerUid;
        historyMap[String(bolProductId)] = offerUid;
      } catch (err) {
        log(`SKIP ${label}: ${err.message}`);
        skipped.push({ id: row.id, ean: row.ean, product_name: row.product_name, reason: err.message });
        continue;
      }
    }

    const params = {
      ean: bolProductId,
      offer_uid: offerUid,
      promotional_price: Number(row.target_price),
      start_date: STANDARD_SALE_START,
      end_date: STANDARD_SALE_END,
      action: 'set',
    };

    const perLog = path.join(DEBUG_DIR, `bol-price-sync-${row.id}-${row.ean}.log`);
    log(`Running bol-price-update.js → ${perLog}`);
    log(`TASK_PARAMS: ${JSON.stringify(params)}`);

    const run = runBolPriceUpdate(params, perLog);
    if (run.success) {
      try {
        await patchTargetSynced(row.id);
        log(`SYNCED ${label}`);
        synced.push({ id: row.id, ean: row.ean, product_name: row.product_name, offer_uid: offerUid, log: perLog });
      } catch (err) {
        log(`FAIL patch ${label}: ${err.message}`);
        failed.push({
          id: row.id,
          ean: row.ean,
          product_name: row.product_name,
          reason: `Price set OK but Supabase patch failed: ${err.message}`,
          log: perLog,
        });
      }
    } else {
      log(`FAIL ${label}: ${run.error}`);
      failed.push({
        id: row.id,
        ean: row.ean,
        product_name: row.product_name,
        reason: run.error,
        log: perLog,
      });
    }
  }

  log(`=== bol-price-sync-all finished: synced=${synced.length} failed=${failed.length} skipped=${skipped.length} ===`);
  return { synced, failed, skipped };
}

main()
  .then((summary) => {
    console.log('\nSUMMARY:', JSON.stringify(summary, null, 2));
    const ok = summary.failed.length === 0;
    console.log(
      JSON.stringify({
        success: ok,
        data: {
          synced: summary.synced.length,
          failed: summary.failed.length,
          skipped: summary.skipped.length,
          synced_ids: summary.synced.map((s) => s.id),
          failed_items: summary.failed,
          skipped_items: summary.skipped,
        },
      }),
    );
    process.exit(ok ? 0 : 1);
  })
  .catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
