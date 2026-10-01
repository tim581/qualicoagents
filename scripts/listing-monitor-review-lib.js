'use strict';

const { assessReview } = require('./listing-monitor-review-policy');

/**
 * Listing Monitor bad-review ingestion — pure parsing, eligibility, pagination,
 * translation status, and idempotent merge. No network and no secrets.
 *
 * Amazon SP-API Customer Feedback v2024-06-01 returns review topics and up to
 * three snippets per topic. It does not return individual review bodies, so
 * this module never treats snippets or rating totals as coverage.
 */

const STAR_FILTERS = ['one_star', 'two_star', 'three_star', 'four_star'];
const RATING_SCOPES = [1, 2, 3, 4];
const FILTER_TO_STAR = { one_star: 1, two_star: 2, three_star: 3, four_star: 4 };
const EMPTY_STAR_REASON = 'no_reviews_in_star_scope';
const AMAZON_PAGE_SIZE = 10;
const BOL_PAGE_SIZE = 10;

/** Marketplace identity already stored on amazon_monitor_fba_puzzlup. Not a product catalog. */
const CHANNELS = {
  22: { source: 'amazon', name: 'AMZ DE', domain: 'amazon.de', country: 'Germany', eu: true },
  23: { source: 'amazon', name: 'AMZ FR', domain: 'amazon.fr', country: 'France', eu: true },
  24: { source: 'amazon', name: 'AMZ ES', domain: 'amazon.es', country: 'Spain', eu: true },
  25: { source: 'amazon', name: 'AMZ IT', domain: 'amazon.it', country: 'Italy', eu: true },
  26: { source: 'amazon', name: 'AMZ BE', domain: 'amazon.com.be', country: 'Belgium', eu: true },
  27: { source: 'amazon', name: 'AMZ NL', domain: 'amazon.nl', country: 'Netherlands', eu: true },
  30: { source: 'amazon', name: 'AMZ US', domain: 'amazon.com', country: 'United States', eu: false },
  31: { source: 'amazon', name: 'AMZ CA', domain: 'amazon.ca', country: 'Canada', eu: false },
  32: { source: 'amazon', name: 'AMZ UK', domain: 'amazon.co.uk', country: 'United Kingdom', eu: false },
  33: { source: 'bol', name: 'BOL.COM', domain: 'bol.com', country: 'Netherlands', eu: true },
  36: { source: 'webshop', name: 'WEBSHOP', domain: 'puzzlup.be', country: 'Belgium', eu: true },
};

/** Current price-monitor skip list (scripts/price-monitor-scraper.js). */
const DISCONTINUED_ASINS = new Set(['B0FDBL9GRV']);
const DISCONTINUED_NAME = /blanc|white|crème|creme|\bwit\b|off white|bianco/i;
const ECO_NAME = /\beco\b/i;
const INTERNATIONAL_KEYWORDS = ['shipped internationally', 'import fees deposit'];

const COUNTRY_ALIASES = {
  Germany: ['germany', 'deutschland', 'allemagne', 'alemania', 'germania'],
  France: ['france', 'frankreich', 'francia'],
  Spain: ['spain', 'españa', 'espana', 'spanien', 'espagne', 'spagna'],
  Italy: ['italy', 'italia', 'italien', 'italie'],
  Belgium: ['belgium', 'belgië', 'belgie', 'belgique', 'belgien'],
  Netherlands: ['netherlands', 'nederland', 'pays-bas', 'holland', 'niederlande'],
  'United States': ['united states', 'usa', 'u.s.a', 'états-unis', 'etats-unis', 'vereinigte staaten'],
  Canada: ['canada', 'kanada'],
  'United Kingdom': ['united kingdom', 'uk', 'großbritannien', 'grossbritannien', 'royaume-uni'],
};

const MONTHS = {
  january: 1, janvier: 1, januar: 1, januari: 1, enero: 1, gennaio: 1,
  february: 2, février: 2, fevrier: 2, februar: 2, februari: 2, febrero: 2, febbraio: 2,
  march: 3, mars: 3, märz: 3, marz: 3, maart: 3, marzo: 3,
  april: 4, avril: 4, aprile: 4, abril: 4,
  may: 5, mai: 5, mayo: 5, maggio: 5, mei: 5,
  june: 6, juin: 6, juni: 6, junio: 6, giugno: 6,
  july: 7, juillet: 7, juli: 7, julio: 7, luglio: 7,
  august: 8, août: 8, aout: 8, august: 8, augustus: 8, agosto: 8,
  september: 9, septembre: 9, septiembre: 9, settembre: 9,
  october: 10, octobre: 10, oktober: 10, octubre: 10, ottobre: 10,
  november: 11, novembre: 11, noviembre: 11, novembre: 11,
  december: 12, décembre: 12, decembre: 12, dezember: 12, december: 12, diciembre: 12, dicembre: 12,
};

const LANGUAGE_SIGNALS = {
  en: ['the', 'and', 'was', 'were', 'this', 'with', 'from', 'that', 'have', 'pieces', 'table', 'i', 'a', 'of', 'to', 'it', 'on', 'for', 'not', 'is', 'my', 'you'],
  nl: ['het', 'niet', 'van', 'voor', 'maar', 'zijn', 'wordt', 'geen', 'deze', 'puzzel', 'schuift'],
  de: ['und', 'nicht', 'für', 'ist', 'eine', 'auf', 'vom', 'matte', 'puzzleteile', 'rutscht'],
  fr: ['les', 'des', 'pas', 'est', 'pour', 'avec', 'dans', 'une', 'tapis', 'pièces', 'pieces'],
  es: ['los', 'las', 'para', 'muy', 'está', 'esta', 'del', 'por', 'alfombrilla'],
  it: ['che', 'non', 'per', 'sono', 'questo', 'molto', 'tappeto', 'pezzi'],
};

