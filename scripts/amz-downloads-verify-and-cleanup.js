'use strict';

/**
 * amz-downloads-verify-and-cleanup.js
 *
 * Scans AMAZON_DOWNLOADS_DIR (Google Drive shortcut), cleans accountant folder
 * structure, verifies expected payments + ads PDFs, writes verification report.
 *
 * Usage:
 *   node scripts/amz-downloads-verify-and-cleanup.js
 *   node scripts/amz-downloads-verify-and-cleanup.js --no-cleanup   # safe while backfill is writing
 *   node scripts/amz-downloads-verify-and-cleanup.js --retry        # re-run missing payments/ads (skips if backfill running)
 *   node scripts/amz-downloads-verify-and-cleanup.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) { /* optional */ }

const {
  resolveDownloadsBase,
  ensureAccountantFolders,
  consolidateAccountantTree,
  paymentsExpectedPath,
  paymentsFlatFilename,
  paymentKeyFromFilename,
  invoiceIdFromFilename,
  adsCanonicalFromFilename,
  adsFlatPath,
  PAYMENTS_ROOT_NAME,
  ADS_ROOT_NAME,
  LOCAL_FALLBACK,
} = require('./amz-accountant-paths');
const {
  isPdfFile,
  scanForNonPdfFiles,
  formatScanReport,
  removeInvalidFile,
  recoverAnonymousDownloads,
  walkAllFiles,
  safeMoveSync,
  UUID_FILENAME_RE,
} = require('./amz-pdf-utils');

const ROOT = path.join(__dirname, '..');
const REPORT_PATH = path.join(__dirname, 'amz-downloads-verification-report.json');
const PAYMENTS_SUMMARY_PATH = path.join(__dirname, 'amz-payments-reports-download-summary.json');
const ADS_SUMMARY_PATH = path.join(__dirname, 'amz-ads-invoice-download-summary.json');
const ADS_EXPECTED_MANIFEST_PATH = path.join(__dirname, 'amz-ads-expected-invoices.json');
const PAYMENTS_SCRIPT = path.join(__dirname, 'amz-payments-reports-download.js');
const ADS_SCRIPT = path.join(__dirname, 'amz-ads-invoice-download.js');
const WATCHED_BACKFILL_SCRIPTS = [
  'amz-payments-reports-download.js',
  'amz-ads-invoice-download.js',
];

const PAYMENT_MARKETS = ['US', 'CA', 'UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE'];
const PAYMENT_YEARS = [2025, 2026];
const PAYMENT_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const ADS_YEARS = [2025, 2026];
function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function paymentsExpectedFilename(market, year, month) {
  return paymentsFlatFilename(market, monthKey(year, month));
}

