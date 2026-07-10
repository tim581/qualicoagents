'use strict';

const fs = require('fs');
const path = require('path');
const { isPdfFile, safeMoveSync, walkAllFiles } = require('./amz-pdf-utils');

const DRIVE_FOLDER_ID = '12qxJhvyeppJepxbfFNhgKiEt9WGD3zyo';
const DRIVE_SHORTCUT_ROOT = path.join(
  'H:',
  '.shortcut-targets-by-id',
  DRIVE_FOLDER_ID,
  'Amazon Invoices Browser automations',
);
const LOCAL_FALLBACK = path.join(__dirname, '..', 'downloads');
const PAYMENTS_ROOT_NAME = 'Payments-Summary-Reports';
const ADS_ROOT_NAME = 'Advertising-Invoices';

const PAYMENTS_FILE_RE = /^([A-Z]{2})_Payments_Summary_(\d{4}-\d{2})\.pdf$/i;
/** Full flat name: INVOICE-{id}_{YYYY-MM}_{market}_{currency}.pdf */
const ADS_FILE_RE = /^INVOICE-([A-Z0-9]+)_(\d{4}-\d{2})_([A-Z]{2,})_([A-Z]{3})\.pdf$/i;
/** Compact flat name on Drive: INVOICE-{id}_{YYYY-MM}_{currency}.pdf */
const ADS_FILE_RE_FLAT = /^INVOICE-([A-Z0-9]+)_(\d{4}-\d{2})_([A-Z]{3})\.pdf$/i;
const INVOICE_ID_PREFIX_RE = /^INVOICE-([A-Z0-9]+)(?:_|\.)/i;
const INVOICE_ID_BARE_RE = /^([A-Z0-9]+PA\d{2})$/i;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveDownloadsBase() {
  if (process.env.AMAZON_DOWNLOADS_DIR) return process.env.AMAZON_DOWNLOADS_DIR;
  if (process.env.GOOGLE_DRIVE_AMAZON_FOLDER) return process.env.GOOGLE_DRIVE_AMAZON_FOLDER;
  if (fs.existsSync(DRIVE_SHORTCUT_ROOT)) return DRIVE_SHORTCUT_ROOT;
  return LOCAL_FALLBACK;
}

function parseCanonicalFolderName(folderName, canonicalName) {
  if (folderName === canonicalName) return { exact: true, suffix: 0, name: folderName };
  const re = new RegExp(`^${escapeRegex(canonicalName)}\\s\\((\\d+)\\)$`);
  const m = folderName.match(re);
  if (m) return { exact: false, suffix: Number(m[1]), name: folderName };
  return null;
}

function findCanonicalFolders(baseDir, canonicalName) {
  if (!baseDir || !fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const meta = parseCanonicalFolderName(entry.name, canonicalName);
      if (!meta) return null;
      return {
        ...meta,
        path: path.join(baseDir, entry.name),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      return a.suffix - b.suffix;
    });
}

/**
 * Prefer exact canonical folder name; reuse numbered Drive duplicates instead of mkdir (prevents (N+1)).
 */
function resolveCanonicalFolderPath(baseDir, canonicalName) {
  fs.mkdirSync(baseDir, { recursive: true });
  const matches = findCanonicalFolders(baseDir, canonicalName);
  const exact = matches.find((m) => m.exact);
  if (exact) return exact.path;
  if (matches.length > 0) return matches[0].path;

  const target = path.join(baseDir, canonicalName);
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (err) {
    const retry = findCanonicalFolders(baseDir, canonicalName);
    if (retry.length > 0) return retry[0].path;
    throw err;
  }
  return target;
}

function paymentsFlatFilename(marketCode, monthKey) {
  return `${String(marketCode).toUpperCase()}_Payments_Summary_${monthKey}.pdf`;
}

function paymentsFlatPath(paymentsRoot, marketCode, monthKey) {
  return path.join(paymentsRoot, paymentsFlatFilename(marketCode, monthKey));
}

function paymentsExpectedPath(paymentsRoot, market, year, month) {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  return paymentsFlatPath(paymentsRoot, market, monthKey);
}

function invoiceIdFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  const fromPrefix = base.match(INVOICE_ID_PREFIX_RE);
  if (fromPrefix) return fromPrefix[1].toUpperCase();
  const bare = base.match(INVOICE_ID_BARE_RE);
  return bare ? bare[1].toUpperCase() : null;
}

