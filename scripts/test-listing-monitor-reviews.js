#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const lib = require('./listing-monitor-review-lib');
const policy = require('./listing-monitor-review-policy');
const persist = require('./listing-monitor-review-persist');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures/listing-reviews', name), 'utf8');

const de = {
  domain: 'amazon.de',
  channelCountry: 'Germany',
  channelId: 22,
  productId: 12,
  asin: 'B09MBH7RFW',
  productKey: 'B09MBH7RFW',
  scrapedAt: '2026-10-01T12:00:00.000Z',
};

function parsedDe() {
  return lib.parseAmazonReviewHtml(fixture('amazon-de-mixed.html'), { ...de, url: 'https://www.amazon.de/product-reviews/B09MBH7RFW' });
}

async function main() {
const page = parsedDe();
assert.equal(page.blocked, false);
assert.equal(page.hasNext, true);
assert.deepEqual(page.reviews.map((review) => review.star_rating).sort(), [1, 3, 4]);
assert.equal(page.reviews.some((review) => review.star_rating === 5), false);
assert.equal(page.foreign, 1);
assert.equal(page.droppedStar >= 1, true);
const low = page.reviews.find((review) => review.source_review_id === 'R1DELOW');
assert.equal(low.review_title, 'Zu klein');
assert.match(low.review_body, /Die Matte rutscht/);
assert.equal(low.review_date, '2024-01-03');
assert.equal(low.country, 'Germany');
assert.equal(low.verified_purchase, true);
assert.equal(low.helpful_count, 2);
assert.equal(low.source_url, 'https://www.amazon.de/gp/customer-reviews/R1DELOW');
assert.equal(page.reviews.some((review) => review.source_review_id === 'R1USFOREIGN'), false);
assert.equal(page.reviews.some((review) => /40 ratings/.test(review.review_body || '')), false);

const fr = lib.parseAmazonReviewHtml(fixture('amazon-fr-short.html'), {
  domain: 'amazon.fr',
  channelCountry: 'France',
  channelId: 23,
  asin: 'B09MBH7RFW',
  productKey: 'B09MBH7RFW',
  scrapedAt: de.scrapedAt,
});
assert.equal(fr.reviews[0].country, 'France');
assert.equal(fr.reviews[0].star_rating, 2);
assert.equal(fr.reviews[0].review_date, '2024-03-04');
assert.equal(fr.hasNext, false);

const nl = lib.parseAmazonReviewHtml(fixture('amazon-nl.html'), {
  domain: 'amazon.nl',
  channelCountry: 'Netherlands',
  channelId: 27,
  asin: 'B09MBH7RFW',
  productKey: 'B09MBH7RFW',
  scrapedAt: de.scrapedAt,
});
assert.equal(nl.reviews[0].country, 'Netherlands');
assert.equal(lib.detectLanguage(nl.reviews[0].review_body), 'nl');
assert.equal(lib.detectLanguage(low.review_body), 'de');
assert.equal(lib.detectLanguage(fr.reviews[0].review_body), 'fr');
assert.equal(lib.detectLanguage('The mat slipped off the table and the pieces fell apart.'), 'en');
assert.equal(lib.detectLanguage('Ok'), 'und');

const listing = lib.classifyListing({
  product_id: 12,
  channel_id: 22,
  variant_name: 'Gift 1500',
  asin: 'B09MBH7RFW',
  listing_url: 'https://www.amazon.de/dp/B09MBH7RFW',
  review_count: 400,
});
assert.equal(listing.eligible, true);

async function collectOneStar(pages) {
  const reads = [];
  const outcome = await lib.collectAmazonListing({
    listing,
    scrapedAt: de.scrapedAt,
    limits: { maxPages: 3, pageSize: 10 },
    readPage: async (star, pageNumber) => {
      reads.push(`${star}:${pageNumber}`);
      if (star !== 'one_star') return { html: fixture('amazon-fr-short.html'), url: 'https://www.amazon.de/product-reviews/x' };
      return { html: pages[pageNumber - 1], url: `https://www.amazon.de/product-reviews/x?page=${pageNumber}` };
    },
  });
  return { outcome, reads };
}

const paged = await collectOneStar([
  fixture('amazon-de-mixed.html'),
  fixture('amazon-fr-short.html').replace('France', 'Germany').replace('en France', 'aus Deutschland'),
]);
const oneStar = paged.outcome.find((row) => row.star_rating === 1);
assert.equal(oneStar.status, 'complete');
assert.equal(oneStar.pages_fetched, 2);
assert.equal(paged.reads.filter((read) => read.startsWith('one_star:')).length, 2);
assert.equal(paged.outcome.map((row) => row.star_rating).join(','), '1,2,3,4');

const bounded = await lib.collectAmazonListing({
  listing,
  scrapedAt: de.scrapedAt,
  limits: { maxPages: 1, pageSize: 10 },
  readPage: async () => ({ html: fixture('amazon-de-mixed.html'), url: 'https://www.amazon.de/product-reviews/x' }),
});
assert.equal(bounded.find((row) => row.star_rating === 1).status, 'partial');
assert.equal(bounded.find((row) => row.star_rating === 1).reason, 'safety_bound');

const full = await lib.collectAmazonListing({
  listing,
  scrapedAt: de.scrapedAt,
  limits: { maxPages: 2, pageSize: 10 },
  readPage: async (star) => ({
    html: star === 'one_star' ? fixture('amazon-full-page.html') : fixture('amazon-fr-short.html'),
    url: 'https://www.amazon.de/product-reviews/x',
  }),
});
assert.equal(full.find((row) => row.star_rating === 1).status, 'partial');
assert.equal(full.find((row) => row.star_rating === 1).reason, 'pagination_ended_on_full_page');

const blockedReads = [];
const blocked = await lib.collectAmazonListing({
  listing,
  scrapedAt: de.scrapedAt,
  limits: { maxPages: 2, pageSize: 10 },
  readPage: async (star, pageNumber) => {
    blockedReads.push(`${star}:${pageNumber}`);
    return { html: fixture('amazon-captcha.html'), url: 'https://www.amazon.de/ap/signin' };
  },
});
assert.equal(blocked.find((row) => row.star_rating === 1).status, 'blocked');
assert.equal(blocked.find((row) => row.star_rating === 2).status, 'blocked');
assert.deepEqual(blockedReads, ['one_star:1']);

const english = lib.applyTranslation({
  review_title: 'Slips',
  review_body: 'The mat slipped off the table and the pieces fell apart.',
}, null);
assert.equal(english.translation_status, 'not_required');
assert.equal(english.translation_provider, null);
assert.equal(english.review_body_en, english.review_body);
const englishAssessed = policy.assessReview(english, { assessedAt: de.scrapedAt });
assert.equal(englishAssessed.policy_status, 'no_clear_policy_case');
assert.equal(englishAssessed.policy_categories.includes('product_criticism'), true);

const dutch = await lib.translateReviews([{
  review_title: 'Schuift',
  review_body: 'De mat schuift van de tafel en de puzzelstukken vallen eraf.',
  scraped_at: de.scrapedAt,
}], null);
assert.equal(dutch[0].translation_status, 'pending');
assert.equal(dutch[0].review_body_en, null);
assert.equal(dutch[0].policy_status, 'not_assessed');
assert.equal(dutch[0].review_body, 'De mat schuift van de tafel en de puzzelstukken vallen eraf.');

let providerCalls = 0;
const translated = await lib.translateReviews([{
  review_title: 'Schuift',
  review_body: 'De mat schuift van de tafel en de puzzelstukken vallen eraf.',
  scraped_at: de.scrapedAt,
}], async () => {
  providerCalls += 1;
  return {
    title: 'Slips',
    body: 'The mat slips off the table and the puzzle pieces fall off.',
    provider: 'test-provider',
    model: 'test-model',
    version: 'v1',
    translated_at: de.scrapedAt,
  };
});
assert.equal(providerCalls, 1);
assert.equal(translated[0].translation_status, 'translated');
assert.equal(translated[0].review_body, 'De mat schuift van de tafel en de puzzelstukken vallen eraf.');
assert.match(translated[0].review_body_en, /puzzle pieces/);
assert.equal(translated[0].translation_provider, 'test-provider');
assert.equal(translated[0].policy_evidence_quote, translated[0].review_body);

const failed = await lib.translateReviews([{
  review_title: 'Schuift',
  review_body: 'De mat schuift van de tafel en de puzzelstukken vallen eraf.',
  scraped_at: de.scrapedAt,
}], async () => {
  throw new Error('provider down');
});
assert.equal(failed[0].translation_status, 'failed');
assert.equal(failed[0].review_body_en, null);
assert.equal(failed[0].policy_status, 'not_assessed');
assert.equal(lib.resolveTranslationProvider(), null);

const shipping = policy.assessReview(lib.applyTranslation({
  review_title: 'Late',
  review_body: 'The seller shipped this late and the box was crushed. Delivery took three weeks.',
}, null), { assessedAt: de.scrapedAt });
assert.equal(shipping.policy_status, 'potential_policy_case');
assert.equal(shipping.policy_categories.includes('shipping_cost_or_speed_only'), true);
assert.equal(shipping.policy_evidence_quote, shipping.review_body);

const mixed = policy.assessReview(lib.applyTranslation({
  review_title: 'Both',
  review_body: 'The mat slips on the table, and shipping was slow.',
}, null), { assessedAt: de.scrapedAt });
assert.equal(mixed.policy_status, 'no_clear_policy_case');
assert.equal(mixed.policy_categories.includes('mixed_product_and_fulfillment'), true);

const unrelated = policy.assessReview(lib.applyTranslation({
  review_title: 'Wrong',
  review_body: 'I ordered a lamp and received a completely different product.',
}, null), { assessedAt: de.scrapedAt });
assert.equal(unrelated.policy_status, 'potential_policy_case');
assert.equal(unrelated.policy_categories.includes('unrelated_item'), true);

const criticism = policy.assessReview(lib.applyTranslation({
  review_title: 'Quality',
  review_body: 'The mat slips and the pieces do not stay together.',
}, null), { assessedAt: de.scrapedAt });
assert.equal(criticism.policy_status, 'no_clear_policy_case');

const first = { ...low, helpful_count: 2, human_decision: 'keep', human_decision_note: 'Tim', human_decision_at: de.scrapedAt };
const second = { ...low, helpful_count: 5, review_body: low.review_body, human_decision: 'remove', human_decision_note: 'overwrite' };
const merged = lib.mergeReview(first, second);
assert.equal(lib.collapseReviews([first, second]).length, 1);
assert.equal(merged.helpful_count, 5);
assert.equal(merged.human_decision, 'keep');
assert.equal(merged.human_decision_note, 'Tim');
const otherMarket = { ...low, channel_id: 23, product_key: 'B09MBH7RFW' };
assert.notEqual(lib.reviewIdentity(low), lib.reviewIdentity(otherMarket));
const written = persist.reviewWriteRow({ ...merged, human_decision: 'keep' });
assert.equal(Object.hasOwn(written, 'human_decision'), false);
assert.equal(written.policy_status, undefined);
const assessedRow = persist.reviewWriteRow({ ...englishAssessed, human_decision: 'report' });
assert.equal(assessedRow.policy_status, 'no_clear_policy_case');
assert.equal(assessedRow.policy_evidence_quote, englishAssessed.review_body);
assert.equal(Object.hasOwn(assessedRow, 'human_decision'), false);

const logs = [];
await persist.logExternal({
  log: async (step, status, message) => logs.push(message),
  method: 'GET',
  url: 'https://www.amazon.de/product-reviews/B09MBH7RFW/?pageNumber=2',
  status: 200,
  durationMs: 10,
  purpose: 'amazon-reviews',
});
assert.equal(logs[0].includes(low.review_body), false);
assert.match(logs[0], /amazon\.de/);
assert.equal(logs[0].includes('pageNumber'), false);

const scope = lib.buildScope([
  { product_id: 1, channel_id: 32, variant_name: '1500 ECO', asin: 'B0BN3PLV93' },
  { product_id: 1, channel_id: 22, variant_name: '1500 ECO', asin: 'B0BN3PLV93' },
  { product_id: 14, channel_id: 22, variant_name: 'Sorting Trays White', asin: 'B0FDBL9GRV' },
  { product_id: 12, channel_id: 99, variant_name: 'Gift 1500', asin: 'B09MBH7RFW' },
]);
assert.equal(scope[0].skip_reason, 'eco_non_eu');
assert.equal(scope[1].eligible, true);
assert.equal(scope[2].skip_reason, 'discontinued');
assert.equal(scope[3].skip_reason, 'unknown_channel');
const unsupported = lib.ineligibleOutcome(scope[0]);
assert.equal(unsupported.length, 4);
assert.deepEqual(unsupported.map((row) => row.star_rating), [1, 2, 3, 4]);
assert.equal(unsupported.every((row) => row.status === 'unsupported'), true);

const bolListing = lib.classifyListing({
  product_id: 12,
  channel_id: 33,
  variant_name: '1500 Gift',
  listing_url: 'https://www.bol.com/nl/nl/p/puzzlup/9300000045218332/',
});
const bolReads = [];
const bol = await lib.collectBolListing({
  listing: bolListing,
  scrapedAt: de.scrapedAt,
  limits: { maxPages: 5, pageSize: 2 },
  readPage: async (offset) => {
    bolReads.push(offset);
    return {
      status: 200,
      html: offset === 0 ? fixture('bol-mixed.html') : fixture('bol-last.html'),
    };
  },
});
assert.deepEqual(bolReads, [0, 2]);
assert.equal(bol.find((row) => row.star_rating === 1).status, 'complete');
assert.equal(bol.find((row) => row.star_rating === 5), undefined);
assert.equal(bol.find((row) => row.star_rating === 3).status, 'empty');
assert.equal(bol.find((row) => row.star_rating === 2).reviews_collected, 1);

const webshop = lib.classifyListing({
  product_id: 12,
  channel_id: 36,
  variant_name: 'Gift 1500',
  listing_url: 'https://puzzlup.be/product/puzzlemat-1500-gift/',
});
const web = await lib.ingestListings({
  listings: [webshop],
  runId: 'run-test',
  scrapedAt: de.scrapedAt,
  limits: { maxPages: 1 },
  amazon: {},
  bol: {},
  webshop: { readPage: async () => ({ html: fixture('webshop-aggregate.html'), status: 200 }) },
  translate: null,
});
assert.equal(web.length, 4);
assert.equal(web.every((row) => row.status === 'unsupported' && row.reviews_collected === 0), true);
assert.equal(web.some((row) => /1106/.test(JSON.stringify(row.reviews))), false);

const blockedSchema = lib.schemaBlockedOutcomes([listing], 'run-schema');
assert.equal(blockedSchema.length, 4);
assert.equal(blockedSchema.every((row) => row.reason === 'awaiting_additive_migration'), true);

const summary = lib.summarizeOutcomes(web);
assert.equal(JSON.stringify(summary).includes('Maarten'), false);
assert.equal(persist.schemaReadiness(['source', 'channel_id']).ready, false);
assert.equal(persist.schemaReadiness([
  'source', 'channel_id', 'product_key', 'source_review_id', 'star_rating', 'scraped_at',
]).ready, true);

console.log('listing review tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
