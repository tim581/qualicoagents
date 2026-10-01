'use strict';

const { redactForLog } = require('./listing-monitor-review-lib');

const REVIEW_CONFLICT = 'source,channel_id,product_key,source_review_id';
const REQUIRED_REVIEW_COLUMNS = ['source', 'channel_id', 'product_key', 'source_review_id', 'star_rating', 'scraped_at'];
const COVERAGE_TABLE = 'listing_review_coverage';
const REVIEW_TABLE = 'puzzlup_reviews';
const DEBUG_TABLE = 'Price_Monitor_Debug_Log';

function filterToColumns(row, columns) {
  const allowed = new Set(columns || []);
  const payload = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!allowed.has(key)) continue;
    if (value === undefined) continue;
    payload[key] = value;
  }
  return payload;
}

function reviewWriteRow(review) {
  const row = {
    source: review.source,
    channel_id: review.channel_id,
    product_id: review.product_id,
    asin: review.asin,
    product_key: review.product_key,
    source_review_id: review.source_review_id,
    review_title: review.review_title ?? null,
    review_body: review.review_body ?? null,
    star_rating: review.star_rating,
    review_date: review.review_date ?? null,
    source_url: review.source_url ?? null,
    reviewer_name: review.reviewer_name ?? null,
    verified_purchase: review.verified_purchase ?? null,
    helpful_count: review.helpful_count ?? null,
    country: review.country ?? null,
    scraped_at: review.scraped_at,
    original_language: review.original_language ?? null,
    review_title_en: review.review_title_en ?? null,
    review_body_en: review.review_body_en ?? null,
    translated_at: review.translated_at ?? null,
    translation_provider: review.translation_provider ?? null,
    translation_model: review.translation_model ?? null,
    translation_version: review.translation_version ?? null,
    translation_status: review.translation_status ?? null,
  };
  if (review.policy_status) {
    row.policy_status = review.policy_status;
    row.policy_categories = review.policy_categories ?? [];
    row.policy_rationale = review.policy_rationale ?? null;
    row.policy_evidence_quote = review.policy_evidence_quote ?? null;
    row.policy_confidence = review.policy_confidence ?? null;
    row.policy_source_urls = review.policy_source_urls ?? null;
    row.policy_checked_on = review.policy_checked_on ?? null;
    row.policy_assessed_at = review.policy_assessed_at ?? null;
    row.policy_model = review.policy_model ?? null;
    row.policy_version = review.policy_version ?? null;
  }
  return row;
}

function coverageWriteRow(outcome) {
  return {
    run_id: outcome.run_id,
    source: outcome.source,
    channel_id: outcome.channel_id,
    product_id: outcome.product_id,
    asin: outcome.asin,
    variant_name: outcome.variant_name,
    product_key: outcome.product_key || `unkeyed:${outcome.channel_id}:${outcome.variant_name || 'unknown'}`,
    star_rating: outcome.star_rating,
    status: outcome.status,
    pages_fetched: outcome.pages_fetched || 0,
    reviews_collected: outcome.reviews_collected || 0,
    reviews_seen: outcome.reviews_seen || 0,
    foreign_excluded: outcome.foreign_excluded || 0,
    reason: outcome.reason,
    started_at: outcome.started_at,
    finished_at: outcome.finished_at,
  };
}

function schemaReadiness(columns) {
  const present = new Set(columns || []);
  const missing = REQUIRED_REVIEW_COLUMNS.filter((column) => !present.has(column));
  if (missing.length) {
    return { ready: false, reason: 'schema_missing_source_review_id', missing };
  }
  return { ready: true, reason: null, missing: [] };
}

function definitionsFromOpenApi(spec) {
  if (!spec || typeof spec !== 'object') return {};
  return spec.definitions || spec.components?.schemas || {};
}

