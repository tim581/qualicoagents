'use strict';

/**
 * amz-request-payments.js
 * Queueable Amazon Seller Central disbursement requester.
 *
 * Expected task.actions examples:
 *   ["US"]
 *   [{ "market": "DE" }]
 *
 * Defaults to US when no action is provided.
 */

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

function parseMarket(task) {
  const actions = Array.isArray(task?.actions) ? task.actions : [];
  if (!actions.length) return 'US';

  const first = actions[0];
  if (typeof first === 'string' && first.trim()) return first.trim().toUpperCase();
  if (first && typeof first === 'object') {
    const candidate = String(first.market || first.marketplace || first.country || '').trim().toUpperCase();
    if (candidate) return candidate;
  }
  return 'US';
}

function parseOptions(task) {
  const actions = Array.isArray(task?.actions) ? task.actions : [];
  const first = actions[0];
  if (first && typeof first === 'object') {
    return {
      dryRun: first.dryRun === true || first.dry_run === true,
    };
  }
  return { dryRun: false };
}

async function waitAndClickFirst(page, selectors, timeout = 10000) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    const visible = await loc.isVisible({ timeout: 1500 }).catch(() => false);
    if (!visible) continue;
    await loc.click({ timeout });
    return selector;
  }
  return null;
}

async function isAnyVisible(page, selectors) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    const visible = await loc.isVisible({ timeout: 800 }).catch(() => false);
    if (visible) return true;
  }
  return false;
}

async function ensureLoggedIn(page, market) {
  const candidates = Array.from(
    new Set([market.portalBase, 'https://sellercentral.amazon.com', 'https://sellercentral.amazon.co.uk'])
  );

  for (const base of candidates) {
    await page.goto(`${base}/home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2200);
    const url = page.url();
    if (!(url.includes('/ap/signin') || url.includes('/signin') || url.includes('/auth/'))) {
      return base;
    }
  }

  throw new Error(`Amazon session expired for ${market.label}. Refresh amazon-storage-state.json`);
}

async function openPayments(page, market, activePortalBase) {
  const portalBase = activePortalBase || market.portalBase;
  // Pricing-updater style: boot portal -> account-switcher -> select account.
  await page.goto(`${portalBase}/home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1800);

  const switcherUrl = `${portalBase}/account-switcher/default/merchantMarketplace`;
  await page.goto(switcherUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1800);

  const target = page.getByRole('button', { name: new RegExp(market.accountName, 'i') }).first();
  if (!(await target.isVisible({ timeout: 8000 }).catch(() => false))) {
    throw new Error(`Account switcher: "${market.accountName}" not listed`);
  }
  await target.click({ timeout: 10000 });
  await page.waitForTimeout(500);

  const selectAccount = page.getByRole('button', { name: /^Select account$/i }).first();
  if (await selectAccount.isVisible({ timeout: 5000 }).catch(() => false)) {
    await selectAccount.click({ timeout: 10000 });
    await page.waitForTimeout(2200);
  }

  const paymentsUrl = `${portalBase}/payments/reports-and-deposits?mons_sel_mkid=${encodeURIComponent(market.marketplaceId)}`;
  await page.goto(paymentsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  let notFound = await page.locator('text=Not Found').first().isVisible({ timeout: 1500 }).catch(() => false);
  if (!notFound) return;

  // Fallback: codegen-like header account switcher interaction from payments page.
  const headerSwitcher = page.getByText(/-PeakPulse-/).first();
  if (await headerSwitcher.isVisible({ timeout: 2500 }).catch(() => false)) {
    await headerSwitcher.click().catch(() => {});
    await page.waitForTimeout(700);
    await page.getByText(new RegExp(market.accountName, 'i')).first().click().catch(() => {});
    await page.waitForTimeout(700);
    await page.getByRole('link', { name: 'See all' }).click().catch(() => {});
    await page.waitForTimeout(700);
    const mktBtn = page.getByRole('button', { name: new RegExp(market.accountName, 'i') }).first();
    if (await mktBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await mktBtn.click().catch(() => {});
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: /^Select account$/i }).first().click().catch(() => {});
      await page.waitForTimeout(1800);
    }
    await page.goto(paymentsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2200);
    notFound = await page.locator('text=Not Found').first().isVisible({ timeout: 1500 }).catch(() => false);
  }

  if (notFound) {
    throw new Error(`Payments page returned Not Found for ${market.label}. Account routing/session needs refresh.`);
  }
}