const TEXT_FIELDS = [
  'review_title', 'review_body', 'review_title_en', 'review_body_en', 'reviewer_name',
  'evidence_quotes', 'rationale',
];

function decodeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAsin(value) {
  const asin = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : null;
}

function productKey(listing) {
  const asin = normalizeAsin(listing.asin);
  if (asin) return asin;
  if (listing.product_id !== null && listing.product_id !== undefined && listing.product_id !== '') {
    return `product:${listing.product_id}`;
  }
  return null;
}

function listingText(listing) {
  return [listing.variant_name, listing.product_name, listing.listing_title]
    .filter(Boolean)
    .join(' ');
}

function isEcoListing(listing) {
  if (listing.is_eco === true) return true;
  return ECO_NAME.test(listingText(listing));
}

function isDiscontinuedListing(listing) {
  const asin = normalizeAsin(listing.asin);
  if (asin && DISCONTINUED_ASINS.has(asin)) return true;
  return DISCONTINUED_NAME.test(listingText(listing));
}

function isInternationalListing(pageText) {
  const lower = String(pageText || '').toLowerCase();
  return INTERNATIONAL_KEYWORDS.some((kw) => lower.includes(kw));
}

function classifyListing(row) {
  const channelId = Number(row.channel_id);
  const channel = CHANNELS[channelId] || null;
  const asin = normalizeAsin(row.asin);
  const listing = {
    product_id: row.product_id ?? null,
    channel_id: Number.isFinite(channelId) ? channelId : null,
    variant_name: row.variant_name || null,
    product_name: row.product_name || null,
    asin,
    listing_url: row.listing_url || null,
    source: channel ? channel.source : 'unknown',
    channel_name: channel ? channel.name : null,
    domain: channel ? channel.domain : null,
    channel_country: channel ? channel.country : null,
    eu: channel ? channel.eu : null,
    product_key: null,
    eligible: false,
    skip_reason: null,
  };
  listing.product_key = productKey(listing);

  if (!channel) {
    listing.skip_reason = 'unknown_channel';
    return listing;
  }
  if (isDiscontinuedListing(listing)) {
    listing.skip_reason = 'discontinued';
    return listing;
  }
  if (listing.source === 'amazon' && isEcoListing(listing) && !listing.eu) {
    listing.skip_reason = 'eco_non_eu';
    return listing;
  }
  if (listing.source === 'amazon' && !listing.asin) {
    listing.skip_reason = 'missing_asin';
    return listing;
  }
  if (listing.source === 'bol') {
    if (!listing.listing_url || !bolProductId(listing.listing_url)) {
      listing.skip_reason = 'missing_listing_url';
      return listing;
    }
  }
  if (listing.source === 'webshop' && !listing.listing_url) {
    listing.skip_reason = 'missing_listing_url';
    return listing;
  }
  if (!listing.product_key) {
    listing.skip_reason = 'missing_product_key';
    return listing;
  }
  listing.eligible = true;
  return listing;
}

function buildScope(rows) {
  return (rows || []).map(classifyListing);
}

function reviewIdentity(review) {
  return [
    review.source || '',
    review.channel_id ?? '',
    review.product_key || '',
    review.source_review_id || '',
  ].join('|');
}

function collapseReviews(reviews) {
  const map = new Map();
  for (const review of reviews || []) {
    if (!review?.source_review_id || !review.product_key) continue;
    const key = reviewIdentity(review);
    const prev = map.get(key);
    map.set(key, prev ? mergeReview(prev, review) : review);
  }
  return [...map.values()];
}

function mergeReview(previous, incoming) {
  const textChanged = (previous.review_title || '') !== (incoming.review_title || '')
    || (previous.review_body || '') !== (incoming.review_body || '');
  const next = {
    ...previous,
    star_rating: incoming.star_rating ?? previous.star_rating,
    review_date: incoming.review_date || previous.review_date,
    source_url: incoming.source_url || previous.source_url,
    helpful_votes: incoming.helpful_votes ?? previous.helpful_votes,
    verified_purchase: incoming.verified_purchase ?? previous.verified_purchase,
    country: incoming.country || previous.country,
    scraped_at: incoming.scraped_at || previous.scraped_at,
  };
  if (!textChanged) return next;
  next.review_title = incoming.review_title ?? previous.review_title ?? null;
  next.review_body = incoming.review_body ?? previous.review_body ?? null;
  next.original_language = incoming.original_language ?? previous.original_language ?? null;
  const incomingHasTranslation = incoming.translation_status === 'translated'
    || incoming.translation_status === 'not_required';
  if (incomingHasTranslation) {
    next.review_title_en = incoming.review_title_en ?? null;
    next.review_body_en = incoming.review_body_en ?? null;
    next.translated_at = incoming.translated_at ?? null;
    next.translation_provider = incoming.translation_provider ?? null;
    next.translation_model = incoming.translation_model ?? null;
    next.translation_version = incoming.translation_version ?? null;
    next.translation_status = incoming.translation_status;
  } else {
    next.review_title_en = previous.review_title_en ?? null;
    next.review_body_en = previous.review_body_en ?? null;
    next.translated_at = previous.translated_at ?? null;
    next.translation_provider = previous.translation_provider ?? null;
    next.translation_model = previous.translation_model ?? null;
    next.translation_version = previous.translation_version ?? null;
    next.translation_status = previous.translation_status ?? incoming.translation_status ?? null;
  }
  next.status = incoming.status ?? previous.status ?? null;
  next.categories = incoming.categories ?? previous.categories ?? [];
  next.rationale = incoming.rationale ?? previous.rationale ?? null;
  next.evidence_quotes = incoming.evidence_quotes ?? previous.evidence_quotes ?? [];
  next.confidence = incoming.confidence ?? previous.confidence ?? null;
  next.source_urls = incoming.source_urls ?? previous.source_urls ?? null;
  next.policy_version = incoming.policy_version ?? previous.policy_version ?? null;
  next.model = incoming.model ?? previous.model ?? null;
  next.model_version = incoming.model_version ?? previous.model_version ?? null;
  next.human_decision = previous.human_decision ?? null;
  next.human_decision_note = previous.human_decision_note ?? null;
  next.human_decision_at = previous.human_decision_at ?? null;
  return next;
}