async function probeColumns({ fetchImpl, supabaseUrl, supabaseKey, table, log }) {
  const started = Date.now();
  const url = `${supabaseUrl}/rest/v1/`;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/openapi+json',
      },
    });
  } catch (error) {
    await logExternal({ log, method: 'GET', url, status: 0, durationMs: Date.now() - started, purpose: 'schema-probe' });
    return { ok: false, reason: 'schema_probe_failed', columns: [] };
  }
  await logExternal({
    log,
    method: 'GET',
    url,
    status: response.status,
    durationMs: Date.now() - started,
    purpose: 'schema-probe',
  });
  if (!response.ok) return { ok: false, reason: `schema_probe_http_${response.status}`, columns: [] };
  const spec = await response.json();
  const tableDef = definitionsFromOpenApi(spec)[table];
  if (!tableDef?.properties) return { ok: false, reason: 'schema_table_missing', columns: [] };
  return { ok: true, columns: Object.keys(tableDef.properties), reason: null };
}

async function logExternal({ log, method, url, status, durationMs, purpose }) {
  let host = 'unknown';
  let path = '/';
  try {
    const parsed = new URL(url);
    host = parsed.host;
    path = parsed.pathname;
  } catch (error) {
    path = '/';
  }
  const message = JSON.stringify({ method, host, path, status, duration_ms: durationMs, purpose });
  if (typeof log === 'function') await log('external-call', status >= 400 || status === 0 ? 'error' : 'info', message);
}

async function postOpenObserve(event, env, fetchImpl) {
  const base = env.OPENOBSERVE_URL;
  const stream = env.OPENOBSERVE_STREAM || env.OPENOBSERVE_REVIEWS_STREAM;
  if (!base || !stream) return { sent: false, reason: 'openobserve_not_configured' };
  const url = `${base.replace(/\/$/, '')}/api/${encodeURIComponent(env.OPENOBSERVE_ORG || 'default')}/${encodeURIComponent(stream)}/_json`;
  const headers = { 'Content-Type': 'application/json' };
  if (env.OPENOBSERVE_USER && env.OPENOBSERVE_PASSWORD) {
    headers.Authorization = `Basic ${Buffer.from(`${env.OPENOBSERVE_USER}:${env.OPENOBSERVE_PASSWORD}`).toString('base64')}`;
  }
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify([redactForLog(event)]),
  });
  return { sent: response.ok, status: response.status };
}

async function writeDebug(supabase, runId, step, status, message) {
  const short = String(message || '').slice(0, 3000);
  const { error } = await supabase.from(DEBUG_TABLE).insert({
    run_id: runId,
    step,
    status,
    message: short,
  });
  return { ok: !error, error: error ? error.message : null };
}

async function persistReviews(supabase, reviews, columns) {
  const readiness = schemaReadiness(columns);
  if (!readiness.ready) return { ok: false, written: 0, reason: readiness.reason };
  const rows = reviews.map((review) => filterToColumns(reviewWriteRow(review), columns));
  if (!rows.length) return { ok: true, written: 0, reason: null };
  const { error } = await supabase.from(REVIEW_TABLE).upsert(rows, { onConflict: REVIEW_CONFLICT });
  if (error) {
    const missingConstraint = /42P10|no unique or exclusion constraint/i.test(error.message || '');
    return {
      ok: false,
      written: 0,
      reason: missingConstraint ? 'unique_constraint_missing' : 'review_upsert_failed',
    };
  }
  return { ok: true, written: rows.length, reason: null };
}

async function persistCoverage(supabase, outcomes, columns) {
  if (!columns?.length) return { ok: false, written: 0, reason: 'coverage_table_missing' };
  const rows = outcomes.map((outcome) => filterToColumns(coverageWriteRow(outcome), columns));
  const { error } = await supabase.from(COVERAGE_TABLE).upsert(rows, {
    onConflict: 'run_id,source,channel_id,product_key,star_rating',
  });
  if (error) return { ok: false, written: 0, reason: 'coverage_upsert_failed' };
  return { ok: true, written: rows.length, reason: null };
}

module.exports = {
  REVIEW_CONFLICT,
  REQUIRED_REVIEW_COLUMNS,
  COVERAGE_TABLE,
  REVIEW_TABLE,
  filterToColumns,
  reviewWriteRow,
  coverageWriteRow,
  schemaReadiness,
  probeColumns,
  logExternal,
  postOpenObserve,
  writeDebug,
  persistReviews,
  persistCoverage,
};
