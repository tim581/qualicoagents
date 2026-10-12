'use strict';

/**
 * Pure Listing Monitor offer selection. No network and no secrets.
 * A featured page price is the Buy Box price. It is an own FBA price only
 * when the seller is Puzzlup or Qualico and Amazon fulfills that offer.
 */

const NON_EU_CHANNELS = new Set([30, 31, 32]);
const ECO_PRODUCT_IDS = new Set([1, 5]);
const DISCONTINUED_ASINS = new Set(['B0FDBL9GRV']);
const SKIP_NAME = /blanc|white|crème|creme|\bwit\b|off white|bianco/i;
const ECO_NAME = /\beco\b/i;
const OWN_SELLER = /puzzlup|qualico/i;
const INTERNATIONAL = /shipped internationally|import fees deposit/i;

const MONITOR_COLUMNS = [
  'product_id',
  'channel_id',
  'variant_name',
  'fba_price',
  'currency',
  'buybox_seller',
  'rating',
  'review_count',
  'in_stock',
  'listing_url',
  'asin',
  'last_updated',
];

/** Not written unless a live schema probe already has the column. */
const OPTIONAL_MONITOR_COLUMNS = [
  'fulfillment',
  'own_seller',
  'fbm_price',
  'regular_price',
  'sale_ends_at',
  'availability',
];

/**
 * Product 16 has a CA map ASIN and SKU, but amazon.ca scope is unverified
 * and the monitor row is stale with no ASIN. Held out of the scrape.
 */
const HELD_CA_LISTINGS = Object.freeze([
  Object.freeze({
    productId: 16,
    name: 'Gift 1000',
    asin: 'B0F8HW76VY',
    sku: 'CA_1000_MAT',
    channelId: 31,
    status: 'held',
    reason: 'marketplace_scope_unverified',
  }),
]);

