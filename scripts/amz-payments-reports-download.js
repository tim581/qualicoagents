'use strict';

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
  PAYMENTS_ROOT_NAME,
  paymentsFlatPath,
  DRIVE_FOLDER_ID,
  LOCAL_FALLBACK,
} = require('./amz-accountant-paths');
const {
  isPdfFile,
  savePlaywrightDownload,
  scanForNonPdfFiles,
  formatScanReport,
  removeInvalidFile,
  recoverAnonymousDownloads,
} = require('./amz-pdf-utils');

const STORAGE_STATE_PATH = path.join(__dirname, 'amazon-storage-state.json');
const DOWNLOADS_BASE = resolveDownloadsBase();
const { paymentsRoot: OUTPUT_ROOT } = ensureAccountantFolders(DOWNLOADS_BASE);
const SUMMARY_PATH = path.join(__dirname, 'amz-payments-reports-download-summary.json');

const MARKET_CONFIG = {
  US: { label: 'Amazon.com (US)', accountName: 'United States', portalBase: 'https://sellercentral.amazon.com', marketplaceId: 'ATVPDKIKX0DER' },
  CA: { label: 'Amazon.ca (CA)', accountName: 'Canada', portalBase: 'https://sellercentral.amazon.ca', marketplaceId: 'A2EUQ1WTGCTBG2' },
  UK: { label: 'Amazon.co.uk (UK)', accountName: 'United Kingdom', portalBase: 'https://sellercentral.amazon.co.uk', marketplaceId: 'A1F83G8C2ARO7P' },
  DE: { label: 'Amazon.de (DE)', accountName: 'Germany', portalBase: 'https://sellercentral.amazon.co.uk', marketplaceId: 'A1PA6795UKMFR9' },
  FR: { label: 'Amazon.fr (FR)', accountName: 'France', portalBase: 'https://sellercentral.amazon.co.uk', marketplaceId: 'A13V1IB3VIYZZH' },
  IT: { label: 'Amazon.it (IT)', accountName: 'Italy', portalBase: 'https://sellercentral.amazon.co.uk', marketplaceId: 'APJ6JRA9NG5V4' },
  ES: { label: 'Amazon.es (ES)', accountName: 'Spain', portalBase: 'https://sellercentral.amazon.co.uk', marketplaceId: 'A1RKKUPIHCS9HS' },
  NL: { label: 'Amazon.nl (NL)', accountName: 'Netherlands', portalBase: 'https://sellercentral.amazon.co.uk', marketplaceId: 'A1805IZSGTT6HS' },
  BE: { label: 'Amazon.com.be (BE)', accountName: 'Belgium', portalBase: 'https://sellercentral.amazon.co.uk', marketplaceId: 'AMEN7PMS3EDWL' },
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DEFAULT_MARKETS = Object.keys(MARKET_CONFIG);
const DEFAULT_REPORT_TYPES = ['summary'];
const MAX_RETRIES = 2;
const DEFAULT_POLL_SECONDS = 600;
const DEFAULT_POLL_INTERVAL_MS = 5000;

function monthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    year,
    month,
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
    start: iso(start),
    end: iso(end),
    monthName: MONTH_NAMES[month - 1],
    startMatch: iso(start).replace(/(\d{4})-(\d{2})-(\d{2})/, (_, y, m, d) => {
      const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      return `${Number(d)} ${names[Number(m) - 1]} ${y}`;
    }),
    endMatch: iso(end).replace(/(\d{4})-(\d{2})-(\d{2})/, (_, y, m, d) => {
      const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      return `${Number(d)} ${names[Number(m) - 1]} ${y}`;
    }),
  };
}