function paymentKeyFromFilename(filename) {
  const m = path.basename(filename).match(PAYMENTS_FILE_RE);
  if (!m) return null;
  return `${m[1].toUpperCase()}:${m[2]}`;
}

function adsCanonicalFilename(meta) {
  if (meta.filename && meta.filename.startsWith('INVOICE-')) return meta.filename;
  if (meta.filename) return meta.filename;
  const monthKey = meta.monthKey || 'unknown';
  const market = meta.market || 'UNKNOWN';
  const currency = meta.currency || 'UNK';
  return `INVOICE-${meta.invoiceId}_${monthKey}_${market}_${currency}.pdf`;
}

function adsCanonicalFromFilename(filename) {
  const base = path.basename(filename);
  const full = base.match(ADS_FILE_RE);
  if (full) {
    return {
      invoiceId: full[1].toUpperCase(),
      monthKey: full[2],
      market: full[3].toUpperCase(),
      currency: full[4].toUpperCase(),
      filename: base,
    };
  }
  const flat = base.match(ADS_FILE_RE_FLAT);
  if (flat) {
    return {
      invoiceId: flat[1].toUpperCase(),
      monthKey: flat[2],
      currency: flat[3].toUpperCase(),
      filename: base,
    };
  }
  const id = invoiceIdFromFilename(base);
  if (!id) return null;
  return { invoiceId: id, filename: base };
}

function adsFlatPath(adsRoot, filenameOrMeta) {
  const meta = typeof filenameOrMeta === 'string'
    ? adsCanonicalFromFilename(filenameOrMeta)
    : filenameOrMeta;
  if (!meta) return null;
  return path.join(adsRoot, adsCanonicalFilename(meta));
}