function buildExpectedPaymentsMatrix() {
  const items = [];
  for (const market of PAYMENT_MARKETS) {
    for (const year of PAYMENT_YEARS) {
      for (const month of PAYMENT_MONTHS) {
        items.push({
          market,
          year,
          month,
          monthKey: monthKey(year, month),
          filename: paymentsExpectedFilename(market, year, month),
        });
      }
    }
  }
  return items;
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function listRunningBackfillProcesses() {
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  if (ps.status !== 0 || !ps.stdout) return [];

  let rows = [];
  try {
    const parsed = JSON.parse(ps.stdout.trim() || '[]');
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }

  const selfPid = process.pid;
  const hits = [];
  for (const row of rows) {
    if (!row || !row.CommandLine) continue;
    if (Number(row.ProcessId) === selfPid) continue;
    for (const script of WATCHED_BACKFILL_SCRIPTS) {
      if (row.CommandLine.includes(script)) {
        hits.push({ pid: Number(row.ProcessId), script });
      }
    }
  }
  return hits;
}

function paymentsScanRoots(paymentsRoot) {
  return [
    paymentsRoot,
    path.join(LOCAL_FALLBACK, 'amazon-reports'),
    path.join(LOCAL_FALLBACK, PAYMENTS_ROOT_NAME),
  ].filter((root, idx, arr) => root && arr.indexOf(root) === idx);
}

function adsScanRoots(adsRoot) {
  return [
    adsRoot,
    path.join(LOCAL_FALLBACK, 'amazon-ads-invoices'),
    path.join(LOCAL_FALLBACK, ADS_ROOT_NAME),
  ].filter((root, idx, arr) => root && arr.indexOf(root) === idx);
}

function supplementPaymentsFromSummary(paymentsFound, paymentsRoot) {
  const summary = readJsonSafe(PAYMENTS_SUMMARY_PATH);
  if (!summary) return;
  for (const row of summary.results || []) {
    const filePath = row.path || (Array.isArray(row.downloaded) ? row.downloaded[0] : null);
    if (!filePath || !isPdfFile(filePath)) continue;
    const key = paymentKeyFromFilename(path.basename(filePath));
    if (!key) continue;
    if (!paymentsFound.has(key)) paymentsFound.set(key, filePath);
  }
}

function supplementAdsFromSummary(adsFound) {
  const summary = readJsonSafe(ADS_SUMMARY_PATH);
  if (!summary) return;
  for (const row of [...(summary.downloads || []), ...(summary.skipped || [])]) {
    const filePath = row.file || row.path;
    const invoiceId = row.invoiceId ? String(row.invoiceId).toUpperCase() : null;
    if (!invoiceId) continue;
    if (filePath && isPdfFile(filePath) && !adsFound.has(invoiceId)) {
      adsFound.set(invoiceId, filePath);
    }
  }
}

function collectInvoiceIdsFromAdsSummary(summary) {
  const ids = new Set();
  if (!summary || typeof summary !== 'object') return ids;
  for (const row of summary.downloads || []) {
    if (row.invoiceId) ids.add(String(row.invoiceId).toUpperCase());
  }
  for (const row of summary.skipped || []) {
    if (row.invoiceId) ids.add(String(row.invoiceId).toUpperCase());
  }
  for (const row of summary.errors || []) {
    if (row.invoiceId) ids.add(String(row.invoiceId).toUpperCase());
  }
  for (const id of summary.invoices_seen || []) {
    ids.add(String(id).toUpperCase());
  }
  return ids;
}

function mergeAdsExpectedManifest(newIds) {
  const existing = readJsonSafe(ADS_EXPECTED_MANIFEST_PATH, { invoice_ids: [], updated_at: null });
  const merged = new Set((existing.invoice_ids || []).map((id) => String(id).toUpperCase()));
  for (const id of newIds) merged.add(String(id).toUpperCase());
  const manifest = {
    invoice_ids: Array.from(merged).sort(),
    updated_at: new Date().toISOString(),
    years: ADS_YEARS,
  };
  fs.writeFileSync(ADS_EXPECTED_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  return manifest;
}

function loadPaymentExemptions() {
  const exempt = new Set();
  const summary = readJsonSafe(PAYMENTS_SUMMARY_PATH);
  if (!summary) return exempt;
  for (const row of summary.results || []) {
    const reason = String(row.reason || '').toLowerCase();
    const status = String(row.status || '').toLowerCase();
    if (!row.marketCode || !row.monthKey) continue;
    if (
      reason.includes('not_available')
      || reason.includes('csv_only')
      || status === 'not_available'
      || status === 'csv_only'
    ) {
      exempt.add(`${row.marketCode}:${row.monthKey}`);
    }
  }
  return exempt;
}

function removeEmptyDirs(root) {
  const removed = [];
  if (!root || !fs.existsSync(root)) return removed;

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
    if (dir === root) return;
    const left = fs.readdirSync(dir);
    if (left.length === 0) {
      fs.rmdirSync(dir);
      removed.push(dir);
    }
  };
  walk(root);
  return removed;
}

function cleanupDownloadsTree({ baseDir, paymentsRoot, adsRoot, dryRun = false }) {
  const consolidation = consolidateAccountantTree(baseDir, { dryRun });
  paymentsRoot = consolidation.paymentsRoot;
  adsRoot = consolidation.adsRoot;

  const actions = {
    consolidation,
    removed_invalid: [],
    recovered_anonymous: [],
    moved_to_canonical: [],
    removed_duplicates: [
      ...(consolidation.payments.removed_duplicates || []),
      ...(consolidation.ads.removed_duplicates || []),
      ...(consolidation.sweep.removed_duplicates || []),
    ],
    removed_legacy_paths: [],
    removed_unexpected_top_level: [],
    empty_dirs_removed: [
      ...(consolidation.payments.empty_dirs_removed || []),
      ...(consolidation.ads.empty_dirs_removed || []),
      ...(consolidation.sweep.empty_dirs_removed || []),
    ],
    duplicate_folders_removed: [
      ...(consolidation.payments.removed_dirs || []),
      ...(consolidation.ads.removed_dirs || []),
    ],
  };

  for (const move of [
    ...(consolidation.payments.moved || []),
    ...(consolidation.ads.moved || []),
    ...(consolidation.sweep.moved || []),
  ]) {
    actions.moved_to_canonical.push(move);
  }

  const applyRemove = (filePath, reason) => {
    if (dryRun) {
      actions.removed_invalid.push({ path: filePath, reason, dry_run: true });
      return { removed: false, path: filePath, reason, dry_run: true };
    }
    const result = removeInvalidFile(filePath, reason);
    actions.removed_invalid.push(result);
    return result;
  };

  const applyMove = (from, to, reason) => {
    if (from === to) return;
    if (dryRun) {
      actions.moved_to_canonical.push({ from, to, reason, dry_run: true });
      return;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(to)) {
      if (isPdfFile(to)) {
        applyRemove(from, `duplicate_of_${path.basename(to)}`);
        return;
      }
      applyRemove(to, 'replace_non_canonical_target');
    }
    safeMoveSync(from, to);
    actions.moved_to_canonical.push({ from, to, reason });
  };

  const allowedTop = new Set([PAYMENTS_ROOT_NAME, ADS_ROOT_NAME]);
  const isAllowedTopDir = (name) => allowedTop.has(name)
    || /^Advertising-Invoices\s\(\d+\)$/i.test(name)
    || /^Payments-Summary-Reports\s\(\d+\)$/i.test(name);

  if (fs.existsSync(baseDir)) {
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (isAllowedTopDir(entry.name)) continue;
      const full = path.join(baseDir, entry.name);
      if (entry.isDirectory()) {
        for (const nested of walkAllFiles(full)) {
          if (!isPdfFile(nested)) {
            actions.removed_unexpected_top_level.push(applyRemove(nested, 'unexpected_top_level_dir'));
            continue;
          }
          const base = path.basename(nested);
          const payKey = paymentKeyFromFilename(base);
          const adsMeta = adsCanonicalFromFilename(base);
          if (payKey) {
            const [market, mk] = payKey.split(':');
            applyMove(nested, paymentsExpectedPath(paymentsRoot, market, Number(mk.slice(0, 4)), Number(mk.slice(5, 7))), 'unexpected_top_level_payments_pdf');
          } else if (adsMeta?.invoiceId) {
            applyMove(nested, adsFlatPath(adsRoot, adsMeta), 'unexpected_top_level_ads_pdf');
          } else {
            actions.removed_unexpected_top_level.push(applyRemove(nested, 'unexpected_top_level_unclassified_pdf'));
          }
        }
        if (!dryRun && fs.existsSync(full)) {
          actions.empty_dirs_removed.push(...removeEmptyDirs(full));
          if (fs.existsSync(full)) fs.rmdirSync(full, { recursive: true });
        } else {
          actions.removed_unexpected_top_level.push({ path: full, reason: 'unexpected_top_level_dir', dry_run: dryRun });
        }
      } else {
        actions.removed_unexpected_top_level.push(applyRemove(full, 'unexpected_top_level_file'));
      }
    }
  }

  for (const root of [paymentsRoot, adsRoot, baseDir]) {
    actions.recovered_anonymous.push(...recoverAnonymousDownloads(root));
  }

  const scan = scanForNonPdfFiles([paymentsRoot, adsRoot, baseDir]);
  for (const file of [...scan.non_pdf_extension, ...scan.fake_pdfs, ...scan.empty_files]) {
    const base = path.basename(file);
    if (base.endsWith('.json') || base === '.gitkeep') continue;
    applyRemove(file, 'accountant_pdf_only');
  }

  const paymentByKey = new Map();
  const adsById = new Map();

  for (const file of walkAllFiles(baseDir)) {
    const rel = path.relative(baseDir, file).replace(/\\/g, '/');
    const base = path.basename(file);
    if (!isPdfFile(file)) continue;

    const inPaymentsTree = rel.startsWith(`${PAYMENTS_ROOT_NAME}/`) || /^Payments-Summary-Reports\s\(\d+\)\//i.test(rel);
    const inAdsTree = rel.startsWith(`${ADS_ROOT_NAME}/`) || /^Advertising-Invoices\s\(\d+\)\//i.test(rel);

    if (inPaymentsTree) {
      const payKey = paymentKeyFromFilename(base);
      if (!payKey) continue;
      const [market, mk] = payKey.split(':');
      const canonical = paymentsExpectedPath(paymentsRoot, market, Number(mk.slice(0, 4)), Number(mk.slice(5, 7)));
      if (file !== canonical) applyMove(file, canonical, 'payments_flat_relocate');
      const prev = paymentByKey.get(payKey);
      if (!prev) paymentByKey.set(payKey, canonical);
      else if (prev !== file && fs.existsSync(prev)) applyRemove(file, `duplicate_payment_${payKey}`);
      continue;
    }

    if (inAdsTree) {
      const meta = adsCanonicalFromFilename(base);
      if (!meta?.invoiceId) continue;
      const canonical = adsFlatPath(adsRoot, meta);
      if (file !== canonical) applyMove(file, canonical, 'ads_flat_relocate');
      const prev = adsById.get(meta.invoiceId);
      if (!prev) adsById.set(meta.invoiceId, canonical);
      else if (prev !== file && fs.existsSync(prev)) applyRemove(file, `duplicate_invoice_${meta.invoiceId}`);
      continue;
    }

    const payKey = paymentKeyFromFilename(base);
    if (payKey) {
      const [market, mk] = payKey.split(':');
      const canonical = paymentsExpectedPath(paymentsRoot, market, Number(mk.slice(0, 4)), Number(mk.slice(5, 7)));
      applyMove(file, canonical, 'flat_or_legacy_payments_path');
      continue;
    }

    const adsMeta = adsCanonicalFromFilename(base);
    if (adsMeta?.invoiceId) {
      applyMove(file, adsFlatPath(adsRoot, adsMeta), 'flat_or_legacy_ads_path');
    }
  }

  const legacyRoots = [
    path.join(LOCAL_FALLBACK, 'amazon-reports'),
    path.join(LOCAL_FALLBACK, PAYMENTS_ROOT_NAME),
    path.join(LOCAL_FALLBACK, 'amazon-ads-invoices'),
    path.join(LOCAL_FALLBACK, ADS_ROOT_NAME),
    path.join(baseDir, 'downloads'),
  ];
  for (const legacyRoot of legacyRoots) {
    if (!legacyRoot || !fs.existsSync(legacyRoot)) continue;
    for (const file of walkAllFiles(legacyRoot)) {
      const relToLegacy = path.relative(legacyRoot, file).replace(/\\/g, '/');
      const payKey = paymentKeyFromFilename(path.basename(file));
      const adsMeta = adsCanonicalFromFilename(path.basename(file));
      let canonical = null;
      if (payKey) {
        const [market, mk] = payKey.split(':');
        canonical = paymentsExpectedPath(paymentsRoot, market, Number(mk.slice(0, 4)), Number(mk.slice(5, 7)));
      } else if (adsMeta?.invoiceId) {
        canonical = adsFlatPath(adsRoot, adsMeta);
      }
      if (canonical && isPdfFile(file)) {
        if (fs.existsSync(canonical) && isPdfFile(canonical)) {
          actions.removed_legacy_paths.push(applyRemove(file, 'legacy_duplicate_on_drive'));
        } else {
          applyMove(file, canonical, 'legacy_copy_to_drive');
        }
      } else {
        actions.removed_legacy_paths.push(applyRemove(file, 'legacy_orphan'));
      }
    }
    actions.empty_dirs_removed.push(...removeEmptyDirs(legacyRoot));
  }

  for (const file of walkAllFiles(baseDir)) {
    const base = path.basename(file);
    const ext = path.extname(base);
    if ((ext === '' && UUID_FILENAME_RE.test(base)) || (ext === '' && !base.includes('.'))) {
      applyRemove(file, 'extensionless_uuid_or_anonymous');
    }
  }

  actions.empty_dirs_removed.push(
    ...removeEmptyDirs(paymentsRoot),
    ...removeEmptyDirs(adsRoot),
    ...removeEmptyDirs(baseDir),
  );

  return { actions, pdf_scan: formatScanReport(scanForNonPdfFiles([paymentsRoot, adsRoot])) };
}