function normalizePostal(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function canadaDeliveryVerified(observedText, requestedPostal) {
  const wanted = normalizePostal(requestedPostal);
  const observed = normalizePostal(observedText);
  if (!wanted || !observed) return false;
  return observed.includes(wanted);
}

function shouldSkipListing(variant, channelId) {
  const asin = String(variant && variant.asin || '').toUpperCase();
  const name = String(variant && variant.name || '');
  const productId = Number(variant && variant.productId);
  if (DISCONTINUED_ASINS.has(asin)) return 'discontinued_asin';
  if (SKIP_NAME.test(name)) return 'discontinued_name';
  if (NON_EU_CHANNELS.has(Number(channelId)) && (ECO_PRODUCT_IDS.has(productId) || ECO_NAME.test(name))) {
    return 'eco_outside_eu';
  }
  return null;
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseMoney(raw) {
  if (raw == null) return null;
  const text = String(raw).replace(/\u00a0/g, ' ').replace(/[\r\n]+/g, ' ');
  const match = text.match(/(?:C\$|CA\$|CDN\$|€|£|\$|EUR|GBP|USD|CAD)\s*([0-9][0-9.,]*)/i)
    || text.match(/([0-9][0-9.,]*)\s*(?:€|£|\$|EUR|CAD|USD|GBP)/i);
  if (!match) return null;
  let num = match[1];
  if (num.includes(',') && num.includes('.')) {
    if (num.lastIndexOf(',') > num.lastIndexOf('.')) num = num.replace(/\./g, '').replace(',', '.');
    else num = num.replace(/,/g, '');
  } else if (num.includes(',')) {
    num = /,\d{2}$/.test(num) ? num.replace(',', '.') : num.replace(/,/g, '');
  }
  const value = Number.parseFloat(num);
  if (!Number.isFinite(value) || value <= 0 || value >= 9999) return null;
  return value;
}

function currencyFromText(raw, fallback) {
  const text = String(raw || '');
  if (/C\$|CA\$|CDN\$|\bCAD\b/i.test(text)) return 'CAD';
  if (/£|\bGBP\b/i.test(text)) return 'GBP';
  if (/€|\bEUR\b/i.test(text)) return 'EUR';
  if (/\bUSD\b/i.test(text)) return 'USD';
  if (text.includes('$')) return fallback === 'CAD' ? 'CAD' : 'USD';
  return fallback || null;
}

function classifyFulfillment(shipsFrom, blockText) {
  const ships = String(shipsFrom || '').toLowerCase();
  const text = String(blockText || '').toLowerCase();
  if (/amazon/.test(ships) || /fulfilled by amazon|ships from amazon|expédié par amazon|expedie par amazon|versandt von amazon|versand durch amazon|enviado por amazon|spedito da amazon|verzonden door amazon/.test(text)) {
    return 'FBA';
  }
  if ((ships && !/amazon/.test(ships)) || /fulfilled by merchant|ships from seller|expédié par le vendeur|expedie par le vendeur/.test(text)) {
    return 'FBM';
  }
  return 'unknown';
}

function availabilityFromEvidence({ text, addToCart } = {}) {
  const lower = String(text || '').toLowerCase();
  if (/currently unavailable|not available|nicht verfügbar|indisponible|no disponible|non disponibile|niet beschikbaar|out of stock|temporarily out of stock/.test(lower)) {
    return 'out_of_stock';
  }
  if (/\bin stock\b|auf lager|en stock|disponibile|op voorraad/.test(lower)) return 'in_stock';
  if (addToCart === true) return 'in_stock';
  return 'unknown';
}

function explicitSaleEnd(text) {
  if (!text) return null;
  const match = String(text).match(/(?:sale ends|offer ends|ends|endet am|se termine le|termina el|eindigt op)\s+([A-Za-zÀ-ÿ]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-zÀ-ÿ]+\.?\s+\d{4})/i);
  return match ? match[1].trim() : null;
}

function explicitRegularPrice(text) {
  if (!text) return null;
  const match = String(text).match(/(?:was|list price|typical price|prix conseillé|unverb\.?\s*preis|statt)\s*:?\s*((?:C\$|CA\$|CDN\$|€|£|\$)\s*[0-9][0-9.,]*)/i);
  return match ? parseMoney(match[1]) : null;
}

function sellerFrom(html) {
  const patterns = [
    /aod-offer-soldBy[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
    /tabular-attribute-name="Sold by"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
    /id="sellerProfileTriggerId"[^>]*>([\s\S]*?)<\/a>/i,
    /Sold by[\s\S]{0,160}?<a[^>]*>([\s\S]*?)<\/a>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const seller = stripTags(match[1]);
      if (seller) return seller;
    }
  }
  return null;
}

function shipsFrom(html) {
  const patterns = [
    /aod-offer-shipsFrom[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
    /tabular-attribute-name="Ships from"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return stripTags(match[1]);
  }
  return '';
}

function splitOfferBlocks(html) {
  const marker = /id="aod-pinned-offer"|id="aod-offer"|id="tabular-buybox"/g;
  const indexes = [];
  let match;
  while ((match = marker.exec(html))) {
    indexes.push({
      index: match.index,
      buybox: match[0] !== 'id="aod-offer"',
    });
  }
  if (!indexes.length) {
    return html.trim() ? [{ html, buybox: /tabular-buybox|sellerProfileTriggerId/.test(html) }] : [];
  }
  return indexes.map((entry, index) => ({
    html: html.slice(entry.index, index + 1 < indexes.length ? indexes[index + 1].index : html.length),
    buybox: entry.buybox,
  }));
}

function parseBlock(block, fallbackCurrency) {
  const html = block.html;
  const text = stripTags(html);
  const priceText = (html.match(/class="a-offscreen"[^>]*>([\s\S]*?)</i) || [])[1] || text;
  const seller = sellerFrom(html);
  const ships = shipsFrom(html);
  return {
    seller,
    isOwn: OWN_SELLER.test(seller || ''),
    fulfillment: classifyFulfillment(ships, text),
    price: parseMoney(priceText),
    currency: currencyFromText(priceText, fallbackCurrency),
    international: INTERNATIONAL.test(text),
    availability: availabilityFromEvidence({ text }),
    regularPrice: explicitRegularPrice(text),
    saleEnds: explicitSaleEnd(text),
    buybox: block.buybox,
  };
}

function parseAmazonOfferHtml(html, fallbackCurrency) {
  const source = String(html || '');
  const offers = splitOfferBlocks(source).map((block) => parseBlock(block, fallbackCurrency));
  const featured = (source.match(/class="a-offscreen"[^>]*>([\s\S]*?)</i) || [])[1];
  let buybox = offers.find((offer) => offer.buybox) || null;
  if (buybox && buybox.price == null && featured) {
    buybox = {
      ...buybox,
      price: parseMoney(featured),
      currency: buybox.currency || currencyFromText(featured, fallbackCurrency),
    };
  }
  return { offers, buybox };
}

function observeOffers({ offers, buybox, deliveryVerified, asinMatched, rating, reviewCount }) {
  const own = (offers || []).filter((offer) => offer && offer.isOwn && !offer.international && offer.price != null);
  const ownFba = own.filter((offer) => offer.fulfillment === 'FBA');
  const ownFbm = own.filter((offer) => offer.fulfillment === 'FBM');
  const chosenFba = ownFba[0] || null;
  const chosenFbm = !chosenFba ? (ownFbm[0] || null) : null;
  const chosen = chosenFba || chosenFbm;
  return {
    deliveryVerified: deliveryVerified === true,
    asinMatched: asinMatched === true,
    buyboxSeller: buybox && buybox.seller ? buybox.seller : 'UNKNOWN',
    buyboxPrice: buybox && buybox.price != null ? buybox.price : null,
    ownFbaPrice: chosenFba ? chosenFba.price : null,
    ownFbmPrice: chosenFbm ? chosenFbm.price : null,
    fulfillment: chosenFba ? 'FBA' : chosenFbm ? 'FBM' : 'unknown',
    ownSeller: chosen ? chosen.seller : null,
    availability: chosen ? chosen.availability : 'unknown',
    regularPrice: chosen && chosen.regularPrice != null ? chosen.regularPrice : null,
    saleEnds: chosen && chosen.saleEnds ? chosen.saleEnds : null,
    priceCurrency: chosen ? chosen.currency : null,
    rating: Number.isFinite(rating) ? rating : null,
    reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
  };
}

function columnsForWrite(probedColumns) {
  if (!Array.isArray(probedColumns) || probedColumns.length === 0) return MONITOR_COLUMNS.slice();
  const present = new Set(probedColumns);
  return [...MONITOR_COLUMNS, ...OPTIONAL_MONITOR_COLUMNS].filter((column) => present.has(column));
}

function buildMonitorRow({ identity, observation, columns, observedAt }) {
  if (!observation || observation.deliveryVerified !== true) return { row: null, reason: 'delivery_unverified' };
  if (observation.asinMatched !== true) return { row: null, reason: 'asin_mismatch' };
  const allowed = new Set(columns && columns.length ? columns : MONITOR_COLUMNS);
  const row = {};
  const put = (key, value) => {
    if (allowed.has(key)) row[key] = value;
  };
  put('product_id', identity.productId);
  put('channel_id', identity.channelId);
  put('variant_name', identity.name);
  put('asin', identity.asin);
  put('listing_url', identity.listingUrl);
  put('last_updated', observedAt);
  put('buybox_seller', observation.buyboxSeller || 'UNKNOWN');
  put('currency', observation.priceCurrency || identity.currency);
  put('fba_price', observation.ownFbaPrice == null ? null : observation.ownFbaPrice);
  put('in_stock', observation.availability === 'in_stock' ? true : observation.availability === 'out_of_stock' ? false : null);
  if (observation.rating != null) put('rating', observation.rating);
  if (observation.reviewCount != null) put('review_count', observation.reviewCount);
  if (observation.ownFbmPrice != null) put('fbm_price', observation.ownFbmPrice);
  if (observation.fulfillment) put('fulfillment', observation.fulfillment);
  if (observation.ownSeller) put('own_seller', observation.ownSeller);
  if (observation.regularPrice != null) put('regular_price', observation.regularPrice);
  if (observation.saleEnds) put('sale_ends_at', observation.saleEnds);
  if (allowed.has('availability')) put('availability', observation.availability || 'unknown');
  return { row, reason: null };
}

module.exports = {
  MONITOR_COLUMNS,
  OPTIONAL_MONITOR_COLUMNS,
  HELD_CA_LISTINGS,
  normalizePostal,
  canadaDeliveryVerified,
  shouldSkipListing,
  parseMoney,
  classifyFulfillment,
  availabilityFromEvidence,
  explicitSaleEnd,
  explicitRegularPrice,
  parseAmazonOfferHtml,
  observeOffers,
  columnsForWrite,
  buildMonitorRow,
};
