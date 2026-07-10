'use strict';

/**
 * amz-ads-invoice-download.js — download Amazon Ads billing invoices (Paid tab)
 *
 * Usage:
 *   node scripts/amz-ads-invoice-download.js
 *   node scripts/amz-ads-invoice-download.js --limit 3
 *   node scripts/amz-ads-invoice-download.js --years 2025,2026
 *   TASK_PARAMS='{"limit":3,"years":[2025,2026]}' node scripts/amz-ads-invoice-download.js
 */

const fs = require('fs');
const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) { /* optional */ }
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const {
  resolveDownloadsBase,
  ensureAccountantFolders,
  ADS_ROOT_NAME,
  adsFlatPath,
  invoiceIdFromFilename,
  DRIVE_FOLDER_ID,
  LOCAL_FALLBACK,
} = require('./amz-accountant-paths');
const {
  isPdfBuffer,
  isPdfFile,
  saveVerifiedPdf,
  savePlaywrightDownload,
  scanForNonPdfFiles,
  formatScanReport,
  removeInvalidFile,
  recoverAnonymousDownloads,
} = require('./amz-pdf-utils');

const STORAGE_STATE_PATH = path.join(__dirname, 'amazon-storage-state.json');
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_AMAZON_FOLDER_ID || DRIVE_FOLDER_ID;
const DOWNLOADS_BASE = resolveDownloadsBase();
const { adsRoot: OUTPUT_ROOT } = ensureAccountantFolders(DOWNLOADS_BASE);
const SUMMARY_PATH = path.join(__dirname, 'amz-ads-invoice-download-summary.json');
const ADS_EXPECTED_MANIFEST_PATH = path.join(__dirname, 'amz-ads-expected-invoices.json');
const ENTITY_ID = 'ENTITY3OZKYXF1S6KJ4';
const BILLING_URL = `https://advertising.amazon.com/ads-bg/billing/history?entityId=${ENTITY_ID}&invoiceTab=%2522paid%2522`;
const DEFAULT_YEARS = [2025, 2026];
const MIN_INVOICE_DOWNLOAD_BUTTONS = 20;
const MAX_PAGE_COUNT = 200;
const MAX_DOWNLOAD_RETRIES = 3;
const DOC_TYPES = ['INVOICE', 'CREDIT_MEMO', 'GIS_INVOICE', 'GIS_CREDIT_MEMO', 'PAYMENT_COMPLEMENT'];
const INVOICE_ID_RE = /\b([A-Z0-9]{6,}[A-Z0-9]*PA\d{2})\b/i;

const COUNTRY_NAME_TO_CODE = {
  'United States': 'US',
  Canada: 'CA',
  'United Kingdom': 'UK',
  Germany: 'DE',
  France: 'FR',
  Italy: 'IT',
  Spain: 'ES',
  Netherlands: 'NL',
  Belgium: 'BE',
  Sweden: 'SE',
  Poland: 'PL',
  Turkey: 'TR',
  Mexico: 'MX',
  Australia: 'AU',
  Japan: 'JP',
  India: 'IN',
  Brazil: 'BR',
  Singapore: 'SG',
  'United Arab Emirates': 'AE',
  'Saudi Arabia': 'SA',
  Egypt: 'EG',
};

function parseArgs(argv) {
  const opts = {
    limit: 0,
    years: DEFAULT_YEARS,
    invoiceIds: null,
    headless: process.env.PLAYWRIGHT_HEADLESS === '1' || process.env.HEADLESS === '1',
    dryRun: false,
    skipExisting: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit' && argv[i + 1]) opts.limit = Number(argv[++i]) || 0;
    else if (arg === '--years' && argv[i + 1]) {
      opts.years = argv[++i].split(',').map((y) => Number(y.trim())).filter((y) => y >= 2000);
    } else if ((arg === '--invoice-ids' || arg === '--invoice_ids') && argv[i + 1]) {
      opts.invoiceIds = argv[++i].split(',').map((id) => String(id).trim().toUpperCase()).filter(Boolean);
    } else if (arg === '--headless') opts.headless = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-skip-existing') opts.skipExisting = false;
  }
  return opts;
}