function indexPaymentsOnDisk(paymentsRoot) {
  const found = new Map();
  for (const root of paymentsScanRoots(paymentsRoot)) {
    if (!fs.existsSync(root)) continue;
    for (const file of walkAllFiles(root)) {
      if (!isPdfFile(file)) continue;
      const key = paymentKeyFromFilename(path.basename(file));
      if (!key || found.has(key)) continue;
      found.set(key, file);
    }
  }
  supplementPaymentsFromSummary(found, paymentsRoot);
  return found;
}

function indexAdsOnDisk(adsRoot) {
  const found = new Map();
  for (const root of adsScanRoots(adsRoot)) {
    if (!fs.existsSync(root)) continue;
    for (const file of walkAllFiles(root)) {
      if (!isPdfFile(file)) continue;
      const id = invoiceIdFromFilename(file);
      if (!id || found.has(id)) continue;
      found.set(id, file);
    }
  }
  supplementAdsFromSummary(found);
  return found;
}

function verifyMatrix({ baseDir, paymentsRoot, adsRoot, cleanup = true, dryRun = false }) {
  const downloadsBase = baseDir;
  const cleanupResult = cleanup
    ? cleanupDownloadsTree({ baseDir, paymentsRoot, adsRoot, dryRun })
    : { actions: {}, pdf_scan: null };

  const exemptions = loadPaymentExemptions();
  const expectedPayments = buildExpectedPaymentsMatrix();
  const paymentsFound = indexPaymentsOnDisk(paymentsRoot);
  const adsFound = indexAdsOnDisk(adsRoot);

  const adsSummary = readJsonSafe(ADS_SUMMARY_PATH);
  const adsIdsFromSummary = collectInvoiceIdsFromAdsSummary(adsSummary);
  const adsManifest = mergeAdsExpectedManifest(adsIdsFromSummary);
  const expectedAdsIds = new Set(adsManifest.invoice_ids || []);
  const adsCatalogReady = expectedAdsIds.size > 0
    || Boolean(adsSummary?.invoices_seen?.length)
    || Boolean(adsManifest.checkpoint)
    || Number(adsSummary?.pages_scanned || adsManifest.pages_scanned || 0) > 0;

  const payments = {
    expected: expectedPayments.length,
    found: 0,
    missing: [],
    exempt: [],
    found_items: [],
  };

  for (const item of expectedPayments) {
    const key = `${item.market}:${item.monthKey}`;
    const expectedPath = paymentsExpectedPath(paymentsRoot, item.market, item.year, item.month);
    const foundPath = paymentsFound.get(key);
    if (foundPath && isPdfFile(foundPath)) {
      payments.found += 1;
      payments.found_items.push({ ...item, path: foundPath });
      continue;
    }
    if (exemptions.has(key)) {
      payments.exempt.push({ ...item, reason: 'not_available_or_csv_only' });
      continue;
    }
    payments.missing.push({
      market: item.market,
      year: item.year,
      month: item.month,
      monthKey: item.monthKey,
      expected_path: expectedPath,
    });
  }

  const ads = {
    expected: expectedAdsIds.size,
    found: 0,
    missing_invoice_ids: [],
    found_invoice_ids: [],
    catalog_ready: adsCatalogReady,
  };

  for (const invoiceId of expectedAdsIds) {
    const foundPath = adsFound.get(invoiceId);
    if (foundPath && isPdfFile(foundPath)) {
      ads.found += 1;
      ads.found_invoice_ids.push({ invoiceId, path: foundPath });
    } else {
      ads.missing_invoice_ids.push(invoiceId);
    }
  }

  const backfillRunning = listRunningBackfillProcesses();
  const adsFoundOnDisk = adsFound.size;
  const adsMissingWhenCatalogReady = adsCatalogReady ? ads.missing_invoice_ids.length : 0;
  const criticalGaps = payments.missing.length + adsMissingWhenCatalogReady;
  const report = {
    verified_at: new Date().toISOString(),
    downloads_base: downloadsBase,
    payments_root: paymentsRoot,
    ads_root: adsRoot,
    backfill_running: backfillRunning,
    cleanup: cleanupResult.actions,
    pdf_scan: cleanupResult.pdf_scan,
    payments: {
      expected: payments.expected,
      effective_expected: payments.expected - payments.exempt.length,
      found: payments.found,
      exempt_count: payments.exempt.length,
      missing_count: payments.missing.length,
      missing: payments.missing,
      exempt: payments.exempt,
      found_items: payments.found_items,
    },
    ads: {
      expected: adsCatalogReady ? ads.expected : null,
      found: ads.found,
      found_on_disk: adsFoundOnDisk,
      missing_count: adsCatalogReady ? ads.missing_invoice_ids.length : null,
      missing_invoice_ids: adsCatalogReady ? ads.missing_invoice_ids : [],
      found_invoice_ids: ads.found_invoice_ids,
      catalog_ready: adsCatalogReady,
      manifest_path: ADS_EXPECTED_MANIFEST_PATH,
    },
    critical_gaps: criticalGaps,
    complete: criticalGaps === 0 && adsCatalogReady,
    partial_backfill_in_progress: backfillRunning.length > 0,
    auth_blocker: null,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  return report;
}

function runVerifyAndCleanup(options = {}) {
  const baseDir = options.downloadsBase || resolveDownloadsBase();
  const { paymentsRoot, adsRoot } = ensureAccountantFolders(baseDir);
  return verifyMatrix({
    baseDir,
    paymentsRoot,
    adsRoot,
    cleanup: options.cleanup !== false,
    dryRun: options.dryRun === true,
  });
}

function buildTargetedRetryParams(report) {
  const payments = report.payments?.missing || [];

  const markets = [...new Set(payments.map((p) => p.market))];
  const years = [...new Set(payments.map((p) => p.year))].sort();
  const months = [...new Set(payments.map((p) => p.month))].sort((a, b) => a - b);

  return {
    payments: payments.length
      ? {
        marketplaces: markets,
        years,
        months,
        report_types: ['summary'],
        skip_existing: true,
        dry_run: false,
        poll_seconds: 240,
      }
      : null,
    ads: (report.ads?.missing_count || 0) > 0
      ? {
        years: ADS_YEARS,
        skip_existing: true,
        dry_run: false,
        limit: 0,
      }
      : null,
  };
}

function spawnRetryBackfills(report) {
  const retry = buildTargetedRetryParams(report);
  const results = [];

  if (retry.payments) {
    const env = {
      ...process.env,
      AMAZON_DOWNLOADS_DIR: process.env.AMAZON_DOWNLOADS_DIR || resolveDownloadsBase(),
      TASK_PARAMS: JSON.stringify(retry.payments),
      REPORT_TASK_PARAMS: JSON.stringify(retry.payments),
    };
    const child = spawnSync('node', [PAYMENTS_SCRIPT], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 5 * 60 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    results.push({
      script: 'amz-payments-reports-download.js',
      status: child.status,
      params: retry.payments,
      tail: String(child.stdout || child.stderr || '').trim().split('\n').slice(-5).join('\n'),
    });
  }

  if (retry.ads) {
    const env = {
      ...process.env,
      AMAZON_DOWNLOADS_DIR: process.env.AMAZON_DOWNLOADS_DIR || resolveDownloadsBase(),
      TASK_PARAMS: JSON.stringify(retry.ads),
      REPORT_TASK_PARAMS: JSON.stringify(retry.ads),
    };
    const child = spawnSync('node', [ADS_SCRIPT], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 3 * 60 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    results.push({
      script: 'amz-ads-invoice-download.js',
      status: child.status,
      params: retry.ads,
      tail: String(child.stdout || child.stderr || '').trim().split('\n').slice(-5).join('\n'),
    });
  }

  return { retry, results };
}

async function main() {
  const args = process.argv.slice(2);
  const noCleanup = args.includes('--no-cleanup');
  const dryRun = args.includes('--dry-run');
  const doRetry = args.includes('--retry');

  let report = runVerifyAndCleanup({ cleanup: !noCleanup, dryRun });
  let retryResult = null;

  if (doRetry && !report.complete && report.backfill_running.length === 0) {
    retryResult = spawnRetryBackfills(report);
    report = runVerifyAndCleanup({ cleanup: !noCleanup, dryRun });
    report.retry = retryResult;
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } else if (doRetry && report.backfill_running.length > 0) {
    report.retry_skipped = 'backfill_already_running';
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  }

  const payload = {
    ok: report.complete,
    critical_gaps: report.critical_gaps,
    backfill_running: report.backfill_running,
    payments: {
      expected: report.payments.expected,
      effective_expected: report.payments.effective_expected,
      found: report.payments.found,
      missing: report.payments.missing_count,
      exempt: report.payments.exempt_count,
    },
    ads: {
      expected: report.ads.expected,
      found: report.ads.found,
      missing: report.ads.missing_count,
    },
    cleanup_actions: summarizeCleanup(report.cleanup),
    report_path: REPORT_PATH,
    retry: retryResult,
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(report.complete ? 0 : 1);
}

function summarizeCleanup(cleanup = {}) {
  return {
    moved: (cleanup.moved_to_canonical || []).length,
    removed_invalid: (cleanup.removed_invalid || []).filter((r) => r.removed).length,
    removed_duplicates: (cleanup.removed_duplicates || []).length,
    removed_legacy: (cleanup.removed_legacy_paths || []).filter((r) => r && r.removed).length,
    removed_unexpected_top_level: (cleanup.removed_unexpected_top_level || []).filter((r) => r && r.removed).length,
    empty_dirs_removed: (cleanup.empty_dirs_removed || []).length,
    duplicate_folders_removed: (cleanup.duplicate_folders_removed || []).length,
    payments_duplicate_folders: cleanup.consolidation?.payments?.duplicates_found?.length || 0,
    ads_duplicate_folders: cleanup.consolidation?.ads?.duplicates_found?.length || 0,
    recovered_anonymous: (cleanup.recovered_anonymous || []).length,
  };
}

module.exports = {
  REPORT_PATH,
  PAYMENT_MARKETS,
  PAYMENT_YEARS,
  PAYMENT_MONTHS,
  ADS_YEARS,
  buildExpectedPaymentsMatrix,
  runVerifyAndCleanup,
  buildTargetedRetryParams,
  spawnRetryBackfills,
  listRunningBackfillProcesses,
  summarizeCleanup,
  paymentsExpectedFilename,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message, report_path: REPORT_PATH }));
    process.exit(1);
  });
}
