'use strict';

/**
 * listing-monitor-review-scraper.js
 *
 * Browser_Tasks task_type: listing-review-scrape
 * Standalone script for the Playwright task executor. Collects public 1★–4★
 * reviews for each canonical ASIN and market. 5★ reviews are excluded.
 * Policy assessment is stored for audit and never submits a report.
 * Does not call Amazon SP-API:
 * Customer Feedback v2024-06-01 exposes topics and snippets, not review bodies.
 *
 * Schema is owned by qualico-platform PR #102. This repo does not ship SQL.
 * See docs/listing-review-ingestion.md. A missing contract fails the task.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const {
  buildScope,
  ingestListings,
  schemaBlockedOutcomes,
  summarizeOutcomes,
  resolveTranslationProvider,
  amazonReviewUrl,
  bolReviewsUrl,
} = require('./listing-monitor-review-lib');
const {
  probeColumns,
  schemaContractReady,
  persistReviews,
  persistAssessments,
  persistCoverage,
  taskOutcome,
  writeDebug,
  logExternal,
  postOpenObserve,
  REVIEW_TABLE,
  COVERAGE_TABLE,
  ASSESSMENT_TABLE,
} = require('./listing-monitor-review-persist');

const LISTING_COLUMNS = 'product_id, channel_id, variant_name, asin, listing_url';

function taskParams() {
  if (!process.env.TASK_PARAMS) return {};
  try {
    const parsed = JSON.parse(process.env.TASK_PARAMS);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function applyTaskFilter(listings, params) {
  const channelIds = Array.isArray(params.channel_ids) ? params.channel_ids.map(Number) : null;
  const asins = Array.isArray(params.asins) ? params.asins.map((asin) => String(asin).toUpperCase()) : null;
  return listings.filter((listing) => {
    if (channelIds && !channelIds.includes(listing.channel_id)) return false;
    if (asins && listing.asin && !asins.includes(listing.asin)) return false;
    return true;
  });
}

async function loadCanonicalListings(supabase) {
  const { data, error } = await supabase.from('amazon_monitor_fba_puzzlup').select(LISTING_COLUMNS);
  if (error) throw new Error(`canonical_scope_failed:${error.message}`);
  return buildScope(data || []);
}

async function acceptCookies(page) {
  try {
    const button = page.locator('#sp-cc-accept');
    if (await button.isVisible({ timeout: 2000 })) await button.click();
  } catch (error) { /* banner absent */ }
}

async function readHtmlPage(page, url, log, purpose) {
  const started = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = response ? response.status() : 0;
    await page.waitForTimeout(1000);
    await acceptCookies(page);
    const html = await page.content();
    const finalUrl = page.url() || url;
    await logExternal({ log, method: 'GET', url: finalUrl, status, durationMs: Date.now() - started, purpose });
    return { status, html, url: finalUrl, failed: false };
  } catch (error) {
    await logExternal({ log, method: 'GET', url, status: 0, durationMs: Date.now() - started, purpose });
    return { status: 0, html: '', url, failed: true, reason: 'navigation_error' };
  }
}