function detectLanguage(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 4) return 'und';
  const scores = {};
  for (const [lang, words] of Object.entries(LANGUAGE_SIGNALS)) {
    const set = new Set(words);
    scores[lang] = tokens.reduce((sum, token) => sum + (set.has(token) ? 1 : 0), 0);
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1] || 0;
  if (bestScore < 2 || bestScore - secondScore < 1) return 'und';
  return best;
}

function applyTranslation(review, providerResult) {
  const language = review.original_language || detectLanguage(`${review.review_title || ''} ${review.review_body || ''}`);
  const base = {
    ...review,
    original_language: language,
    review_title_en: null,
    review_body_en: null,
    translated_at: null,
    translation_provider: null,
    translation_model: null,
    translation_version: null,
    translation_status: 'pending',
  };
  if (language === 'en') {
    return {
      ...base,
      review_title_en: review.review_title ?? null,
      review_body_en: review.review_body ?? null,
      translation_status: 'not_required',
    };
  }
  if (!providerResult) return base;
  const title = providerResult.title ?? null;
  const body = providerResult.body ?? null;
  if (!title && !body) {
    return { ...base, translation_status: 'failed' };
  }
  if ((title && title === review.review_title) && (body && body === review.review_body) && language !== 'en') {
    return { ...base, translation_status: 'failed' };
  }
  return {
    ...base,
    review_title_en: title,
    review_body_en: body,
    translated_at: providerResult.translated_at || null,
    translation_provider: providerResult.provider || null,
    translation_model: providerResult.model || null,
    translation_version: providerResult.version || null,
    translation_status: 'translated',
  };
}

/**
 * No translation provider is registered in this repo. A name in the environment
 * is not enough — calling an unapproved API would invent a dependency.
 */
function resolveTranslationProvider() {
  return null;
}

function parseStar(block) {
  const classMatch = block.match(/\ba-star-([1-5])\b/);
  if (classMatch) return Number(classMatch[1]);
  const alt = decodeHtml(block.match(/a-icon-alt[^>]*>([^<]+)/i)?.[1]
    || block.match(/aria-label="([^"]+)"/i)?.[1]
    || '');
  const numeric = alt.match(/([1-5])(?:[.,]0+)?/);
  if (!numeric) return null;
  const context = alt.toLowerCase();
  if (!/(star|stern|étoile|etoile|estrella|stella)/.test(context) && !/van 5|von 5|sur 5|de 5|out of 5/.test(context)) {
    return null;
  }
  return Number(numeric[1]);
}

function matchCountry(text) {
  const lower = String(text || '').toLowerCase();
  for (const [country, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.some((alias) => lower.includes(alias))) return country;
  }
  return null;
}

function countryMatchesChannel(statedCountry, channelCountry) {
  if (!statedCountry || !channelCountry) return true;
  return statedCountry === channelCountry;
}

