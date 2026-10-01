'use strict';

const { redactForLog } = require('./listing-monitor-review-lib');

const REVIEW_CONFLICT = 'source,channel_id,product_key,source_review_id';
const ASSESSMENT_CONFLICT = 'source,channel_id,product_key,source_review_id,policy_version,model,model_version';
const COVERAGE_CONFLICT = 'run_id,source,channel_id,product_key,star_rating';
const REQUIRED_REVIEW_COLUMNS = [
  'source', 'channel_id', 'product_key', 'source_review_id', 'star_rating', 'scraped_at',
  'review_title', 'review_body', 'helpful_votes',
  'original_language', 'review_title_en', 'review_body_en', 'translated_at',
  'translation_provider', 'translation_model', 'translation_version', 'translation_status',
];
const REQUIRED_COVERAGE_COLUMNS = [
  'run_id', 'source', 'channel_id', 'product_key', 'star_rating', 'status',
];
const REQUIRED_ASSESSMENT_COLUMNS = [
  'source', 'channel_id', 'product_key', 'source_review_id',
  'status', 'categories', 'rationale', 'evidence_quotes', 'confidence', 'source_urls',
  'policy_version', 'model', 'model_version',
];
const TRANSLATION_WRITE_FIELDS = [
  'review_title_en', 'review_body_en', 'translated_at',
  'translation_provider', 'translation_model', 'translation_version',
];
const COVERAGE_TABLE = 'listing_review_coverage';
const REVIEW_TABLE = 'puzzlup_reviews';
const ASSESSMENT_TABLE = 'puzzlup_review_policy_assessments';
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
    country: review.country ?? null,
    scraped_at: review.scraped_at,
  };
  if (review.helpful_votes != null) row.helpful_votes = review.helpful_votes;
  if (review.original_language != null) row.original_language = review.original_language;
  const approvedTranslation = review.translation_status === 'not_required' || review.translation_status === 'translated';
  if (approvedTranslation) {
    row.translation_status = review.translation_status;
    for (const field of TRANSLATION_WRITE_FIELDS) {
      if (review[field] != null) row[field] = review[field];
    }
  }
  return row;
}

function evidenceQuotes(review) {
  if (Array.isArray(review.evidence_quotes)) {
    return review.evidence_quotes.filter((quote) => quote != null && quote !== '');
  }
  return [];
}

function assessmentWriteRow(review) {
  return {
    source: review.source,
    channel_id: review.channel_id,
    product_key: review.product_key,
    source_review_id: review.source_review_id,
    status: review.status,
    categories: review.categories ?? [],
    rationale: review.rationale ?? null,
    evidence_quotes: evidenceQuotes(review),
    confidence: review.confidence ?? null,
    source_urls: review.source_urls ?? [],
    policy_version: review.policy_version,
    model: review.model,
    model_version: review.model_version,
  };
}

function assessmentConflictKey(row) {
  return [
    row.source,
    row.channel_id,
    row.product_key,
    row.source_review_id,
    row.policy_version,
    row.model,
    row.model_version,
  ].join('|');
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

function missingColumns(columns, required) {
  const present = new Set(columns || []);
  return required.filter((column) => !present.has(column));
}

function schemaReadiness(columns) {
  const missing = missingColumns(columns, REQUIRED_REVIEW_COLUMNS);
  if (missing.length) {
    return { ready: false, reason: 'schema_missing_source_review_id', missing };
  }
  return { ready: true, reason: null, missing: [] };
}

function schemaContractReady({ reviewColumns, coverageColumns, assessmentColumns }) {
  const review = schemaReadiness(reviewColumns);
  const coverageMissing = missingColumns(coverageColumns, REQUIRED_COVERAGE_COLUMNS);
  const assessmentMissing = missingColumns(assessmentColumns, REQUIRED_ASSESSMENT_COLUMNS);
  if (!review.ready) return { ready: false, reason: review.reason, missing: review.missing };
  if (coverageMissing.length) return { ready: false, reason: 'schema_missing_coverage', missing: coverageMissing };
  if (assessmentMissing.length) {
    return { ready: false, reason: 'schema_missing_policy_assessments', missing: assessmentMissing };
  }
  return { ready: true, reason: null, missing: [] };
}

function taskOutcome({ schemaReady, schemaReason, reviewWrite, assessmentWrite, coverageWrite }) {
  if (!schemaReady) return { ok: false, error: schemaReason || 'schema_not_ready' };
  if (!reviewWrite?.ok) return { ok: false, error: reviewWrite?.reason || 'review_upsert_failed' };
  if (!assessmentWrite?.ok) return { ok: false, error: assessmentWrite?.reason || 'assessment_upsert_failed' };
  if (!coverageWrite?.ok) return { ok: false, error: coverageWrite?.reason || 'coverage_upsert_failed' };
  return { ok: true, error: null };
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

async function persistAssessments(supabase, reviews, columns) {
  const missing = missingColumns(columns, REQUIRED_ASSESSMENT_COLUMNS);
  if (missing.length) return { ok: false, written: 0, reason: 'schema_missing_policy_assessments' };
  const rows = (reviews || [])
    .filter((review) => review?.status && review.source_review_id && review.product_key)
    .map((review) => filterToColumns(assessmentWriteRow(review), columns));
  if (!rows.length) return { ok: true, written: 0, reason: null };
  const { error } = await supabase.from(ASSESSMENT_TABLE).upsert(rows, { onConflict: ASSESSMENT_CONFLICT });
  if (error) {
    const missingConstraint = /42P10|no unique or exclusion constraint/i.test(error.message || '');
    return {
      ok: false,
      written: 0,
      reason: missingConstraint ? 'unique_constraint_missing' : 'assessment_upsert_failed',
    };
  }
  return { ok: true, written: rows.length, reason: null };
}

async function persistCoverage(supabase, outcomes, columns) {
  if (missingColumns(columns, REQUIRED_COVERAGE_COLUMNS).length) {
    return { ok: false, written: 0, reason: 'schema_missing_coverage' };
  }
  const rows = outcomes.map((outcome) => filterToColumns(coverageWriteRow(outcome), columns));
  const { error } = await supabase.from(COVERAGE_TABLE).upsert(rows, {
    onConflict: COVERAGE_CONFLICT,
  });
  if (error) return { ok: false, written: 0, reason: 'coverage_upsert_failed' };
  return { ok: true, written: rows.length, reason: null };
}

module.exports = {
  REVIEW_CONFLICT,
  ASSESSMENT_CONFLICT,
  COVERAGE_CONFLICT,
  REQUIRED_REVIEW_COLUMNS,
  REQUIRED_COVERAGE_COLUMNS,
  REQUIRED_ASSESSMENT_COLUMNS,
  COVERAGE_TABLE,
  REVIEW_TABLE,
  ASSESSMENT_TABLE,
  filterToColumns,
  reviewWriteRow,
  assessmentWriteRow,
  assessmentConflictKey,
  coverageWriteRow,
  schemaReadiness,
  schemaContractReady,
  taskOutcome,
  probeColumns,
  logExternal,
  postOpenObserve,
  writeDebug,
  persistReviews,
  persistAssessments,
  persistCoverage,
};
