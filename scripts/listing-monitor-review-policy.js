'use strict';

/**
 * Deterministic Amazon Community Guidelines assessment.
 * This does not report reviews, contact reviewers, request edits, or claim removal.
 * Rules were checked against Amazon's public guidelines on 2026-10-01:
 * https://www.amazon.com/gp/help/customer/display.html?nodeId=GLHXEX85MENUE4XF
 * https://sellercentral.amazon.com/gp/help/external/201972160
 * https://sellercentral-europe.amazon.com/gp/help/external/GYRKB5RU3FS5TURN
 */

const POLICY_MODEL = 'deterministic-rules';
const POLICY_VERSION = 'amazon-community-guidelines-2026-10-01';
const POLICY_CHECKED_ON = '2026-10-01';
const POLICY_SOURCE_URLS = [
  'https://www.amazon.com/gp/help/customer/display.html?nodeId=GLHXEX85MENUE4XF',
  'https://sellercentral.amazon.com/gp/help/external/201972160',
  'https://sellercentral-europe.amazon.com/gp/help/external/GYRKB5RU3FS5TURN',
];

const PRODUCT = /\b(mat|mats|puzzle|puzzles|pieces|quality|material|neoprene|thick|thin|size|roll|grip|slip|slips|slipped|surface|foam|tube|tapis|matte|puzzel)\b/i;
const FULFILLMENT = /\b(shipping|delivery|delivered|package|packaging|seller|customer service|return|refund|postage|courier|arrived damaged|damaged in transit|slow to arrive|took three weeks|box was)\b/i;
const UNRELATED = /\b(wrong item|different product|completely different|not what i ordered|another product|unrelated item)\b/i;
const WRONG_VARIANT = /\b(wrong (?:size|variant|asin|colour|color)|sent the wrong)\b/i;
const MISUNDERSTANDING = /\b(i thought|i expected|did not read|didn't read|smaller than i thought|larger than i thought)\b/i;
const COMPETITOR = /\b(compared with|compared to|better than|worse than|competitor)\b/i;
const EXTERNAL_LINK = /https?:\/\/(?!(?:www\.)?amazon\.)/i;
const PRIVATE_INFO = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?\d[\d\s().-]{8,}\d)\b/i;
const PROFANITY = /\b(fuck|shit|asshole|bitch)\b/i;
const HATE = /\bhate\b.{0,40}\b(people|women|men|race|religion)\b/i;
const PROMO = /\b(paid me|gift card|leave a 5-star|discount if you|compensat(?:e|ion)|promo code)\b/i;
const SPAM = /(.)\1{7,}|buy now|click here/i;

function originalText(review) {
  return [review.review_title, review.review_body].filter(Boolean).join(' ').trim();
}

function analysisText(review) {
  if (review.translation_status === 'translated') {
    return [review.review_title_en, review.review_body_en].filter(Boolean).join(' ').trim();
  }
  return originalText(review);
}

function canAssess(review) {
  if (review.original_language === 'en' && review.translation_status === 'not_required') return true;
  return review.translation_status === 'translated'
    && Boolean(review.review_body_en || review.review_title_en);
}

function quoteOriginal(review) {
  const body = review.review_body || review.review_title || '';
  return body || null;
}

function blankAssessment(assessedAt) {
  return {
    policy_status: 'not_assessed',
    policy_categories: [],
    policy_rationale: 'Translation is unavailable, so this review was not assessed.',
    policy_evidence_quote: null,
    policy_confidence: null,
    policy_source_urls: POLICY_SOURCE_URLS,
    policy_checked_on: POLICY_CHECKED_ON,
    policy_assessed_at: assessedAt || null,
    policy_model: POLICY_MODEL,
    policy_version: POLICY_VERSION,
  };
}