function parseReviewDate(text) {
  const raw = decodeHtml(text);
  if (!raw) return null;
  const monthPattern = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  const dmy = raw.match(new RegExp(`(\\d{1,2})\\.?\\s+(${monthPattern})\\s+(\\d{4})`, 'i'));
  const mdy = raw.match(new RegExp(`(${monthPattern})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
  let day;
  let monthName;
  let year;
  if (dmy) {
    day = Number(dmy[1]);
    monthName = dmy[2];
    year = Number(dmy[3]);
  } else if (mdy) {
    monthName = mdy[1];
    day = Number(mdy[2]);
    year = Number(mdy[3]);
  } else {
    return null;
  }
  const month = MONTHS[monthName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')] || MONTHS[monthName.toLowerCase()];
  if (!month || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

function parseHelpful(block) {
  const hook = block.match(/data-hook="helpful-vote-statement"[^>]*>([\s\S]*?)<\//i);
  const text = decodeHtml(hook?.[1] || '');
  if (!text) return null;
  const one = /\b(one|een|un|une|ein)\b/i.test(text) && !/\d/.test(text);
  if (one) return 1;
  const num = text.match(/(\d+)/);
  return num ? Number(num[1]) : null;
}

function classifyAmazonDocument(html, url = '', status = 0) {
  const code = Number(status);
  if (code === 403 || code === 429 || code >= 500) {
    return { blocked: true, recognized: false, reason: `http_${code}` };
  }
  const lower = `${html || ''} ${url || ''}`.toLowerCase();
  if (lower.includes('/ap/signin') || lower.includes('authportal-center-section') || lower.includes('ap_email')) {
    return { blocked: true, recognized: false, reason: 'signin_required' };
  }
  if (
    lower.includes('validatecaptcha')
    || lower.includes('opfcaptcha')
    || lower.includes('enter the characters you see below')
    || lower.includes('not a robot')
    || lower.includes('robot check')
  ) {
    return { blocked: true, recognized: false, reason: 'captcha' };
  }
  if (lower.includes('automated access') || lower.includes('sorry! something went wrong') || lower.includes('dogs of amazon')) {
    return { blocked: true, recognized: false, reason: 'blocked_page' };
  }
  return { blocked: false, recognized: null };
}

function amazonReviewsPageRecognized(html) {
  const source = String(html || '');
  return /id=["']cm_cr-review_list["']/i.test(source)
    || /data-hook=["']cr-filter-info-section["']/i.test(source)
    || /customer_review-/i.test(source);
}

function hasAmazonNext(html) {
  const match = String(html || '').match(/<li[^>]*class="([^"]*\ba-last\b[^"]*)"[^>]*>([\s\S]*?)<\/li>/i);
  if (!match) return false;
  if (/\ba-disabled\b/.test(match[1])) return false;
  return /<a\s/i.test(match[2]);
}

function amazonReviewBlocks(html) {
  const source = String(html || '');
  const parts = source.split(/id="customer_review-/i).slice(1);
  return parts.map((part) => {
    const id = part.match(/^([A-Z0-9]+)/)?.[1] || null;
    return { id, html: part };
  }).filter((block) => block.id);
}

function amazonReviewTitle(blockHtml) {
  const region = String(blockHtml || '').match(/data-hook="review-title"[\s\S]*?(?=data-hook="review-date"|data-hook="review-body"|$)/i)?.[0] || '';
  const withoutAlt = region.replace(/<[^>]*\ba-icon-alt\b[^>]*>[\s\S]*?<\/[^>]+>/gi, '');
  const spans = [...withoutAlt.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => decodeHtml(match[1]).replace(/\s+/g, ' ').trim())
    .filter((text) => text && !/^[0-9](?:[.,][0-9])?\s+(?:out of|von|sur|de|su|van)\s+5\b/i.test(text));
  const titleRaw = spans.length ? spans[spans.length - 1] : '';
  const stripped = titleRaw.replace(/^[0-9](?:[.,][0-9])?\s+.*?(stars|sternen|étoiles|etoiles|estrellas|stelle)\s*/i, '').trim();
  return stripped || titleRaw || null;
}

function parseAmazonReviewHtml(html, context) {
  const access = classifyAmazonDocument(html, context.url, context.status);
  if (access.blocked) {
    return {
      blocked: true,
      recognized: false,
      reason: access.reason,
      reviews: [],
      seen: 0,
      foreign: 0,
      missingId: 0,
      droppedStar: 0,
      hasNext: false,
    };
  }
  if (!amazonReviewsPageRecognized(html)) {
    return {
      blocked: true,
      recognized: false,
      reason: 'unrecognized_review_document',
      reviews: [],
      seen: 0,
      foreign: 0,
      missingId: 0,
      droppedStar: 0,
      hasNext: false,
    };
  }
  const blocks = amazonReviewBlocks(html);
  const reviews = [];
  let foreign = 0;
  let missingId = 0;
  let droppedStar = 0;
  for (const block of blocks) {
    if (!block.id) {
      missingId += 1;
      continue;
    }
    const stars = parseStar(block.html);
    if (!RATING_SCOPES.includes(stars)) {
      droppedStar += 1;
      continue;
    }
    const dateText = decodeHtml(block.html.match(/data-hook="review-date"[^>]*>([\s\S]*?)<\//i)?.[1] || '');
    const statedCountry = matchCountry(dateText);
    if (!countryMatchesChannel(statedCountry, context.channelCountry)) {
      foreign += 1;
      continue;
    }
    const title = amazonReviewTitle(block.html);
    const body = decodeHtml(block.html.match(/data-hook="review-body"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '') || null;
    const verified = /data-hook="avp-badge"/i.test(block.html) ? true : null;
    const reviewer = decodeHtml(block.html.match(/class="a-profile-name"[^>]*>([\s\S]*?)<\//i)?.[1] || '') || null;
    reviews.push({
      source: 'amazon',
      channel_id: context.channelId,
      product_id: context.productId ?? null,
      asin: context.asin,
      product_key: context.productKey || context.asin,
      source_review_id: block.id,
      review_title: title,
      review_body: body,
      star_rating: stars,
      review_date: parseReviewDate(dateText),
      source_url: `https://www.${context.domain}/gp/customer-reviews/${block.id}`,
      reviewer_name: reviewer,
      verified_purchase: verified,
      helpful_votes: parseHelpful(block.html),
      country: statedCountry,
      scraped_at: context.scrapedAt,
    });
  }
  return {
    blocked: false,
    recognized: true,
    reason: null,
    reviews,
    seen: blocks.length,
    foreign,
    missingId,
    droppedStar,
    hasNext: hasAmazonNext(html),
  };
}