function classifyPdfFilename(filename) {
  const base = path.basename(filename);
  const payKey = paymentKeyFromFilename(base);
  if (payKey) {
    const [market, monthKey] = payKey.split(':');
    return { type: 'payments', market, monthKey, filename: base };
  }
  const adsMeta = adsCanonicalFromFilename(base);
  if (adsMeta?.invoiceId) return { type: 'ads', ...adsMeta };
  return null;
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

function movePdfKeepingNewest(from, to, actions, reason, dryRun = false) {
  if (from === to) return;
  if (dryRun) {
    actions.moved.push({ from, to, reason, dry_run: true });
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!fs.existsSync(to)) {
    safeMoveSync(from, to);
    actions.moved.push({ from, to, reason });
    return;
  }
  const srcStat = fs.statSync(from);
  const destStat = fs.statSync(to);
  if (srcStat.mtimeMs > destStat.mtimeMs) {
    safeMoveSync(from, to);
    actions.moved.push({ from, to, reason: `${reason}_replaced_older` });
  } else {
    fs.unlinkSync(from);
    actions.removed_duplicates.push({ path: from, kept: to, reason: `${reason}_older_duplicate` });
  }
}

function consolidateCanonicalFolderGroup(baseDir, canonicalName, dryRun = false) {
  const actions = {
    canonical_name: canonicalName,
    duplicates_found: [],
    moved: [],
    removed_duplicates: [],
    removed_dirs: [],
    empty_dirs_removed: [],
  };

  const matches = findCanonicalFolders(baseDir, canonicalName);
  actions.duplicates_found = matches.map((m) => m.path);
  if (matches.length === 0) {
    const target = path.join(baseDir, canonicalName);
    if (!dryRun) fs.mkdirSync(target, { recursive: true });
    return { target, actions };
  }

  let targetPath = path.join(baseDir, canonicalName);
  const exact = matches.find((m) => m.exact);
  if (exact) targetPath = exact.path;
  else if (!dryRun) fs.mkdirSync(targetPath, { recursive: true });

  const bestByKey = new Map();
  for (const folder of matches) {
    for (const file of walkAllFiles(folder.path)) {
      if (!isPdfFile(file)) continue;
      const base = path.basename(file);
      const cls = classifyPdfFilename(base);
      const key = cls?.type === 'payments'
        ? `pay:${cls.market}:${cls.monthKey}`
        : cls?.type === 'ads'
          ? `ads:${cls.invoiceId}`
          : `file:${base}`;
      const prev = bestByKey.get(key);
      if (!prev) {
        bestByKey.set(key, file);
        continue;
      }
      const keep = fs.statSync(file).mtimeMs > fs.statSync(prev).mtimeMs ? file : prev;
      bestByKey.set(key, keep);
    }
  }

  for (const [, file] of bestByKey) {
    const base = path.basename(file);
    const cls = classifyPdfFilename(base);
    let dest;
    if (cls?.type === 'payments') {
      dest = paymentsFlatPath(targetPath, cls.market, cls.monthKey);
    } else if (cls?.type === 'ads') {
      dest = adsFlatPath(targetPath, cls);
    } else {
      dest = path.join(targetPath, base);
    }
    movePdfKeepingNewest(file, dest, actions, 'consolidate_to_flat', dryRun);
  }

  for (const folder of matches) {
    if (folder.path === targetPath) {
      if (!dryRun) actions.empty_dirs_removed.push(...removeEmptyDirs(folder.path));
      continue;
    }
    if (!dryRun) {
      actions.empty_dirs_removed.push(...removeEmptyDirs(folder.path));
      if (fs.existsSync(folder.path)) {
        try {
          fs.rmdirSync(folder.path, { recursive: true });
          actions.removed_dirs.push(folder.path);
        } catch (_) { /* Drive may still be syncing */ }
      }
    } else {
      actions.removed_dirs.push({ path: folder.path, dry_run: true });
    }
  }

  return { target: targetPath, actions };
}

function consolidateAccountantTree(baseDir, { dryRun = false } = {}) {
  fs.mkdirSync(baseDir, { recursive: true });
  const payments = consolidateCanonicalFolderGroup(baseDir, PAYMENTS_ROOT_NAME, dryRun);
  const ads = consolidateCanonicalFolderGroup(baseDir, ADS_ROOT_NAME, dryRun);

  const paymentsRoot = payments.target;
  const adsRoot = ads.target;
  const sweepActions = { moved: [], removed_duplicates: [], empty_dirs_removed: [] };

  for (const file of walkAllFiles(baseDir)) {
    const rel = path.relative(baseDir, file).replace(/\\/g, '/');
    if (!isPdfFile(file)) continue;
    if (rel.startsWith(`${PAYMENTS_ROOT_NAME}/`) || rel.startsWith(`${ADS_ROOT_NAME}/`)) continue;
    if (/^Advertising-Invoices\s\(\d+\)\//i.test(rel) || /^Payments-Summary-Reports\s\(\d+\)\//i.test(rel)) {
      continue;
    }

    const base = path.basename(file);
    const cls = classifyPdfFilename(base);
    if (!cls) continue;
    const dest = cls.type === 'payments'
      ? paymentsFlatPath(paymentsRoot, cls.market, cls.monthKey)
      : adsFlatPath(adsRoot, cls);
    if (!dest) continue;
    movePdfKeepingNewest(file, dest, sweepActions, 'orphan_outside_canonical', dryRun);
  }

  if (!dryRun) {
    sweepActions.empty_dirs_removed.push(
      ...removeEmptyDirs(paymentsRoot),
      ...removeEmptyDirs(adsRoot),
      ...removeEmptyDirs(baseDir),
    );
  }

  return {
    baseDir,
    paymentsRoot,
    adsRoot,
    payments: payments.actions,
    ads: ads.actions,
    sweep: sweepActions,
  };
}

function ensureAccountantFolders(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  const paymentsRoot = resolveCanonicalFolderPath(baseDir, PAYMENTS_ROOT_NAME);
  const adsRoot = resolveCanonicalFolderPath(baseDir, ADS_ROOT_NAME);
  return { paymentsRoot, adsRoot, baseDir };
}

module.exports = {
  DRIVE_FOLDER_ID,
  DRIVE_SHORTCUT_ROOT,
  LOCAL_FALLBACK,
  PAYMENTS_ROOT_NAME,
  ADS_ROOT_NAME,
  PAYMENTS_FILE_RE,
  ADS_FILE_RE,
  ADS_FILE_RE_FLAT,
  INVOICE_ID_PREFIX_RE,
  INVOICE_ID_BARE_RE,
  resolveDownloadsBase,
  findCanonicalFolders,
  resolveCanonicalFolderPath,
  paymentsFlatFilename,
  paymentsFlatPath,
  paymentsExpectedPath,
  adsFlatPath,
  adsCanonicalFromFilename,
  adsCanonicalFilename,
  paymentKeyFromFilename,
  invoiceIdFromFilename,
  classifyPdfFilename,
  consolidateAccountantTree,
  consolidateCanonicalFolderGroup,
  ensureAccountantFolders,
};