function buildMonthIterations(years, months, monthFrom, monthTo) {
  const items = [];
  const from = monthFrom ? monthRange(monthFrom.year, monthFrom.month) : null;
  const to = monthTo ? monthRange(monthTo.year, monthTo.month) : null;

  for (const year of years) {
    for (const month of months) {
      const range = monthRange(year, month);
      if (from && range.monthKey < from.monthKey) continue;
      if (to && range.monthKey > to.monthKey) continue;
      items.push(range);
    }
  }
  return items.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

function parseTaskInput(task = {}) {
  const first = Array.isArray(task.actions) && task.actions.length > 0 ? task.actions[0] : {};
  const input = (first && typeof first === 'object') ? first : {};

  const markets = Array.isArray(input.marketplaces) && input.marketplaces.length
    ? input.marketplaces.map((m) => String(m).toUpperCase())
    : (Array.isArray(input.markets) && input.markets.length
      ? input.markets.map((m) => String(m).toUpperCase())
      : DEFAULT_MARKETS);

  const years = Array.isArray(input.years) && input.years.length
    ? input.years.map((y) => Number(y)).filter((y) => Number.isInteger(y) && y >= 2000 && y <= 2100)
    : [2025, 2026];

  const reportTypes = Array.isArray(input.report_types) && input.report_types.length
    ? input.report_types.map((r) => String(r).toLowerCase())
    : DEFAULT_REPORT_TYPES;

  const months = Array.isArray(input.months) && input.months.length
    ? input.months.map((m) => Number(m)).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  const monthFrom = input.month_from || input.monthFrom || null;
  const monthTo = input.month_to || input.monthTo || null;

  return {
    markets,
    years,
    reportTypes,
    months,
    monthFrom: monthFrom && typeof monthFrom === 'object'
      ? { year: Number(monthFrom.year), month: Number(monthFrom.month) }
      : null,
    monthTo: monthTo && typeof monthTo === 'object'
      ? { year: Number(monthTo.year), month: Number(monthTo.month) }
      : null,
    dryRun: input.dry_run === true || input.dryRun === true,
    skipExisting: input.skip_existing !== false,
    pollSeconds: Number.isInteger(input.poll_seconds) ? input.poll_seconds : DEFAULT_POLL_SECONDS,
    useHamburgerNav: input.use_hamburger_nav !== false,
  };
}

async function withRetry(label, fn, retries = MAX_RETRIES, logger = console.log) {
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      logger(`  ⚠️ ${label} failed (attempt ${attempt}/${retries + 1}): ${error.message}`);
      if (attempt <= retries) await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  throw lastError;
}

function isSigninUrl(url) {
  return /\/ap\/signin|\/signin|\/auth\//i.test(url || '');
}

function isReportsRepositoryUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.includes('reports-repository') && !isSigninUrl(url);
  } catch {
    return false;
  }
}