function parseTaskInput(task = {}) {
  const first = Array.isArray(task.actions) && task.actions.length > 0 ? task.actions[0] : {};
  const input = (first && typeof first === 'object') ? first : {};
  const invoiceIds = Array.isArray(input.invoice_ids) && input.invoice_ids.length
    ? input.invoice_ids.map((id) => String(id).trim().toUpperCase()).filter(Boolean)
    : (Array.isArray(input.invoiceIds) && input.invoiceIds.length
      ? input.invoiceIds.map((id) => String(id).trim().toUpperCase()).filter(Boolean)
      : null);
  return {
    limit: Number(input.limit) || 0,
    years: Array.isArray(input.years) && input.years.length
      ? input.years.map((y) => Number(y)).filter((y) => y >= 2000)
      : DEFAULT_YEARS,
    invoiceIds,
    headless: input.headless === true || process.env.PLAYWRIGHT_HEADLESS === '1',
    dryRun: input.dry_run === true || input.dryRun === true,
    skipExisting: input.skip_existing !== false,
    invoiceIds: Array.isArray(input.invoice_ids) && input.invoice_ids.length
      ? input.invoice_ids.map((id) => String(id).toUpperCase())
      : (Array.isArray(input.invoiceIds) && input.invoiceIds.length
        ? input.invoiceIds.map((id) => String(id).toUpperCase())
        : null),
  };
}

function sanitizeFilename(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function currencyFromRowText(rowText) {
  const s = String(rowText || '');
  if (/\bCA\$/i.test(s)) return 'CAD';
  if (/£/.test(s)) return 'GBP';
  if (/€/.test(s)) return 'EUR';
  if (/\$/.test(s)) return 'USD';
  if (/\bPLN\b/i.test(s)) return 'PLN';
  if (/\bSEK\b/i.test(s)) return 'SEK';
  if (/\bMXN\b/i.test(s)) return 'MXN';
  if (/\bAUD\b/i.test(s)) return 'AUD';
  if (/\bJPY\b/i.test(s)) return 'JPY';
  if (/\bINR\b/i.test(s)) return 'INR';
  return 'UNK';
}

function invoiceMonthKey(issuedDate) {
  if (!issuedDate || Number.isNaN(issuedDate.getTime())) return 'unknown';
  return `${issuedDate.getUTCFullYear()}-${String(issuedDate.getUTCMonth() + 1).padStart(2, '0')}`;
}

function invoiceFilename(invoiceId, issuedDate, currency, countryCode) {
  const monthKey = invoiceMonthKey(issuedDate);
  const cur = sanitizeFilename(currency || 'UNK');
  const market = sanitizeFilename(countryCode || 'XX');
  return `INVOICE-${sanitizeFilename(invoiceId)}_${monthKey}_${market}_${cur}.pdf`;
}

function checkpointAdsCatalog(seen, summary) {
  const invoiceIds = Array.from(seen).sort();
  summary.invoices_seen = invoiceIds;
  const manifest = {
    invoice_ids: invoiceIds,
    updated_at: new Date().toISOString(),
    years: summary.years || DEFAULT_YEARS,
    pages_scanned: summary.pages_scanned || 0,
    checkpoint: true,
  };
  try {
    fs.writeFileSync(ADS_EXPECTED_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  } catch (_) { /* Drive FS may be busy during backfill */ }
}

function invoiceOutputPath(year, countryCode, invoiceId, issuedDate, currency) {
  return adsFlatPath(OUTPUT_ROOT, {
    invoiceId,
    monthKey: invoiceMonthKey(issuedDate),
    market: countryCode,
    currency,
    filename: invoiceFilename(invoiceId, issuedDate, currency, countryCode),
  });
}

function walkVerifiedPdfFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkVerifiedPdfFiles(full, out);
    else if (isPdfFile(full)) out.push(full);
    else if (fs.existsSync(full)) removeInvalidFile(full, 'invalid_pdf_header');
  }
  return out;
}

function invoiceIdFromFilenameLocal(filename) {
  return invoiceIdFromFilename(filename);
}

function buildExistingInvoiceIndex() {
  const index = new Map();
  const roots = new Set([
    OUTPUT_ROOT,
    path.join(LOCAL_FALLBACK, 'amazon-ads-invoices'),
    path.join(LOCAL_FALLBACK, ADS_ROOT_NAME),
  ]);
  for (const root of roots) {
    for (const file of walkVerifiedPdfFiles(root)) {
      const id = invoiceIdFromFilenameLocal(file);
      if (id && !index.has(id)) index.set(id, file);
    }
  }
  return index;
}