async function readHttpPage(url, log, purpose) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
      },
    });
    const html = await response.text();
    await logExternal({ log, method: 'GET', url, status: response.status, durationMs: Date.now() - started, purpose });
    return { status: response.status, html, url, failed: false };
  } catch (error) {
    await logExternal({ log, method: 'GET', url, status: 0, durationMs: Date.now() - started, purpose });
    return { status: 0, html: '', url, failed: true, reason: 'navigation_error' };
  }
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('supabase_env_missing');

  const runId = process.env.BROWSER_TASK_ID
    ? `listing_reviews_task_${process.env.BROWSER_TASK_ID}`
    : `listing_reviews_${Date.now()}`;
  const scrapedAt = new Date().toISOString();
  const params = taskParams();
  const limits = {
    maxPages: Number(params.max_pages || process.env.LISTING_REVIEW_MAX_PAGES || 10),
    bolMaxPages: Number(params.bol_max_pages || process.env.LISTING_REVIEW_BOL_MAX_PAGES || 40),
    pageSize: 10,
  };
  const supabase = createClient(supabaseUrl, supabaseKey);
  const log = async (step, status, message) => {
    const safe = String(message || '').slice(0, 3000);
    console.log(`  [${status}] ${step}: ${safe.slice(0, 180)}`);
    await writeDebug(supabase, runId, step, status, safe);
  };

  const listings = applyTaskFilter(await loadCanonicalListings(supabase), params);
  const reviewSchema = await probeColumns({
    fetchImpl: fetch,
    supabaseUrl,
    supabaseKey,
    table: REVIEW_TABLE,
    log,
  });
  const coverageSchema = await probeColumns({
    fetchImpl: fetch,
    supabaseUrl,
    supabaseKey,
    table: COVERAGE_TABLE,
    log,
  });
  const assessmentSchema = await probeColumns({
    fetchImpl: fetch,
    supabaseUrl,
    supabaseKey,
    table: ASSESSMENT_TABLE,
    log,
  });
  const readiness = schemaContractReady({
    reviewColumns: reviewSchema.ok ? reviewSchema.columns : [],
    coverageColumns: coverageSchema.ok ? coverageSchema.columns : [],
    assessmentColumns: assessmentSchema.ok ? assessmentSchema.columns : [],
  });
  if (!reviewSchema.ok) readiness.reason = reviewSchema.reason;
  else if (!coverageSchema.ok) readiness.reason = coverageSchema.reason;
  else if (!assessmentSchema.ok) readiness.reason = assessmentSchema.reason;

  let outcomes = [];
  let reviewWrite = { ok: false, reason: readiness.reason || 'schema_not_ready' };
  let assessmentWrite = { ok: false, reason: readiness.reason || 'schema_not_ready' };
  let coverageWrite = { ok: false, reason: readiness.reason || 'schema_not_ready' };
  if (!readiness.ready) {
    outcomes = schemaBlockedOutcomes(listings, runId).map((outcome) => ({
      ...outcome,
      started_at: scrapedAt,
      finished_at: scrapedAt,
      reason: outcome.reason === 'awaiting_additive_migration' ? readiness.reason : outcome.reason,
    }));
    await log('schema', 'blocked', readiness.reason || 'schema_not_ready');
  } else {
    const { chromium } = require('playwright');
    const userDataDir = path.join(__dirname, '.browser-data');
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    try {
      outcomes = await ingestListings({
        listings,
        runId,
        scrapedAt,
        limits,
        translate: resolveTranslationProvider(),
        amazon: {
          readProductPage: (listing) => readHtmlPage(
            page,
            `https://www.${listing.domain}/dp/${listing.asin}`,
            log,
            'amazon-product',
          ),
          readPage: (listing, star, pageNumber) => readHtmlPage(
            page,
            amazonReviewUrl(listing.domain, listing.asin, star, pageNumber),
            log,
            'amazon-reviews',
          ),
        },
        bol: {
          readPage: (listing, offset, pageSize) => readHttpPage(
            bolReviewsUrl(listing.listing_url, offset, pageSize),
            log,
            'bol-reviews',
          ),
        },
        webshop: {
          readPage: (listing) => readHttpPage(listing.listing_url, log, 'webshop-product'),
        },
      });
      const reviews = outcomes.flatMap((outcome) => outcome.reviews || []);
      reviewWrite = await persistReviews(supabase, reviews, reviewSchema.columns);
      await log('review-upsert', reviewWrite.ok ? 'success' : 'error', reviewWrite.ok ? `rows:${reviewWrite.written}` : reviewWrite.reason);
      if (reviewWrite.ok) {
        assessmentWrite = await persistAssessments(supabase, reviews, assessmentSchema.columns);
        await log('assessment-upsert', assessmentWrite.ok ? 'success' : 'error', assessmentWrite.ok ? `rows:${assessmentWrite.written}` : assessmentWrite.reason);
        coverageWrite = await persistCoverage(supabase, outcomes, coverageSchema.columns);
        await log('coverage', coverageWrite.ok ? 'success' : 'error', coverageWrite.ok ? `rows:${coverageWrite.written}` : coverageWrite.reason);
      }
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  const summary = summarizeOutcomes(outcomes);
  const outcome = taskOutcome({
    schemaReady: readiness.ready,
    schemaReason: readiness.reason,
    reviewWrite,
    assessmentWrite,
    coverageWrite,
  });
  const result = {
    ok: outcome.ok,
    error: outcome.error,
    run_id: runId,
    scraped_at: scrapedAt,
    schema_ready: readiness.ready,
    schema_reason: readiness.reason,
    translation_provider: null,
    translation_note: 'no_approved_provider_configured',
    openobserve: await postOpenObserve({
      service: 'listing-review-scrape',
      run_id: runId,
      schema_ready: readiness.ready,
      ok: outcome.ok,
      ...summary.counts,
      reviews_collected: summary.reviews_collected,
    }, process.env, fetch).catch(() => ({ sent: false, reason: 'openobserve_post_failed' })),
    ...summary,
  };
  const outputPath = path.join(__dirname, 'listing-review-scrape-data.json');
  if (outcome.ok) {
    fs.writeFileSync(outputPath, JSON.stringify(result));
  } else if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }
  await log('run', outcome.ok ? 'success' : 'error', JSON.stringify({
    listings: summary.listings,
    counts: summary.counts,
    reviews_collected: summary.reviews_collected,
    schema_ready: readiness.ready,
    error: outcome.error,
  }));
  console.log(JSON.stringify(result));
  if (!outcome.ok) {
    console.error(outcome.error || 'listing_review_scrape_failed');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: 'listing_review_scrape_failed' }));
    process.exit(1);
  });
}