async function requestDisbursement(page) {
  // Codegen path: open payouts card action list first when present.
  const payoutChevron = page.locator('#KPI_CARD_PAYMENTS').getByRole('button', { name: 'chevron-down' }).first();
  if (await payoutChevron.isVisible({ timeout: 2000 }).catch(() => false)) {
    await payoutChevron.click({ timeout: 8000 });
    await page.waitForTimeout(600);
  }

  const unavailableText = await page.evaluate(() => {
    const body = (document.body?.innerText || '').toLowerCase();
    const hints = [
      'not eligible',
      'not available',
      'currently unavailable',
      'already requested',
      'can request again',
      'request is not available',
      'you can request',
      'next eligible',
      'pending disbursement',
    ];
    return hints.find(h => body.includes(h)) || '';
  }).catch(() => '');

  if (unavailableText) {
    return {
      status: 'not_available',
      reason: unavailableText,
      clickedRequest: null,
      clickedConfirm: null,
    };
  }

  const clickedRequest = await waitAndClickFirst(page, [
    'button:has-text("Request Payment")',
    'button:has-text("Request payment")',
    'button:has-text("Request disbursement")',
    'button:has-text("Request Disbursement")',
    '[role="button"]:has-text("Request payment")',
    '[role="button"]:has-text("Request disbursement")',
    'a:has-text("Request payment")',
    'a:has-text("Request disbursement")',
  ], 15000);

  if (!clickedRequest) {
    throw new Error('Request payment/disbursement button not found');
  }

  await page.waitForTimeout(1200);

  const clickedConfirm = await waitAndClickFirst(page, [
    'button:has-text("Request disbursement")',
    'button:has-text("Request Disbursement")',
    'button:has-text("Confirm")',
    'button:has-text("Submit")',
    '[role="button"]:has-text("Request disbursement")',
    '[role="button"]:has-text("Confirm")',
  ], 15000);

  // Some marketplaces perform disbursement immediately from first button.
  await page.waitForTimeout(2500);

  return { status: 'submitted', clickedRequest, clickedConfirm: clickedConfirm || 'single-step' };
}

module.exports = async function runAmazonRequestPayments({ page, task, log }) {
  const marketCode = parseMarket(task);
  const options = parseOptions(task);
  const market = MARKET_CONFIG[marketCode];
  if (!market) {
    throw new Error(`Unsupported market "${marketCode}". Use one of: ${Object.keys(MARKET_CONFIG).join(', ')}`);
  }

  const logger = typeof log === 'function'
    ? log
    : async (step, message) => console.log(`[${step}] ${message}`);

  await logger('start', `Request payment flow started for ${market.label}`);
  const activePortalBase = await ensureLoggedIn(page, market);
  await logger('auth', `Session valid on ${market.label} via ${activePortalBase}`);

  await openPayments(page, market, activePortalBase);
  await logger('payments', `Payments page opened: ${page.url()}`);

  if (options.dryRun) {
    const requestVisible = await isAnyVisible(page, [
      'button:has-text("Request payment")',
      'button:has-text("Request Payment")',
      'button:has-text("Request disbursement")',
      'button:has-text("Request Disbursement")',
      '[role="button"]:has-text("Request payment")',
      '[role="button"]:has-text("Request disbursement")',
      'a:has-text("Request payment")',
      'a:has-text("Request disbursement")',
    ]);

    if (!requestVisible) {
      throw new Error(`Dry-run failed: no Request payment/disbursement control visible for ${market.label}`);
    }

    await logger('dry-run', `Dry-run complete; request button visible=${requestVisible}`);
    return {
      success: true,
      dry_run: true,
      task_type: 'amz-request-payments',
      market: marketCode,
      marketplace: market.label,
      url: page.url(),
      request_button_visible: requestVisible,
      checked_at: new Date().toISOString(),
    };
  }

  const clickInfo = await requestDisbursement(page);
  await logger('submit', `Disbursement flow finished (${JSON.stringify(clickInfo)})`);

  return {
    success: true,
    task_type: 'amz-request-payments',
    market: marketCode,
    marketplace: market.label,
    url: page.url(),
    click_info: clickInfo,
    requested_at: new Date().toISOString(),
  };
};