function findExistingInvoicePath(existingIndex, year, countryCode, invoiceId, issuedDate, currency) {
  const indexed = existingIndex.get(invoiceId);
  if (indexed && isPdfFile(indexed)) return indexed;
  if (indexed && fs.existsSync(indexed)) removeInvalidFile(indexed, 'invalid_pdf_header');

  const primary = invoiceOutputPath(year, countryCode, invoiceId, issuedDate, currency);
  if (isPdfFile(primary)) return primary;
  if (fs.existsSync(primary)) removeInvalidFile(primary, 'invalid_pdf_header');

  const legacyDir = path.join(OUTPUT_ROOT, String(year), countryCode);
  const legacy = path.join(legacyDir, `${sanitizeFilename(invoiceId)}.pdf`);
  if (isPdfFile(legacy)) return legacy;
  if (fs.existsSync(legacy)) removeInvalidFile(legacy, 'invalid_pdf_header');

  const flatLegacy = path.join(OUTPUT_ROOT, String(year), `${sanitizeFilename(invoiceId)}.pdf`);
  if (isPdfFile(flatLegacy)) return flatLegacy;
  if (fs.existsSync(flatLegacy)) removeInvalidFile(flatLegacy, 'invalid_pdf_header');

  const flatRoot = path.join(OUTPUT_ROOT, `INVOICE-${sanitizeFilename(invoiceId)}.pdf`);
  if (isPdfFile(flatRoot)) return flatRoot;
  if (fs.existsSync(flatRoot)) removeInvalidFile(flatRoot, 'invalid_pdf_header');
  return null;
}

function auditAdsDownloads() {
  const roots = [
    OUTPUT_ROOT,
    path.join(LOCAL_FALLBACK, 'amazon-ads-invoices'),
    path.join(LOCAL_FALLBACK, ADS_ROOT_NAME),
  ];
  const scan = scanForNonPdfFiles(roots);
  const removed = [];
  for (const file of [...scan.non_pdf_extension, ...scan.fake_pdfs, ...scan.empty_files]) {
    removed.push(removeInvalidFile(file, 'accountant_pdf_only'));
  }
  return { ...formatScanReport(scan), removed };
}

function assertInvoicePdfBody(body, invoiceId, contentType = '') {
  if (!isPdfBuffer(body)) {
    const preview = body && body.length > 0
      ? body.slice(0, 80).toString('utf8').replace(/\s+/g, ' ').slice(0, 60)
      : '(empty)';
    throw new Error(
      `ACCOUNTANT PDF REQUIRED: invoice ${invoiceId} is not a PDF`
      + ` (content-type=${contentType || 'unknown'}, preview=${preview})`,
    );
  }
}

function pickPdfDocument(availableDocuments = []) {
  const docs = availableDocuments.filter((d) => d?.storagePath);
  return docs.find((d) => d.docType === 'INVOICE' && /pdf/i.test(d.contentType || d.fileName || ''))
    || docs.find((d) => d.docType === 'INVOICE')
    || docs.find((d) => /pdf/i.test(d.contentType || d.fileName || ''))
    || null;
}

function safeWriteFile(filePath, body, retries = 4) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const start = Date.now();
        while (Date.now() - start < 400 * attempt) { /* brief backoff for Drive FS */ }
      }
    }
  }
  throw lastError;
}

function parseDateFromRow(text) {
  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const s = String(text || '').replace(/\u00a0/g, ' ');
  let m = s.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
  if (m) {
    const mon = months[m[1].toLowerCase()];
    if (mon != null) return new Date(Date.UTC(Number(m[3]), mon, Number(m[2])));
  }
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (m) {
    const mon = months[m[2].toLowerCase()];
    if (mon != null) return new Date(Date.UTC(Number(m[3]), mon, Number(m[1])));
  }
  return null;
}

function yearInRange(date, years) {
  if (!date || Number.isNaN(date.getTime())) return false;
  return years.includes(date.getUTCFullYear());
}

function invoiceIdFromRowText(rowText) {
  const match = String(rowText || '').match(/\b([A-Z0-9]{6,}[A-Z0-9]*PA\d{2})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function countryFromRowText(rowText) {
  const names = Object.keys(COUNTRY_NAME_TO_CODE).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (rowText.includes(name)) return { name, code: COUNTRY_NAME_TO_CODE[name] };
  }
  const codeMatch = rowText.match(/\b(US|CA|UK|DE|FR|IT|ES|NL|BE|SE|PL|TR|MX|AU|JP|IN|BR|SG|AE|SA|EG)\b/);
  if (codeMatch) return { name: codeMatch[1], code: codeMatch[1] };
  return { name: 'UNKNOWN', code: 'UNKNOWN' };
}

function isInvoiceRow(rowText) {
  if (!rowText) return false;
  if (!invoiceIdFromRowText(rowText)) return false;
  return /paid in full|seller payable|written off/i.test(rowText);
}

async function ensureAdsAuth(page) {
  await page.goto(BILLING_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const url = page.url();
    if (/\/ap\/signin|\/signin|\/auth\//i.test(url)) {
      throw new Error('Amazon Ads sign-in required — refresh amazon-storage-state.json via convert-amazon-cookies.js or amazon-save-cookies.js');
    }
    const body = await page.locator('body').innerText().catch(() => '');
    if (/sign in|log in/i.test(body) && !/billing/i.test(body)) {
      throw new Error('Amazon Ads login prompt detected — refresh amazon-storage-state.json');
    }
    const dl = await page.getByRole('button', { name: /^download$/i }).count();
    const rpp = await page.getByText(/results per page/i).count();
    if (dl >= MIN_INVOICE_DOWNLOAD_BUTTONS && rpp > 0) {
      return { url, downloadButtons: dl, rppControls: rpp };
    }
  }
  const dl = await page.getByRole('button', { name: /^download$/i }).count();
  const rpp = await page.getByText(/results per page/i).count();
  throw new Error(`Amazon Ads billing invoices did not finish loading (downloads=${dl}, rpp=${rpp}, need >=${MIN_INVOICE_DOWNLOAD_BUTTONS})`);
}

async function captureAdsApiHeaders(page) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for Amazon Ads API headers')), 90000);
    const handler = (req) => {
      const url = req.url();
      if (!/a9g-api-gateway\/billing\/documents\//.test(url)) return;
      const headers = req.headers();
      if (!headers['amazon-advertising-api-csrf-token']) return;
      page.off('request', handler);
      clearTimeout(timeout);
      resolve(headers);
    };
    page.on('request', handler);
  });
}