function decide(text) {
  const categories = [];
  const product = PRODUCT.test(text);
  const fulfillment = FULFILLMENT.test(text);
  const unrelated = UNRELATED.test(text);
  const wrongVariant = WRONG_VARIANT.test(text);
  const misunderstanding = MISUNDERSTANDING.test(text);
  const competitor = COMPETITOR.test(text) && product;
  const externalLink = EXTERNAL_LINK.test(text);
  const privateInfo = PRIVATE_INFO.test(text);
  const profanity = PROFANITY.test(text);
  const hate = HATE.test(text);
  const promo = PROMO.test(text);
  const spam = SPAM.test(text);

  if (externalLink) categories.push('external_link');
  if (privateInfo) categories.push('private_information');
  if (hate) categories.push('hate');
  if (promo) categories.push('promotion_conflict_or_compensation');
  if (spam) categories.push('spam');
  if (unrelated) categories.push('unrelated_item');
  if (wrongVariant) categories.push('wrong_variant');
  if (profanity) categories.push('harassment_or_profanity');

  const hardViolation = categories.some((category) => [
    'external_link',
    'private_information',
    'hate',
    'promotion_conflict_or_compensation',
    'spam',
  ].includes(category));

  if (hardViolation) {
    return {
      policy_status: 'potential_policy_case',
      policy_categories: categories,
      policy_rationale: 'The text matches a Community Guidelines prohibition. This is an assessment only, not a removal request.',
      policy_confidence: 0.86,
    };
  }

  if (unrelated || wrongVariant) {
    return {
      policy_status: 'potential_policy_case',
      policy_categories: categories,
      policy_rationale: 'The review describes an unrelated item or a wrong variant. A person must confirm it before any report. Removal is not guaranteed.',
      policy_confidence: 0.72,
    };
  }

  if (misunderstanding && !unrelated) {
    return {
      policy_status: 'needs_human_review',
      policy_categories: ['customer_misunderstanding', ...(product ? ['product_criticism'] : [])],
      policy_rationale: 'The wording can be a customer misunderstanding rather than a prohibited review. It is not automatically a violation.',
      policy_confidence: 0.55,
    };
  }

  if (profanity && product) {
    return {
      policy_status: 'needs_human_review',
      policy_categories: ['harassment_or_profanity', 'product_criticism'],
      policy_rationale: 'Profanity appears alongside product feedback. A person should separate the product opinion from the language issue.',
      policy_confidence: 0.5,
    };
  }

  if (product && fulfillment) {
    return {
      policy_status: 'no_clear_policy_case',
      policy_categories: ['mixed_product_and_fulfillment'],
      policy_rationale: 'The review discusses the product and shipping or seller experience together. Mixed feedback is not a strong removal case.',
      policy_confidence: 0.8,
    };
  }

  if (fulfillment && !product) {
    const only = [];
    if (/\b(seller|customer service)\b/i.test(text)) only.push('seller_or_customer_service_only');
    if (/\b(return|refund)\b/i.test(text)) only.push('ordering_or_returns_only');
    if (/\b(package|packaging|box was)\b/i.test(text)) only.push('shipping_packaging_only');
    if (/\b(arrived damaged|damaged in transit)\b/i.test(text)) only.push('product_condition_or_damage_only');
    if (/\b(shipping|delivery|postage|courier|slow to arrive|took three weeks)\b/i.test(text)) only.push('shipping_cost_or_speed_only');
    return {
      policy_status: 'potential_policy_case',
      policy_categories: only.length ? only : ['shipping_cost_or_speed_only'],
      policy_rationale: 'The review only discusses seller, order, packaging, condition, or shipping. Product reviews may not only focus on those topics. This does not submit a report.',
      policy_confidence: 0.84,
    };
  }

  if (competitor) {
    return {
      policy_status: 'no_clear_policy_case',
      policy_categories: ['competitor_comparison', 'product_criticism'],
      policy_rationale: 'A competitor comparison that still describes the product is generally not a violation.',
      policy_confidence: 0.78,
    };
  }

  if (product || text.trim()) {
    return {
      policy_status: 'no_clear_policy_case',
      policy_categories: product ? ['product_criticism'] : [],
      policy_rationale: product
        ? 'The review describes the product, including negative feedback. That is generally allowed.'
        : 'No clear Community Guidelines category was matched.',
      policy_confidence: product ? 0.8 : 0.4,
    };
  }

  return {
    policy_status: 'not_assessed',
    policy_categories: [],
    policy_rationale: 'The review has no text to assess.',
    policy_confidence: null,
  };
}

function assessReview(review, options = {}) {
  const assessedAt = options.assessedAt || null;
  if (!canAssess(review)) {
    return { ...review, ...blankAssessment(assessedAt) };
  }
  const decision = decide(analysisText(review));
  return {
    ...review,
    ...decision,
    policy_evidence_quote: quoteOriginal(review),
    policy_source_urls: POLICY_SOURCE_URLS,
    policy_checked_on: POLICY_CHECKED_ON,
    policy_assessed_at: assessedAt,
    policy_model: POLICY_MODEL,
    policy_version: POLICY_VERSION,
  };
}

module.exports = {
  POLICY_MODEL,
  POLICY_VERSION,
  POLICY_CHECKED_ON,
  POLICY_SOURCE_URLS,
  assessReview,
};