function amazonReviewUrl(domain, asin, starFilter, pageNumber) {
  const params = new URLSearchParams({
    ie: 'UTF8',
    reviewerType: 'all_reviews',
    filterByStar: starFilter,
    pageNumber: String(pageNumber),
    sortBy: 'recent',
  });
  return `https://www.${domain}/product-reviews/${asin}/?${params.toString()}`;
}

function bolProductId(url) {
  const match = String(url || '').match(/\/(\d{10,})\/?(?:\?|#|$)/);
  return match ? match[1] : null;
}

function bolLocalePath(url) {
  const match = String(url || '').match(/bol\.com\/([a-z]{2}\/[a-z]{2})\//i);
  return match ? match[1] : 'nl/nl';
}

function bolReviewsUrl(listingUrl, offset, limit = BOL_PAGE_SIZE) {
  const id = bolProductId(listingUrl);
  if (!id) return null;
  return `https://www.bol.com/${bolLocalePath(listingUrl)}/rnwy/productPage/reviews?productId=${id}&offset=${offset}&limit=${limit}&loadMore=true`;
}

function classifyBolDocument(html, status) {
  const code = Number(status);
  if (code === 403 || code === 401 || code === 429 || code >= 500) {
    return { blocked: true, reason: `http_${code}` };
  }
  const lower = String(html || '').toLowerCase();
  if (lower.includes('captcha') || lower.includes('access denied') || lower.includes('robot')) {
    return { blocked: true, reason: 'access_blocked' };
  }
  return { blocked: false };
}

function bolReviewContract(html) {
  return /id="review-[0-9a-f-]{8,}"/i.test(html || '') || /data-test="review-body"/i.test(html || '');
}

function hasBolNext(html) {
  return /data-test="review-load-more"/i.test(html || '') || /js-review-load-more/i.test(html || '');
}

function parseBolReviewHtml(html, context) {
  const access = classifyBolDocument(html, context.status);
  if (access.blocked) {
    return { blocked: true, reason: access.reason, reviews: [], seen: 0, foreign: 0, missingId: 0, droppedStar: 0, hasNext: false, contract: false };
  }
  const contract = bolReviewContract(html) || /data-test="reviews"|class="reviews"/i.test(html || '');
  const parts = String(html || '').split(/id="review-/i).slice(1);
  const reviews = [];
  let missingId = 0;
  let droppedStar = 0;
  for (const part of parts) {
    const id = part.match(/^([0-9a-f-]{8,})/i)?.[1];
    if (!id) {
      missingId += 1;
      continue;
    }
    const stars = parseStar(part);
    if (!RATING_SCOPES.includes(stars)) {
      droppedStar += 1;
      continue;
    }
    const title = decodeHtml(part.match(/class="review__title"[^>]*>([\s\S]*?)<\//i)?.[1] || '') || null;
    const body = decodeHtml(part.match(/data-test="review-body"[^>]*>([\s\S]*?)<\//i)?.[1] || '') || null;
    const dateText = decodeHtml(part.match(/data-test="review-date"[^>]*>([\s\S]*?)<\//i)?.[1] || '');
    const verified = /data-test="review-verified"/i.test(part) ? true : null;
    const reviewer = decodeHtml(part.match(/data-test="review-author"[^>]*>([\s\S]*?)<\//i)?.[1] || '') || null;
    reviews.push({
      source: 'bol',
      channel_id: context.channelId,
      product_id: context.productId ?? null,
      asin: null,
      product_key: context.productKey,
      source_review_id: id,
      review_title: title,
      review_body: body,
      star_rating: stars,
      review_date: parseReviewDate(dateText),
      source_url: context.listingUrl || null,
      reviewer_name: reviewer,
      verified_purchase: verified,
      helpful_votes: null,
      country: null,
      scraped_at: context.scrapedAt,
    });
  }
  return {
    blocked: false,
    reason: null,
    reviews,
    seen: parts.length,
    foreign: 0,
    missingId,
    droppedStar,
    hasNext: hasBolNext(html),
    contract: contract || parts.length > 0,
  };
}

function inspectWebshopHtml(html, context) {
  const source = String(html || '');
  const individual = /id="comment-\d+"/i.test(source)
    || /class="[^"]*woocommerce-review\b/i.test(source)
    || /data-review-id="[^"]+"/i.test(source);
  if (!individual) {
    return {
      status: 'unsupported',
      reason: 'no_individual_review_source',
      reviews: [],
      pages: source ? 1 : 0,
      seen: 0,
      foreign: 0,
    };
  }
  const blocks = source.split(/id="comment-/i).slice(1);
  const reviews = [];
  let missingId = 0;
  for (const part of blocks) {
    const id = part.match(/^(\d+)/)?.[1];
    if (!id) {
      missingId += 1;
      continue;
    }
    const stars = parseStar(part);
    if (!RATING_SCOPES.includes(stars)) continue;
    reviews.push({
      source: 'webshop',
      channel_id: context.channelId,
      product_id: context.productId ?? null,
      asin: null,
      product_key: context.productKey,
      source_review_id: `comment-${id}`,
      review_title: null,
      review_body: decodeHtml(part.match(/class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '') || null,
      star_rating: stars,
      review_date: parseReviewDate(part),
      source_url: context.listingUrl || null,
      reviewer_name: decodeHtml(part.match(/class="woocommerce-review__author"[^>]*>([\s\S]*?)<\//i)?.[1] || '') || null,
      verified_purchase: null,
      helpful_votes: null,
      country: null,
      scraped_at: context.scrapedAt,
    });
  }
  if (reviews.length === 0 && missingId > 0) {
    return { status: 'blocked', reason: 'reviews_without_source_id', reviews: [], pages: 1, seen: blocks.length, foreign: 0 };
  }
  return {
    status: reviews.length ? 'complete' : 'empty',
    reason: reviews.length ? null : 'no_reviews_in_star_scope',
    reviews,
    pages: 1,
    seen: blocks.length,
    foreign: 0,
  };
}

function pageOutcome({ collected, pages, status, reason }) {
  if (status === 'blocked' || status === 'failed' || status === 'partial') return { status, reason };
  if ((collected || 0) === 0) return { status: 'empty', reason: EMPTY_STAR_REASON };
  return { status: 'complete', reason: null };
}

/**
 * Read successive pages for one Amazon star filter.
 * A full page without a next link is partial: Amazon hides further pages after a cap.
 */
async function collectAmazonStar({ readPage, listing, star, limits, scrapedAt }) {
  const maxPages = limits?.maxPages || 10;
  const pageSize = limits?.pageSize || AMAZON_PAGE_SIZE;
  const reviews = [];
  let pages = 0;
  let seen = 0;
  let foreign = 0;
  let missingId = 0;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const response = await readPage(star, pageNumber);
    if (response.failed) {
      const early = reviews.length === 0 && pages === 0;
      return { status: early ? 'failed' : 'partial', reason: response.reason || 'navigation_error', reviews, pages, seen, foreign, missingId, stopSession: false };
    }
    const parsed = parseAmazonReviewHtml(response.html || '', {
      url: response.url,
      status: response.status,
      domain: listing.domain,
      channelCountry: listing.channel_country,
      channelId: listing.channel_id,
      productId: listing.product_id,
      asin: listing.asin,
      productKey: listing.product_key,
      scrapedAt,
    });
    if (parsed.blocked) {
      const early = reviews.length === 0 && pages === 0;
      return {
        status: early ? 'blocked' : 'partial',
        reason: parsed.reason,
        reviews,
        pages,
        seen,
        foreign,
        missingId,
        stopSession: true,
      };
    }
    pages += 1;
    seen += parsed.seen;
    foreign += parsed.foreign;
    missingId += parsed.missingId;
    reviews.push(...parsed.reviews);
    const fullPage = parsed.seen >= pageSize;
    if (!parsed.hasNext) {
      if (fullPage) {
        return { status: 'partial', reason: 'pagination_ended_on_full_page', reviews, pages, seen, foreign, missingId, stopSession: false };
      }
      return { status: 'exhausted', reason: null, reviews, pages, seen, foreign, missingId, stopSession: false };
    }
    if (pageNumber === maxPages) {
      return { status: 'partial', reason: 'safety_bound', reviews, pages, seen, foreign, missingId, stopSession: false };
    }
  }
  return { status: 'partial', reason: 'safety_bound', reviews, pages, seen, foreign, missingId, stopSession: false };
}

function repeatForStars(listing, details) {
  return RATING_SCOPES.map((star) => {
    const reviews = (details.reviews || []).filter((review) => review.star_rating === star);
    let status = details.status;
    let reason = details.reason || null;
    if (status === 'complete' || status === 'empty') {
      status = reviews.length ? 'complete' : 'empty';
      reason = reviews.length ? null : (details.foreign ? 'foreign_reviews_excluded' : EMPTY_STAR_REASON);
    }
    return outcomeShell(listing, {
      ...details,
      status,
      reason,
      reviews,
      ratingScope: star,
    });
  });
}

function finalizeStarFetch(listing, star, result) {
  const reviews = (result.reviews || []).filter((review) => review.star_rating === star);
  let status = result.status;
  let reason = result.reason;
  if (status === 'exhausted') {
    status = reviews.length ? 'complete' : 'empty';
    reason = reviews.length ? null : (result.foreign ? 'foreign_reviews_excluded' : EMPTY_STAR_REASON);
  }
  return outcomeShell(listing, {
    ...result,
    status,
    reason,
    reviews,
    ratingScope: star,
    pages: result.pages,
    seen: result.seen,
    foreign: result.foreign,
    missingId: result.missingId,
  });
}

async function collectAmazonListing({ readPage, readProductPage, listing, limits, scrapedAt }) {
  if (readProductPage) {
    const product = await readProductPage();
    if (product.failed) {
      return repeatForStars(listing, { status: 'failed', reason: product.reason || 'product_page_failed', pages: 0, reviews: [] });
    }
    const access = classifyAmazonDocument(product.html || '', product.url, product.status);
    if (access.blocked) {
      return repeatForStars(listing, { status: 'blocked', reason: access.reason, pages: 0, reviews: [] });
    }
    if (isInternationalListing(product.html || '')) {
      return repeatForStars(listing, { status: 'unsupported', reason: 'international_or_import_listing', pages: 1, reviews: [] });
    }
  }
  const outcomes = [];
  for (let index = 0; index < STAR_FILTERS.length; index += 1) {
    const filter = STAR_FILTERS[index];
    const star = FILTER_TO_STAR[filter];
    const result = await collectAmazonStar({ readPage, listing, star: filter, limits, scrapedAt });
    outcomes.push(finalizeStarFetch(listing, star, result));
    if (result.stopSession) {
      for (const rest of STAR_FILTERS.slice(index + 1)) {
        outcomes.push(outcomeShell(listing, {
          status: 'blocked',
          reason: result.reason,
          pages: 0,
          reviews: [],
          ratingScope: FILTER_TO_STAR[rest],
        }));
      }
      break;
    }
  }
  return outcomes;
}

async function collectBolListing({ readPage, listing, limits, scrapedAt }) {
  const maxPages = limits?.bolMaxPages || limits?.maxPages || 40;
  const pageSize = limits?.pageSize || BOL_PAGE_SIZE;
  const reviews = [];
  let pages = 0;
  let seen = 0;
  let missingId = 0;
  for (let index = 0; index < maxPages; index += 1) {
    const offset = index * pageSize;
    const response = await readPage(offset, pageSize);
    if (response.failed) {
      const early = pages === 0;
      return repeatForStars(listing, {
        status: early ? 'failed' : 'partial',
        reason: response.reason || 'navigation_error',
        pages,
        reviews,
        seen,
        missingId,
      });
    }
    const parsed = parseBolReviewHtml(response.html || '', {
      status: response.status,
      listingUrl: listing.listing_url,
      channelId: listing.channel_id,
      productId: listing.product_id,
      productKey: listing.product_key,
      scrapedAt,
    });
    if (parsed.blocked) {
      return repeatForStars(listing, {
        status: reviews.length || pages ? 'partial' : 'blocked',
        reason: parsed.reason,
        pages,
        reviews,
        seen,
        missingId,
      });
    }
    if (!parsed.contract) {
      return repeatForStars(listing, {
        status: 'blocked',
        reason: 'unrecognized_review_document',
        pages: pages + 1,
        reviews,
        seen,
        missingId,
      });
    }
    pages += 1;
    seen += parsed.seen;
    missingId += parsed.missingId;
    reviews.push(...parsed.reviews);
    const fullPage = parsed.seen >= pageSize;
    if (!parsed.hasNext) {
      if (fullPage) {
        return repeatForStars(listing, {
          status: 'partial',
          reason: 'pagination_ended_on_full_page',
          pages,
          reviews,
          seen,
          missingId,
        });
      }
      return repeatForStars(listing, {
        status: reviews.length ? 'complete' : 'empty',
        reason: reviews.length ? null : EMPTY_STAR_REASON,
        pages,
        reviews,
        seen,
        missingId,
      });
    }
    if (index === maxPages - 1) {
      return repeatForStars(listing, {
        status: 'partial',
        reason: 'safety_bound',
        pages,
        reviews,
        seen,
        missingId,
      });
    }
  }
  return repeatForStars(listing, { status: 'partial', reason: 'safety_bound', pages, reviews, seen, missingId });
}

function combineListingResults(listing, pieces, totals) {
  const session = pieces.find((piece) => piece.stopSession);
  const reviews = collapseReviews(pieces.flatMap((piece) => piece.reviews || []));
  let status = 'complete';
  let reason = null;
  if (session && reviews.length === 0 && totals.pages === 0) {
    status = 'blocked';
    reason = session.reason;
  } else if (pieces.some((piece) => piece.status === 'failed') && reviews.length === 0) {
    status = 'failed';
    reason = pieces.find((piece) => piece.status === 'failed')?.reason || 'navigation_error';
  } else if (session || pieces.some((piece) => piece.status === 'partial' || piece.status === 'failed' || piece.status === 'blocked')) {
    status = 'partial';
    reason = (session || pieces.find((piece) => piece.reason))?.reason || 'incomplete';
  } else if (reviews.length === 0) {
    status = 'empty';
    reason = totals.foreign > 0 ? 'foreign_reviews_excluded' : 'no_reviews_in_star_scope';
  }
  if (totals.missingId > 0 && (status === 'complete' || status === 'empty')) {
    status = reviews.length ? 'partial' : 'blocked';
    reason = 'reviews_without_source_id';
  }
  return outcomeShell(listing, { ...totals, status, reason, reviews });
}

function outcomeShell(listing, details) {
  const reviews = collapseReviews(details.reviews || []);
  let status = details.status;
  let reason = details.reason || null;
  if ((details.missingId || 0) > 0 && (status === 'complete' || status === 'empty')) {
    status = reviews.length ? 'partial' : 'blocked';
    reason = 'reviews_without_source_id';
  }
  return {
    run_id: details.runId || null,
    source: listing.source,
    channel_id: listing.channel_id,
    product_id: listing.product_id,
    asin: listing.asin,
    variant_name: listing.variant_name,
    product_key: listing.product_key,
    star_rating: details.ratingScope ?? null,
    status,
    pages_fetched: details.pages || 0,
    reviews_collected: reviews.length,
    reviews_seen: details.seen || 0,
    foreign_excluded: details.foreign || 0,
    reason,
    reviews,
    started_at: details.startedAt || null,
    finished_at: details.finishedAt || null,
  };
}

function schemaBlockedOutcomes(listings, runId) {
  return (listings || []).flatMap((listing) => {
    if (!listing.eligible) {
      return ineligibleOutcome(listing).map((outcome) => ({ ...outcome, run_id: runId }));
    }
    return RATING_SCOPES.map((star) => outcomeShell(listing, {
      status: 'blocked',
      reason: 'awaiting_additive_migration',
      pages: 0,
      reviews: [],
      ratingScope: star,
      runId,
    }));
  });
}

async function translateReviews(reviews, translate) {
  const translated = [];
  for (const review of reviews || []) {
    const detected = applyTranslation(review, null);
    if (detected.translation_status !== 'pending' || typeof translate !== 'function') {
      translated.push(assessReview(detected, { assessedAt: review.scraped_at }));
      continue;
    }
    try {
      const result = await translate({
        title: review.review_title,
        body: review.review_body,
        sourceLanguage: detected.original_language,
      });
      translated.push(assessReview(applyTranslation(review, result), { assessedAt: review.scraped_at }));
    } catch (error) {
      translated.push(assessReview({ ...detected, translation_status: 'failed' }, { assessedAt: review.scraped_at }));
    }
  }
  return translated;
}

async function ingestListings({ listings, runId, scrapedAt, limits, amazon, bol, webshop, translate }) {
  const outcomes = [];
  for (const listing of listings || []) {
    const startedAt = scrapedAt;
    if (!listing.eligible) {
      for (const outcome of ineligibleOutcome(listing)) {
        outcomes.push({ ...outcome, run_id: runId, started_at: startedAt, finished_at: scrapedAt });
      }
      continue;
    }
    let batch;
    if (listing.source === 'amazon') {
      batch = await collectAmazonListing({
        readPage: (star, pageNumber) => amazon.readPage(listing, star, pageNumber),
        readProductPage: amazon.readProductPage
          ? () => amazon.readProductPage(listing)
          : null,
        listing,
        limits,
        scrapedAt,
      });
    } else if (listing.source === 'bol') {
      batch = await collectBolListing({
        readPage: (offset, pageSize) => bol.readPage(listing, offset, pageSize),
        listing,
        limits,
        scrapedAt,
      });
    } else if (listing.source === 'webshop') {
      const page = await webshop.readPage(listing);
      if (page.failed) {
        batch = repeatForStars(listing, { status: 'failed', reason: page.reason || 'navigation_error', pages: 0, reviews: [] });
      } else {
        const inspected = inspectWebshopHtml(page.html || '', {
          channelId: listing.channel_id,
          productId: listing.product_id,
          productKey: listing.product_key,
          listingUrl: listing.listing_url,
          scrapedAt,
        });
        batch = repeatForStars(listing, {
          status: inspected.status,
          reason: inspected.reason,
          pages: inspected.pages,
          seen: inspected.seen,
          foreign: inspected.foreign,
          reviews: inspected.reviews,
        });
      }
    } else {
      batch = repeatForStars(listing, { status: 'unsupported', reason: 'unknown_channel', pages: 0, reviews: [] });
    }
    for (const outcome of batch) {
      outcome.run_id = runId;
      outcome.started_at = startedAt;
      outcome.finished_at = scrapedAt;
      outcome.reviews = await translateReviews(outcome.reviews, translate);
      outcome.reviews_collected = outcome.reviews.length;
      outcomes.push(outcome);
    }
  }
  return outcomes;
}

function ineligibleOutcome(listing) {
  return repeatForStars(listing, {
    status: 'unsupported',
    reason: listing.skip_reason || 'ineligible',
    pages: 0,
    reviews: [],
  });
}

function redactForLog(value) {
  if (Array.isArray(value)) return value.map(redactForLog);
  if (!value || typeof value !== 'object') return value;
  const copy = {};
  for (const [key, entry] of Object.entries(value)) {
    if (TEXT_FIELDS.includes(key)) continue;
    copy[key] = redactForLog(entry);
  }
  return copy;
}

function summarizeOutcomes(outcomes) {
  const counts = { complete: 0, empty: 0, partial: 0, blocked: 0, unsupported: 0, failed: 0 };
  for (const outcome of outcomes || []) {
    if (counts[outcome.status] !== undefined) counts[outcome.status] += 1;
  }
  return {
    listings: (outcomes || []).length,
    counts,
    reviews_collected: (outcomes || []).reduce((sum, outcome) => sum + (outcome.reviews_collected || 0), 0),
    pages_fetched: (outcomes || []).reduce((sum, outcome) => sum + (outcome.pages_fetched || 0), 0),
    listings_detail: (outcomes || []).map((outcome) => redactForLog({
      source: outcome.source,
      channel_id: outcome.channel_id,
      product_id: outcome.product_id,
      asin: outcome.asin,
      product_key: outcome.product_key,
      star_rating: outcome.star_rating,
      status: outcome.status,
      pages_fetched: outcome.pages_fetched,
      reviews_collected: outcome.reviews_collected,
      reviews_seen: outcome.reviews_seen,
      foreign_excluded: outcome.foreign_excluded,
      reason: outcome.reason,
    })),
  };
}

module.exports = {
  STAR_FILTERS,
  RATING_SCOPES,
  AMAZON_PAGE_SIZE,
  BOL_PAGE_SIZE,
  CHANNELS,
  DISCONTINUED_ASINS,
  classifyListing,
  buildScope,
  isEcoListing,
  isDiscontinuedListing,
  isInternationalListing,
  reviewIdentity,
  collapseReviews,
  mergeReview,
  detectLanguage,
  applyTranslation,
  resolveTranslationProvider,
  parseStar,
  parseReviewDate,
  matchCountry,
  parseAmazonReviewHtml,
  classifyAmazonDocument,
  amazonReviewsPageRecognized,
  hasAmazonNext,
  amazonReviewUrl,
  bolProductId,
  bolReviewsUrl,
  parseBolReviewHtml,
  inspectWebshopHtml,
  collectAmazonStar,
  collectAmazonListing,
  collectBolListing,
  ineligibleOutcome,
  schemaBlockedOutcomes,
  translateReviews,
  ingestListings,
  redactForLog,
  summarizeOutcomes,
  pageOutcome,
};