async function countInvoiceRows(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[role="row"], .ag-row'));
    return rows.filter((r) => /paid in full|seller payable/i.test(r.innerText)).length;
  });
}

async function setResultsPerPage(page, value = 200) {
  const rowCount = await countInvoiceRows(page).catch(() => 0);
  if (rowCount >= value) return value;

  const current = await verifyResultsPerPage(page, value).catch(() => null);
  if (current === value) return value;

  const rpp = page.getByText(/results per page/i).last();
  await rpp.scrollIntoViewIfNeeded().catch(() => {});
  const btn = rpp.locator('xpath=ancestor::*[.//button][1]//button').last();
  await btn.click({ timeout: 10000 }).catch(() => {});

  const clicked = await page.getByRole('option', { name: String(value) }).first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) {
    await page.getByText(new RegExp(`^${value}$`)).first().click({ timeout: 5000 }).catch(async () => {
      await page.locator('[role="listbox"] [role="option"], li, button').filter({ hasText: String(value) }).first()
        .click({ timeout: 5000 }).catch(() => {});
    });
  }
  await page.waitForTimeout(3000);

  const after = await verifyResultsPerPage(page, value).catch(() => null);
  if (after === value) return value;

  const rowsAfter = await countInvoiceRows(page).catch(() => rowCount);
  if (rowsAfter >= 20) return rowsAfter;

  throw new Error(`Results per page not set to ${value} (${rowsAfter} invoice rows visible)`);
}

async function verifyResultsPerPage(page, value = 200) {
  const rpp = page.getByText(/results per page/i).last();
  const container = rpp.locator('xpath=ancestor::*[.//button][1]').last();
  const text = await container.innerText().catch(() => '');
  if (new RegExp(`\\b${value}\\b`).test(text)) return value;
  const rowCount = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[role="row"], .ag-row'));
    return rows.filter((r) => /paid in full|seller payable/i.test(r.innerText)).length;
  });
  if (rowCount >= Math.min(value, 20)) return value;
  throw new Error(`Results per page not set to ${value} (control shows "${text.trim().slice(0, 40)}", ${rowCount} invoice rows visible)`);
}

async function dismissInvoiceDownloadMenu(page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);
}

async function findInvoiceDownloadLink(page, invoiceId) {
  const roots = [
    page.locator('#adx-portal-host'),
    page.locator('[role="menu"], [role="listbox"], [class*="popover" i], [class*="Popover" i], [class*="dropdown" i], [class*="menu" i]'),
    page,
  ];
  for (const root of roots) {
    if (invoiceId) {
      const byId = root.getByRole('link', { name: new RegExp(`INVOICE-${invoiceId}\\.pdf`, 'i') })
        .or(root.getByRole('menuitem', { name: new RegExp(`INVOICE-${invoiceId}`, 'i') }))
        .or(root.getByText(new RegExp(`INVOICE-${invoiceId}\\.pdf`, 'i')));
      if ((await byId.count()) > 0) {
        const link = byId.last();
        if (await link.isVisible({ timeout: 1000 }).catch(() => false)) return link;
      }
    }
    const generic = root.getByRole('link', { name: /^INVOICE-.*\.pdf$/i })
      .or(root.locator('a, [role="menuitem"], button').filter({ hasText: /INVOICE-[\w-]+\.pdf/i }));
    const count = await generic.count();
    if (count > 0) {
      const link = generic.last();
      if (await link.isVisible({ timeout: 1000 }).catch(() => false)) return link;
    }
  }
  return null;
}