async function warmupPaymentsSession(page, market, portalBase, logger) {
  const paymentsUrl = `${portalBase}/payments/dashboard/index.html?mons_sel_mkid=${encodeURIComponent(market.marketplaceId)}`;
  await page.goto(paymentsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  await dismissJoyride(page);
  if (isSigninUrl(page.url())) {
    throw new Error(`Payments dashboard sign-in required for ${market.label}`);
  }
  logger(`  💳 Payments dashboard ready`);
}

async function ensureLoggedIn(page, market) {
  const candidates = Array.from(
    new Set([market.portalBase, 'https://sellercentral.amazon.com', 'https://sellercentral.amazon.co.uk'])
  );
  for (const base of candidates) {
    await page.goto(`${base}/home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    const url = page.url();
    if (!isSigninUrl(url)) {
      return base;
    }
  }
  throw new Error(`Amazon session expired for ${market.label}; refresh amazon-storage-state.json`);
}

async function switchMarketplace(page, market, activePortalBase) {
  const base = activePortalBase || market.portalBase;
  const switcherUrl = `${base}/account-switcher/default/merchantMarketplace`;
  await page.goto(switcherUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1600);

  const target = page.getByRole('button', { name: new RegExp(market.accountName, 'i') }).first();
  const visible = await target.isVisible({ timeout: 8000 }).catch(() => false);
  if (!visible) throw new Error(`Account switcher entry not found: ${market.accountName}`);

  await target.click({ timeout: 10000 });
  await page.waitForTimeout(500);
  const selectAccount = page.getByRole('button', { name: /^Select account$/i }).first();
  if (await selectAccount.isVisible({ timeout: 4000 }).catch(() => false)) {
    await selectAccount.click({ timeout: 10000 });
    await page.waitForTimeout(1800);
  }
}

async function dismissJoyride(page) {
  await page.locator('.ProductTourCarousel kat-button[label="Cancel"]').first().click({ timeout: 2000 }).catch(() => {});
  await page.getByRole('button', { name: /skip/i }).first().click({ timeout: 2000 }).catch(() => {});
  await page.getByRole('button', { name: /close|not now|dismiss/i }).first().click({ timeout: 1000 }).catch(() => {});
  await page.locator('#vibes-modal-container button, #vibes-modal-container [aria-label*="close" i]').first()
    .click({ timeout: 1500 }).catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll(
      '.react-joyride__overlay, #react-joyride-portal, #vibes-modal-container, casino-tour-popover, .ProductTourCarousel',
    ).forEach((el) => el.remove());
  }).catch(() => {});
}

async function openHamburgerMenu(page) {
  await dismissJoyride(page);
  const codegenBtn = page.locator('navigation-hamburger-menu').getByRole('button').filter({ hasText: /^$/ }).first();
  if (await codegenBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await codegenBtn.click({ timeout: 8000 });
    return true;
  }
  return page.evaluate(() => {
    const ham = document.querySelector('navigation-hamburger-menu, [data-test-tag="hamburger-menu"]');
    const btn = ham?.shadowRoot?.querySelector('button') || ham?.querySelector('button');
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => false);
}

async function clickNavigationMenuLink(page, ariaLabelPattern) {
  return page.evaluate((pattern) => {
    const re = new RegExp(pattern, 'i');
    const walk = (root) => {
      for (const a of root.querySelectorAll?.('a[aria-label], a, button') || []) {
        const label = a.getAttribute('aria-label') || a.textContent?.trim() || '';
        if (re.test(label)) { a.click(); return label; }
      }
      for (const el of root.querySelectorAll?.('*') || []) {
        if (el.shadowRoot) {
          const hit = walk(el.shadowRoot);
          if (hit) return hit;
        }
      }
      return null;
    };
    const ham = document.querySelector('[data-test-tag="hamburger-menu"], navigation-hamburger-menu');
    if (ham) {
      const hit = walk(ham.shadowRoot || ham);
      if (hit) return hit;
    }
    return walk(document);
  }, ariaLabelPattern).catch(() => null);
}

async function navigateViaHamburgerToReportsRepository(page, market, logger) {
  await page.goto(`${market.portalBase}/home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await dismissJoyride(page);

  const opened = await openHamburgerMenu(page);
  if (!opened) throw new Error('Hamburger menu could not be opened');

  await page.waitForTimeout(1200);
  const paymentsHit = await clickNavigationMenuLink(page, '^Payments$');
  if (!paymentsHit) throw new Error('Payments menu item not found in hamburger navigation');
  logger(`  🍔 Hamburger → Payments (${paymentsHit})`);
  await page.waitForTimeout(2200);

  const repoCandidates = [
    page.getByRole('tab', { name: /reports repository/i }),
    page.getByRole('link', { name: /reports repository/i }),
    page.getByText(/^Reports Repository/i),
  ];
  for (const loc of repoCandidates) {
    if (await loc.first().isVisible({ timeout: 2500 }).catch(() => false)) {
      await loc.first().click({ timeout: 10000 });
      await page.waitForTimeout(2200);
      if (isReportsRepositoryUrl(page.url())) {
        logger(`  📂 Payments → Reports Repository tab`);
        return page.url();
      }
    }
  }

  throw new Error('Reports Repository tab not found after Payments navigation');
}

async function navigateFromPaymentsDashboard(page, market, logger) {
  const repoCandidates = [
    page.getByRole('tab', { name: /reports repository/i }),
    page.getByRole('link', { name: /reports repository/i }),
    page.getByText(/^Reports Repository/i),
    page.locator('a[href*="reports-repository"]'),
  ];
  for (const loc of repoCandidates) {
    if (await loc.first().isVisible({ timeout: 2500 }).catch(() => false)) {
      await loc.first().click({ timeout: 10000 });
      await page.waitForTimeout(2500);
      if (isReportsRepositoryUrl(page.url())) {
        logger(`  📂 Payments dashboard → Reports Repository`);
        return page.url();
      }
    }
  }
  return null;
}

async function navigateToReportsRepository(page, market, useHamburgerNav, logger) {
  const fromDashboard = await navigateFromPaymentsDashboard(page, market, logger);
  if (fromDashboard) return fromDashboard;

  if (useHamburgerNav) {
    try {
      return await navigateViaHamburgerToReportsRepository(page, market, logger);
    } catch (error) {
      logger(`  ⚠️ Hamburger navigation failed (${error.message}); using direct URL fallback`);
    }
  }

  const url = `${market.portalBase}/payments/reports-repository?mons_sel_mkid=${encodeURIComponent(market.marketplaceId)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2200);
  if (!isReportsRepositoryUrl(page.url())) {
    if (isSigninUrl(page.url())) {
      throw new Error(`Sign-in required to open Reports Repository for ${market.label}`);
    }
    throw new Error(`Could not open Reports Repository for ${market.label} (url=${page.url()})`);
  }
  logger(`  📂 Opened Reports Repository: ${page.url()}`);
  return page.url();
}

async function clickKatDropdownOption(page, dropdownIndex, optionPattern) {
  const dds = page.locator('kat-dropdown');
  const count = await dds.count();
  if (dropdownIndex >= count) {
    return { ok: false, reason: `dropdown_index_${dropdownIndex}_of_${count}` };
  }

  await dds.nth(dropdownIndex).click({ timeout: 8000 });
  await page.waitForTimeout(700);

  const option = page.locator('kat-option').filter({ hasText: optionPattern }).first();
  if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
    await option.click({ timeout: 8000 });
    await page.waitForTimeout(500);
    return { ok: true };
  }

  const picked = await page.evaluate((pattern) => {
    const re = new RegExp(pattern, 'i');
    const opts = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll?.('kat-option') || []) opts.push(el);
      for (const el of root.querySelectorAll?.('*') || []) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    const hit = opts.find((o) => re.test((o.textContent || '').trim()) || re.test(o.getAttribute('label') || ''));
    if (!hit) return { ok: false, reason: 'option_not_found' };
    hit.click();
    return { ok: true, picked: (hit.textContent || '').trim() };
  }, optionPattern.source || String(optionPattern));

  await page.waitForTimeout(500);
  return picked;
}

async function configureMonthlySummaryReport(page, range, logger) {
  await dismissJoyride(page);

  const summary = await clickKatDropdownOption(page, 1, /^Summary$/);
  if (!summary.ok) throw new Error(`Could not select Summary report type: ${summary.reason || 'unknown'}`);
  logger(`  📋 Report type: Summary`);

  const monthRadio = page.locator('input[name="dateRangeType"][aria-label="Month"]').first();
  if (await monthRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
    await monthRadio.check({ force: true });
  } else {
    await page.locator('label').filter({ hasText: /^Month$/ }).first().click({ force: true });
  }
  await page.waitForTimeout(800);
  logger(`  🗓️ Date range: Month`);

  const monthPick = await clickKatDropdownOption(page, 2, new RegExp(`^${range.monthName}$`, 'i'));
  if (!monthPick.ok) throw new Error(`Could not select month ${range.monthName}: ${monthPick.reason || 'unknown'}`);

  const yearPick = await clickKatDropdownOption(page, 3, new RegExp(`^${range.year}$`));
  if (!yearPick.ok) throw new Error(`Could not select year ${range.year}: ${yearPick.reason || 'unknown'}`);

  logger(`  🗓️ Selected ${range.monthName} ${range.year}`);
}

async function requestSummaryReport(page, logger) {
  const reqBtn = page.locator('kat-button[label="Request Report"], button:has-text("Request Report")').first();
  if (!(await reqBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error('Request Report button not visible');
  }
  await reqBtn.click({ timeout: 10000 });
  await page.waitForTimeout(2500);
  logger(`  📨 Requested Summary report`);
}

const PDF_DOWNLOAD_ACTION = 'download\\s+pdf';
const CSV_ONLY_ACTION = 'download\\s+csv';

function paymentsSummaryFilename(marketCode, range) {
  return `${marketCode}_Payments_Summary_${range.monthKey}.pdf`;
}

function existingSummaryPath(marketCode, range) {
  const candidates = [
    paymentsFlatPath(OUTPUT_ROOT, marketCode, range.monthKey),
    path.join(OUTPUT_ROOT, String(range.year), marketCode, paymentsSummaryFilename(marketCode, range)),
    path.join(OUTPUT_ROOT, String(range.year), marketCode, 'summary', `${marketCode}_summary_${range.monthKey}.pdf`),
  ];
  for (const candidate of candidates) {
    if (isPdfFile(candidate)) return candidate;
    if (fs.existsSync(candidate)) removeInvalidFile(candidate, 'invalid_pdf_header');
  }
  return null;
}

function deterministicTargetPath(marketCode, range) {
  return paymentsFlatPath(OUTPUT_ROOT, marketCode, range.monthKey);
}

function auditPaymentsDownloads() {
  const roots = [
    OUTPUT_ROOT,
    path.join(LOCAL_FALLBACK, 'amazon-reports'),
    path.join(LOCAL_FALLBACK, PAYMENTS_ROOT_NAME),
  ];
  const scan = scanForNonPdfFiles(roots);
  const removed = [];
  for (const file of [...scan.non_pdf_extension, ...scan.fake_pdfs, ...scan.empty_files]) {
    removed.push(removeInvalidFile(file, 'accountant_pdf_only'));
  }
  return { ...formatScanReport(scan), removed };
}

function rowMatcherPayload(range) {
  return {
    startMatch: range.startMatch,
    endMatch: range.endMatch,
    monthKey: range.monthKey,
    monthName: range.monthName,
    year: String(range.year),
    month: String(range.month),
  };
}

async function findMatchingRowAction(page, range, actionPattern) {
  return page.evaluate(({ payload, actionPattern }) => {
    const startRe = new RegExp(payload.startMatch, 'i');
    const endRe = new RegExp(payload.endMatch, 'i');
    const actionRe = new RegExp(actionPattern, 'i');
    const monthRe = new RegExp(payload.monthName, 'i');
    const isoMonth = `${payload.year}-${payload.month.padStart(2, '0')}`;
    const rows = [];
    const walk = (root) => {
      for (const row of root.querySelectorAll?.('kat-table-row') || []) rows.push(row);
      for (const el of root.querySelectorAll?.('*') || []) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);

    const rowMatches = (text) => {
      if (!/summary/i.test(text)) return false;
      if (startRe.test(text) && endRe.test(text)) return true;
      if (text.includes(isoMonth)) return true;
      return monthRe.test(text) && text.includes(payload.year);
    };

    for (const row of rows) {
      const text = (row.textContent || '').replace(/\s+/g, ' ');
      if (!rowMatches(text)) continue;
      for (const btn of row.querySelectorAll('kat-button, button')) {
        const label = btn.getAttribute('label') || btn.textContent?.trim() || '';
        if (actionRe.test(label)) {
          const status = /ready/i.test(text) ? 'ready' : (/progress|generating/i.test(text) ? 'in_progress' : 'unknown');
          return { found: true, label, status, text: text.slice(0, 240) };
        }
      }
      return { found: false, reason: 'row_without_matching_action', text: text.slice(0, 240) };
    }
    return { found: false, reason: 'row_not_found' };
  }, { payload: rowMatcherPayload(range), actionPattern });
}

async function clickMatchingRowAction(page, range, actionPattern) {
  return page.evaluate(({ payload, actionPattern }) => {
    const startRe = new RegExp(payload.startMatch, 'i');
    const endRe = new RegExp(payload.endMatch, 'i');
    const actionRe = new RegExp(actionPattern, 'i');
    const monthRe = new RegExp(payload.monthName, 'i');
    const isoMonth = `${payload.year}-${payload.month.padStart(2, '0')}`;
    const rows = [];
    const walk = (root) => {
      for (const row of root.querySelectorAll?.('kat-table-row') || []) rows.push(row);
      for (const el of root.querySelectorAll?.('*') || []) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);

    const rowMatches = (text) => {
      if (!/summary/i.test(text)) return false;
      if (startRe.test(text) && endRe.test(text)) return true;
      if (text.includes(isoMonth)) return true;
      return monthRe.test(text) && text.includes(payload.year);
    };

    const activate = (btn) => {
      const target = btn.shadowRoot?.querySelector('button') || btn;
      target.click();
    };

    for (const row of rows) {
      const text = (row.textContent || '').replace(/\s+/g, ' ');
      if (!rowMatches(text)) continue;
      for (const btn of row.querySelectorAll('kat-button, button')) {
        const label = btn.getAttribute('label') || btn.textContent?.trim() || '';
        if (actionRe.test(label)) {
          activate(btn);
          return { clicked: true, label, text: text.slice(0, 240) };
        }
      }
    }
    return { clicked: false };
  }, { payload: rowMatcherPayload(range), actionPattern });
}

async function waitAndDownloadSummaryReport({
  page,
  market,
  marketCode,
  range,
  pollSeconds,
  pollIntervalMs,
  skipExisting,
  logger,
}) {
  const repoUrl = `${market.portalBase}/payments/reports-repository?mons_sel_mkid=${encodeURIComponent(market.marketplaceId)}`;
  const attempts = [];
  const deadline = Date.now() + pollSeconds * 1000;

  while (Date.now() < deadline) {
    await page.goto(repoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1800);
    await dismissJoyride(page);

    const pdfReady = await findMatchingRowAction(page, range, PDF_DOWNLOAD_ACTION);
    if (pdfReady.found) {
      const target = deterministicTargetPath(marketCode, range);
      if (skipExisting && isPdfFile(target)) {
        logger(`  ✅ Already downloaded (verified PDF): ${target}`);
        return {
          status: 'downloaded',
          path: target,
          reason: 'already_exists',
          buttonLabel: pdfReady.label,
        };
      }

      const downloadPromise = page.waitForEvent('download', { timeout: 45000 });
      const click = await clickMatchingRowAction(page, range, PDF_DOWNLOAD_ACTION);
      if (!click.clicked) {
        attempts.push({ status: 'error', reason: 'pdf_download_click_failed' });
        await page.waitForTimeout(pollIntervalMs);
        continue;
      }

      const download = await downloadPromise.catch(() => null);
      if (!download) {
        attempts.push({ status: 'error', reason: 'download_event_timeout', buttonLabel: click.label });
        await page.waitForTimeout(pollIntervalMs);
        continue;
      }

      try {
        await savePlaywrightDownload(download, target, `${marketCode} ${range.monthKey} payments summary`);
      } catch (error) {
        if (fs.existsSync(target)) removeInvalidFile(target, 'invalid_pdf_header');
        attempts.push({ status: 'error', reason: 'not_pdf', error: error.message, buttonLabel: click.label });
        await page.waitForTimeout(pollIntervalMs);
        continue;
      }

      logger(`  ⬇️ Downloaded verified PDF → ${target} via "${click.label}"`);
      return {
        status: 'downloaded',
        path: target,
        reason: 'ok',
        buttonLabel: click.label,
        suggestedFilename: download.suggestedFilename(),
      };
    }

    const csvOnly = await findMatchingRowAction(page, range, CSV_ONLY_ACTION);
    if (csvOnly.found) {
      const msg = `ACCOUNTANT PDF REQUIRED: ${marketCode} ${range.monthKey} has Download CSV only — Summary must be PDF for accountant`;
      logger(`  ❌ ${msg}`);
      return {
        status: 'error',
        reason: 'csv_only_no_pdf',
        error: msg,
        buttonLabel: csvOnly.label,
        attempts,
      };
    }

    const refreshReady = await findMatchingRowAction(page, range, '^refresh$');
    if (refreshReady.found) {
      logger(`  ⏳ Report generating for ${range.monthKey} — refreshing status`);
      await clickMatchingRowAction(page, range, '^refresh$');
      attempts.push({ status: 'waiting', reason: 'refresh_clicked' });
      await page.waitForTimeout(pollIntervalMs);
      continue;
    }

    const existing = await findMatchingRowAction(page, range, 'request again');
    if (existing.found) {
      logger(`  🔁 Existing report row found for ${range.monthKey} — requesting again`);
      await clickMatchingRowAction(page, range, 'request again');
      attempts.push({ status: 'waiting', reason: 'request_again_clicked' });
      await page.waitForTimeout(pollIntervalMs);
      continue;
    }

    const rowPeek = await findMatchingRowAction(page, range, 'download|refresh|request');
    const waitReason = rowPeek.reason || (rowPeek.found ? `row_status_${rowPeek.status || 'unknown'}` : 'not_ready');
    if (attempts.length === 0 || attempts.length % 6 === 0) {
      logger(`  ⏳ Waiting for Ready status on ${range.monthKey} (${waitReason})`);
    }
    attempts.push({ status: 'waiting', reason: waitReason });
    await page.waitForTimeout(pollIntervalMs);
  }

  logger(`  ⏱️ Poll timeout for ${range.monthKey} after ${pollSeconds}s — PDF not ready to download`);
  return {
    status: 'timeout',
    reason: 'report_not_ready_before_poll_timeout',
    attempts,
  };
}

async function downloadSummaryForMonth({
  page,
  market,
  marketCode,
  range,
  dryRun,
  pollSeconds,
  pollIntervalMs,
  skipExisting,
  useHamburgerNav,
  activePortalBase,
  logger,
}) {
  if (dryRun) {
    return {
      market: market.label,
      marketCode,
      reportType: 'summary',
      month: range.month,
      year: range.year,
      monthKey: range.monthKey,
      status: 'dry_run',
      downloaded: [],
      attempts: [{ status: 'dry_run', reason: 'dry_run_enabled' }],
    };
  }

  if (skipExisting) {
    const existing = existingSummaryPath(marketCode, range);
    if (existing) {
      logger(`  ✅ Already downloaded: ${existing}`);
      return {
        market: market.label,
        marketCode,
        reportType: 'summary',
        month: range.month,
        year: range.year,
        monthKey: range.monthKey,
        status: 'downloaded',
        reason: 'already_exists',
        path: existing,
        downloaded: [existing],
        attempts: [{ status: 'skipped', reason: 'already_exists' }],
      };
    }
  }

  await warmupPaymentsSession(page, market, activePortalBase || market.portalBase, logger);
  await navigateToReportsRepository(page, market, useHamburgerNav, logger);
  await configureMonthlySummaryReport(page, range, logger);
  await requestSummaryReport(page, logger);

  const downloadResult = await waitAndDownloadSummaryReport({
    page,
    market,
    marketCode,
    range,
    pollSeconds,
    pollIntervalMs,
    skipExisting,
    logger,
  });

  if (downloadResult.status === 'timeout') {
    logger(`  ⚠️ ${marketCode} ${range.monthKey}: timed out waiting for Download PDF`);
  } else if (downloadResult.status === 'error') {
    logger(`  ❌ ${marketCode} ${range.monthKey}: ${downloadResult.error || downloadResult.reason}`);
  }

  return {
    market: market.label,
    marketCode,
    reportType: 'summary',
    month: range.month,
    year: range.year,
    monthKey: range.monthKey,
    range: { start: range.start, end: range.end },
    status: downloadResult.status,
    reason: downloadResult.reason,
    path: downloadResult.path || null,
    buttonLabel: downloadResult.buttonLabel || null,
    downloaded: downloadResult.path ? [downloadResult.path] : [],
    attempts: downloadResult.attempts || [{ status: downloadResult.status, reason: downloadResult.reason }],
  };
}

async function runFlow({ page, task, log }) {
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    throw new Error('Missing scripts/amazon-storage-state.json. Run amazon-save-cookies.js or convert-amazon-cookies.js first.');
  }

  const input = parseTaskInput(task);
  const emit = (message) => {
    if (typeof log === 'function') return log('info', message);
    console.log(message);
    return null;
  };

  const monthIterations = buildMonthIterations(input.years, input.months, input.monthFrom, input.monthTo);
  const userDownloads = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads');
  const recoveredAnonymous = [
    ...recoverAnonymousDownloads(userDownloads),
    ...recoverAnonymousDownloads(DOWNLOADS_BASE),
  ];
  const pdfAudit = auditPaymentsDownloads();
  if (recoveredAnonymous.length > 0) {
    emit(`📋 Recovered ${recoveredAnonymous.length} anonymous browser download(s) as .pdf`);
  }
  if (pdfAudit.non_pdf_extension_count > 0 || pdfAudit.fake_pdf_count > 0) {
    emit(`📋 PDF audit: removed ${pdfAudit.removed.filter((r) => r.removed).length} invalid file(s); verified ${pdfAudit.verified_pdf_count} PDF(s)`);
  }
  const summary = {
    task_type: 'amz-payments-reports-download',
    started_at: new Date().toISOString(),
    input,
    month_iterations: monthIterations.map((m) => m.monthKey),
    downloads_base: DOWNLOADS_BASE,
    google_drive_folder_id: DRIVE_FOLDER_ID,
    root_output_dir: OUTPUT_ROOT,
    folder_structure: `${PAYMENTS_ROOT_NAME}/{YEAR}/{MARKET}/`,
    pdf_only: true,
    recovered_anonymous_downloads: recoveredAnonymous,
    pdf_audit: pdfAudit,
    results: [],
    blockers: [],
    totals: { downloaded: 0, dry_run: 0, skipped: 0, errors: 0, timeouts: 0, csv_only: 0 },
  };

  for (const marketCode of input.markets) {
    const market = MARKET_CONFIG[marketCode];
    if (!market) {
      summary.blockers.push({ marketCode, reason: `unsupported_market_${marketCode}` });
      summary.totals.errors += 1;
      continue;
    }

    let activePortalBase = '';
    try {
      await emit(`🌍 ${market.label}`);
      activePortalBase = await withRetry('ensureLoggedIn', () => ensureLoggedIn(page, market), MAX_RETRIES, emit);
      await withRetry('switchMarketplace', () => switchMarketplace(page, market, activePortalBase), MAX_RETRIES, emit);
    } catch (error) {
      summary.blockers.push({
        marketCode,
        reason: error.message,
        fallback: 'Refresh scripts/amazon-storage-state.json and re-run.',
      });
      summary.totals.errors += 1;
      continue;
    }

    for (const range of monthIterations) {
      for (const reportType of input.reportTypes) {
        if (reportType !== 'summary') {
          summary.results.push({
            marketCode,
            reportType,
            month: range.month,
            year: range.year,
            status: 'error',
            reason: `unsupported_report_type_${reportType}`,
          });
          summary.totals.errors += 1;
          continue;
        }

        try {
          await emit(`📅 ${marketCode} summary ${range.monthKey}`);
          const result = await withRetry(
            `summary:${marketCode}:${range.monthKey}`,
            () => downloadSummaryForMonth({
              page,
              market,
              marketCode,
              range,
              dryRun: input.dryRun,
              pollSeconds: input.pollSeconds,
              pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
              skipExisting: input.skipExisting,
              useHamburgerNav: input.useHamburgerNav,
              activePortalBase,
              logger: emit,
            }),
            1,
            emit
          );

          summary.results.push(result);
          if (result.downloaded.length > 0) summary.totals.downloaded += result.downloaded.length;
          else if (result.status === 'dry_run') summary.totals.dry_run += 1;
          else if (result.status === 'timeout') summary.totals.timeouts += 1;
          else if (result.reason === 'csv_only_no_pdf') {
            summary.totals.csv_only += 1;
            summary.totals.errors += 1;
            summary.blockers.push({
              marketCode,
              month: range.month,
              year: range.year,
              reason: result.error || result.reason,
            });
          } else summary.totals.skipped += 1;
        } catch (error) {
          summary.blockers.push({
            marketCode,
            reportType,
            month: range.month,
            year: range.year,
            reason: error.message,
          });
          summary.results.push({
            marketCode,
            reportType,
            month: range.month,
            year: range.year,
            status: 'error',
            reason: error.message,
          });
          summary.totals.errors += 1;
        }
      }
    }
  }

  summary.finished_at = new Date().toISOString();
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  return summary;
}

module.exports = async function runAmazonReportsDownload({ page, task, log }) {
  return await runFlow({ page, task, log });
};

async function runStandalone() {
  const headless = process.env.PLAYWRIGHT_HEADLESS === '1' || process.env.HEADLESS === '1';
  const browser = await chromium.launch({ headless, channel: 'chrome' }).catch(() => chromium.launch({ headless }));
  const context = await browser.newContext({
    storageState: STORAGE_STATE_PATH,
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  try {
    const actionRaw = process.env.TASK_PARAMS || process.env.REPORT_TASK_PARAMS || '{}';
    let actionObj = {};
    try { actionObj = JSON.parse(actionRaw); } catch { actionObj = {}; }
    const summary = await runFlow({
      page,
      task: { actions: [actionObj] },
      log: async (_step, message) => console.log(message),
    });
    console.log(JSON.stringify({
      ok: summary.totals.errors === 0,
      totals: summary.totals,
      summary_path: SUMMARY_PATH,
      output_root: OUTPUT_ROOT,
      verify: require('./amz-downloads-post-verify').maybeRunPostVerify('payments'),
    }));
  } finally {
    await context.close();
    await browser.close();
  }
}

if (require.main === module) {
  runStandalone().catch((error) => {
    const payload = {
      ok: false,
      error: error.message,
      summary_path: SUMMARY_PATH,
    };
    console.error(JSON.stringify(payload));
    process.exit(1);
  });
}