async function waitForInvoiceDownloadLink(page, invoiceId, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const link = await findInvoiceDownloadLink(page, invoiceId);
    if (link) return link;
    await page.waitForTimeout(250);
  }
  return null;
}

async function readInvoiceRows(page) {
  return page.evaluate(() => {
    const rows = [];
    const candidates = Array.from(document.querySelectorAll('[role="row"], .ag-row'));
    for (const row of candidates) {
      const text = row.innerText.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (!/\b[A-Z0-9]{6,}[A-Z0-9]*PA\d{2}\b/i.test(text)) continue;
      if (!/paid in full|seller payable|written off/i.test(text)) continue;
      const btn = Array.from(row.querySelectorAll('button')).find((b) => /^download$/i.test((b.textContent || '').trim()));
      if (!btn) continue;
      rows.push({ text, rowIndex: rows.length });
    }
    return rows;
  });
}

function documentsApiUrl(invoiceId) {
  const params = DOC_TYPES.map((t) => `docType=${encodeURIComponent(t)}`).join('&');
  return `https://advertising.amazon.com/a9g-api-gateway/billing/documents/${encodeURIComponent(invoiceId)}?${params}`;
}

async function fetchInvoiceFile(page, apiHeaders, invoiceId) {
  const apiResp = await page.request.get(documentsApiUrl(invoiceId), { headers: apiHeaders });
  if (!apiResp.ok()) {
    throw new Error(`documents API ${apiResp.status()} for ${invoiceId}`);
  }
  const json = await apiResp.json();
  const doc = pickPdfDocument(json.availableDocuments || []);
  if (!doc?.storagePath) {
    throw new Error(`No PDF invoice document for ${invoiceId}`);
  }
  const fileResp = await page.request.get(doc.storagePath);
  if (!fileResp.ok()) {
    throw new Error(`S3 fetch ${fileResp.status()} for ${invoiceId}`);
  }
  const contentType = fileResp.headers()['content-type'] || doc.contentType || '';
  const body = await fileResp.body();
  assertInvoicePdfBody(body, invoiceId, contentType);
  return {
    body,
    contentType: contentType || 'application/pdf',
    fileName: doc.fileName || `INVOICE-${invoiceId}.pdf`,
    docType: doc.docType || 'INVOICE',
  };
}

async function waitForInvoiceDownloadOption(page, invoiceId, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const link = await findInvoiceDownloadLink(page, invoiceId);
    if (link) return { kind: 'link', locator: link };

    const byId = page.getByRole('option', { name: new RegExp(`INVOICE-${invoiceId}\\.pdf`, 'i') });
    if (await byId.count() > 0) {
      const option = byId.last();
      if (await option.isVisible({ timeout: 500 }).catch(() => false)) return { kind: 'option', locator: option };
    }
    const generic = page.getByRole('option', { name: /INVOICE-.*\.pdf/i });
    if (await generic.count() > 0) {
      const option = generic.last();
      if (await option.isVisible({ timeout: 500 }).catch(() => false)) return { kind: 'option', locator: option };
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function downloadInvoiceViaUi(page, rowLocator, invoiceId, apiHeaders, savePath) {
  const downloadBtn = rowLocator.getByRole('button', { name: /^download$/i });
  await downloadBtn.scrollIntoViewIfNeeded();
  await dismissInvoiceDownloadMenu(page);

  const responsePromise = page.waitForResponse(
    (r) => new RegExp(`/billing/documents/${invoiceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(r.url())
      && (r.headers()['content-type'] || '').includes('json'),
    { timeout: 30000 },
  ).catch(() => null);

  // Step 1: open the row's Download dropdown.
  await downloadBtn.click({ timeout: 10000 });

  // Step 2: click the INVOICE-*.pdf filename in the popup when present.
  const target = await waitForInvoiceDownloadOption(page, invoiceId, 10000);
  if (target) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      target.locator.click({ timeout: 10000 }),
    ]);
    await savePlaywrightDownload(download, savePath, `invoice ${invoiceId}`);
    const body = fs.readFileSync(savePath);
    await dismissInvoiceDownloadMenu(page);
    return {
      body,
      contentType: 'application/pdf',
      fileName: path.basename(savePath),
      docType: 'INVOICE',
      method: target.kind === 'link' ? 'two-step-link' : 'two-step-option',
      savedViaUi: true,
    };
  }

  const response = await responsePromise;
  if (response) {
    const json = await response.json();
    const doc = pickPdfDocument(json.availableDocuments || []);
    if (doc?.storagePath) {
      const fileResp = await page.request.get(doc.storagePath);
      if (fileResp.ok()) {
        const contentType = fileResp.headers()['content-type'] || doc.contentType || '';
        const body = await fileResp.body();
        assertInvoicePdfBody(body, invoiceId, contentType);
        await dismissInvoiceDownloadMenu(page);
        return {
          body,
          contentType: contentType || 'application/pdf',
          fileName: doc.fileName || `INVOICE-${invoiceId}.pdf`,
          docType: doc.docType || 'INVOICE',
          method: 'api-intercept',
        };
      }
    }
  }

  if (apiHeaders) {
    const file = await fetchInvoiceFile(page, apiHeaders, invoiceId);
    await dismissInvoiceDownloadMenu(page);
    return { ...file, method: 'api-fetch' };
  }

  throw new Error(`Invoice download failed for ${invoiceId} — no popup option/link and no API fallback`);
}

function rowLocatorForText(page, rowText) {
  const invoiceId = invoiceIdFromRowText(rowText);
  return page.locator('[role="row"], .ag-row').filter({ hasText: invoiceId }).first();
}

async function hasNextInvoicePage(page) {
  const next = page.getByRole('button', { name: /next page/i }).last();
  if (!(await next.isVisible({ timeout: 1000 }).catch(() => false))) return false;
  return !(await next.isDisabled().catch(() => true));
}

async function goNextInvoicePage(page) {
  const next = page.getByRole('button', { name: /next page/i }).last();
  await next.scrollIntoViewIfNeeded();
  await next.click({ timeout: 8000 });
  await page.waitForTimeout(3000);
}

async function downloadOneInvoice({
  page, apiHeaders, row, opts, existingIndex, summary, emit,
}) {
  const invoiceId = invoiceIdFromRowText(row.text);
  if (!invoiceId) return { status: 'skipped', reason: 'no_invoice_id' };
  if (opts.invoiceIds?.length && !opts.invoiceIds.includes(invoiceId)) {
    return { status: 'skipped', reason: 'not_in_target_list' };
  }

  const issuedDate = parseDateFromRow(row.text);
  const year = issuedDate ? issuedDate.getUTCFullYear() : null;
  const inRange = yearInRange(issuedDate, opts.years);

  if (!inRange) {
    summary.skipped.push({
      reason: 'year_filter',
      invoiceId,
      year,
      rowText: row.text.slice(0, 200),
    });
    summary.totals.skipped_year += 1;
    return { status: 'skipped', reason: 'year_filter' };
  }

  const { code: countryCode, name: countryName } = countryFromRowText(row.text);
  const currency = currencyFromRowText(row.text);
  const existingPath = opts.skipExisting
    ? findExistingInvoicePath(existingIndex, year, countryCode, invoiceId, issuedDate, currency)
    : null;

  if (existingPath) {
    summary.skipped.push({ reason: 'already_exists', invoiceId, file: existingPath, country: countryCode });
    summary.totals.skipped_existing += 1;
    existingIndex.set(invoiceId, existingPath);
    return { status: 'skipped', reason: 'already_exists' };
  }

  const outPath = invoiceOutputPath(year, countryCode, invoiceId, issuedDate, currency);

  if (opts.dryRun) {
    summary.downloads.push({
      dryRun: true,
      invoiceId,
      year,
      country: countryCode,
      file: outPath,
      rowText: row.text.slice(0, 200),
    });
    summary.totals.dry_run += 1;
    emit(`[dry-run] ${invoiceId} → ${outPath}`);
    return { status: 'dry_run' };
  }

  let file;
  let finalPath = outPath;
  const rowLocator = rowLocatorForText(page, row.text);
  if (await rowLocator.count()) {
    file = await downloadInvoiceViaUi(page, rowLocator, invoiceId, apiHeaders, outPath);
    if (!file.savedViaUi) {
      saveVerifiedPdf(outPath, file.body);
    }
  } else {
    file = await fetchInvoiceFile(page, apiHeaders, invoiceId);
    saveVerifiedPdf(outPath, file.body);
  }
  existingIndex.set(invoiceId, finalPath);
  summary.downloads.push({
    invoiceId,
    year,
    country: countryCode,
    countryName,
    currency,
    file: finalPath,
    filename: path.basename(finalPath),
    size: file.body.length,
    contentType: file.contentType,
    docType: file.docType,
    method: file.method || 'unknown',
    issuedDate: issuedDate ? issuedDate.toISOString().slice(0, 10) : null,
  });
  summary.totals.downloaded += 1;
  emit(`Downloaded ${invoiceId} (${countryCode}/${year}) → ${finalPath} (${file.body.length} bytes)`);
  return { status: 'downloaded' };
}

async function paginateAndDownload({ page, apiHeaders, opts, existingIndex, summary, emit }) {
  let processed = 0;
  let pageNum = 1;
  const seen = new Set();

  while (true) {
    const rows = (await readInvoiceRows(page)).filter((row) => isInvoiceRow(row.text));
    const pageStats = { rows: rows.length, processed: 0, downloaded: 0, skipped_existing: 0, skipped_year: 0, failed: 0 };

    for (const row of rows) {
      const invoiceId = invoiceIdFromRowText(row.text);
      if (!invoiceId || seen.has(invoiceId)) continue;
      if (opts.invoiceIds && !opts.invoiceIds.includes(invoiceId)) continue;
      seen.add(invoiceId);
      pageStats.processed += 1;

      try {
        const before = { ...summary.totals };
        const result = await downloadOneInvoice({
          page, apiHeaders, row, opts, existingIndex, summary, emit,
        });
        if (result.status === 'downloaded') pageStats.downloaded += 1;
        else if (result.reason === 'already_exists') pageStats.skipped_existing += 1;
        else if (result.reason === 'year_filter') pageStats.skipped_year += 1;
        if (summary.totals.downloaded > before.downloaded
          || summary.totals.skipped_existing > before.skipped_existing
          || summary.totals.skipped_year > before.skipped_year
          || summary.totals.dry_run > before.dry_run) {
          processed += 1;
        }
      } catch (err) {
        const { code: countryCode } = countryFromRowText(row.text);
        const issuedDate = parseDateFromRow(row.text);
        const year = issuedDate ? issuedDate.getUTCFullYear() : null;
        summary.errors.push({ invoiceId, country: countryCode, year, error: err.message, rowText: row.text.slice(0, 200) });
        summary.totals.errors += 1;
        pageStats.failed += 1;
        processed += 1;
        emit(`Failed ${invoiceId}: ${err.message}`);
      }

      if (opts.limit > 0 && processed >= opts.limit) break;
    }

    emit(
      `Page ${pageNum}: rows=${pageStats.rows} processed=${pageStats.processed}`
      + ` downloaded=${pageStats.downloaded} skipped_existing=${pageStats.skipped_existing}`
      + ` skipped_year=${pageStats.skipped_year} failed=${pageStats.failed}`,
    );
    summary.pages_scanned = pageNum;
    checkpointAdsCatalog(seen, summary);

    if (opts.limit > 0 && processed >= opts.limit) break;
    if (!(await hasNextInvoicePage(page))) break;
    await goNextInvoicePage(page);
    pageNum += 1;
    if (pageNum > MAX_PAGE_COUNT) {
      emit(`Stopping pagination — reached page cap (${MAX_PAGE_COUNT})`);
      break;
    }
  }

  summary.invoices_seen = Array.from(seen).sort();
  checkpointAdsCatalog(seen, summary);
  return { processed, pages: pageNum };
}

async function retryFailedInvoices({ page, apiHeaders, opts, existingIndex, summary, emit }) {
  let attempt = 0;
  while (summary.errors.length > 0 && attempt < MAX_DOWNLOAD_RETRIES) {
    attempt += 1;
    const pending = [...summary.errors];
    summary.errors = [];
    emit(`Retry pass ${attempt}/${MAX_DOWNLOAD_RETRIES} — ${pending.length} failed invoice(s)`);

    for (const err of pending) {
      const invoiceId = err.invoiceId;
      if (!invoiceId) continue;
      if (opts.skipExisting && existingIndex.has(invoiceId)) {
        summary.totals.skipped_existing += 1;
        continue;
      }
      const row = { text: err.rowText || invoiceId };
      try {
        await downloadOneInvoice({
          page, apiHeaders, row, opts, existingIndex, summary, emit,
        });
      } catch (retryErr) {
        summary.errors.push({
          ...err,
          error: retryErr.message,
          retryAttempt: attempt,
        });
        summary.totals.errors += 1;
        emit(`Retry failed ${invoiceId}: ${retryErr.message}`);
      }
    }
  }
}

async function runInvoiceDownload({ page, opts, log }) {
  const emit = (msg) => {
    if (typeof log === 'function') {
      if (log.length >= 2) return log('info', msg);
      return log(msg);
    }
    console.log(msg);
    return null;
  };

  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    throw new Error('Missing scripts/amazon-storage-state.json — run node scripts/convert-amazon-cookies.js or amazon-save-cookies.js first');
  }

  const storage = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf8'));
  const cookieCount = (storage.cookies || []).length;
  const adsCookies = (storage.cookies || []).filter((c) => /advertising\.amazon\.com/.test(c.domain || ''));
  const authCookies = (storage.cookies || []).filter((c) =>
    ['at-main', 'sess-at-main', 'session-token', 'sso-state-main'].includes(c.name)
  );

  const existingIndex = buildExistingInvoiceIndex();
  const userDownloads = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads');
  const recoveredAnonymous = [
    ...recoverAnonymousDownloads(userDownloads),
    ...recoverAnonymousDownloads(DOWNLOADS_BASE),
  ];
  const pdfAudit = auditAdsDownloads();
  emit(`Existing invoice index: ${existingIndex.size} verified PDF(s) on disk`);
  if (recoveredAnonymous.length > 0) {
    emit(`Recovered ${recoveredAnonymous.length} anonymous browser download(s) as .pdf`);
  }
  if (pdfAudit.non_pdf_extension_count > 0 || pdfAudit.fake_pdf_count > 0) {
    emit(`PDF audit: removed ${pdfAudit.removed.filter((r) => r.removed).length} invalid file(s)`);
  }

  const summary = {
    task_type: 'amz-ads-invoice-download',
    startedAt: new Date().toISOString(),
    entityId: ENTITY_ID,
    billingUrl: BILLING_URL,
    years: opts.years,
    limit: opts.limit || null,
    downloads_base: DOWNLOADS_BASE,
    google_drive_folder_id: GOOGLE_DRIVE_FOLDER_ID,
    output_root: OUTPUT_ROOT,
    folder_structure: `${ADS_ROOT_NAME}/{YEAR}/{MARKET}/`,
    pdf_only: true,
    recovered_anonymous_downloads: recoveredAnonymous,
    pdf_audit: pdfAudit,
    existing_on_disk: existingIndex.size,
    cookieIntegration: {
      totalCookies: cookieCount,
      advertisingCookies: adsCookies.map((c) => c.name),
      authCookieNames: authCookies.map((c) => c.name),
      note: 'Seller Central amazon-storage-state.json works for advertising.amazon.com via shared Amazon SSO',
    },
    auth: null,
    downloads: [],
    skipped: [],
    errors: [],
    totals: { downloaded: 0, skipped_existing: 0, skipped_year: 0, dry_run: 0, errors: 0 },
  };

  summary.auth = await ensureAdsAuth(page);
  emit(`Auth OK — ${summary.auth.downloadButtons} download buttons visible`);

  const headerCapture = captureAdsApiHeaders(page);
  await page.getByRole('button', { name: /^download$/i }).nth(1).click({ timeout: 10000 }).catch(async () => {
    await page.getByRole('button', { name: /^download$/i }).first().click({ timeout: 10000 });
  });
  const apiHeaders = await headerCapture;
  emit('Captured Amazon Ads API headers from billing documents request');

  await dismissInvoiceDownloadMenu(page);

  try {
    const rpp = await setResultsPerPage(page, 200);
    emit(`Results per page: ${rpp}`);
  } catch (err) {
    emit(`Warning: could not set results per page to 200 (${err.message}) — continuing`);
  }

  const { pages } = await paginateAndDownload({
    page, apiHeaders, opts, existingIndex, summary, emit,
  });
  summary.pages_scanned = pages;

  if (!opts.dryRun && summary.errors.length > 0) {
    await retryFailedInvoices({ page, apiHeaders, opts, existingIndex, summary, emit });
  }

  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  emit(
    `Done — downloaded ${summary.totals.downloaded},`
    + ` skipped_existing ${summary.totals.skipped_existing},`
    + ` skipped_year ${summary.totals.skipped_year},`
    + ` errors ${summary.totals.errors}`,
  );
  return summary;
}

async function runFlow({ page, task, log }) {
  const opts = parseTaskInput(task);
  return runInvoiceDownload({ page, opts, log });
}

async function main() {
  let opts = parseArgs(process.argv);
  if (process.env.TASK_PARAMS || process.env.REPORT_TASK_PARAMS) {
    try {
      const envObj = JSON.parse(process.env.TASK_PARAMS || process.env.REPORT_TASK_PARAMS || '{}');
      opts = { ...opts, ...parseTaskInput({ actions: [envObj] }) };
    } catch {
      /* keep CLI opts */
    }
  }

  const browser = await chromium.launch({ headless: opts.headless, channel: 'chrome' })
    .catch(() => chromium.launch({ headless: opts.headless }));
  const context = await browser.newContext({
    storageState: STORAGE_STATE_PATH,
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  try {
    const summary = await runInvoiceDownload({ page, opts, log: (msg) => console.log(msg) });
    console.log(JSON.stringify({
      ok: summary.totals.errors === 0,
      auth: summary.auth,
      totals: summary.totals,
      summary_path: SUMMARY_PATH,
      output_root: OUTPUT_ROOT,
      verify: require('./amz-downloads-post-verify').maybeRunPostVerify('ads'),
    }, null, 2));
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = async function runAmazonAdsInvoiceDownload({ page, task, log }) {
  return runFlow({ page, task, log });
};

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message, summary_path: SUMMARY_PATH }));
    process.exit(1);
  });
}
