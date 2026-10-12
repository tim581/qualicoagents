#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const offer = require('./listing-monitor-offer');

function rowFor(html, extra = {}) {
  const parsed = offer.parseAmazonOfferHtml(html, 'CAD');
  const observation = offer.observeOffers({
    offers: parsed.offers,
    buybox: parsed.buybox,
    deliveryVerified: true,
    asinMatched: true,
    rating: extra.rating,
    reviewCount: extra.reviewCount,
  });
  if (extra.availability) observation.availability = extra.availability;
  return offer.buildMonitorRow({
    identity: {
      productId: extra.productId || 10,
      channelId: 31,
      name: extra.name || 'Luxe 1500',
      asin: extra.asin || 'B0FDL8BD8V',
      listingUrl: 'https://www.amazon.ca/dp/B0FDL8BD8V',
      currency: 'CAD',
    },
    observation,
    columns: offer.MONITOR_COLUMNS,
    observedAt: '2026-10-12T12:00:00.000Z',
  });
}

const competitorAndOwn = `
<div id="aod-pinned-offer">
  <span class="a-offscreen">C$49.99</span>
  <div id="aod-offer-soldBy"><a>Other Seller</a></div>
  <div id="aod-offer-shipsFrom"><span>Amazon.ca</span></div>
</div>
<div id="aod-offer">
  <span class="a-offscreen">C$56.10</span>
  <div id="aod-offer-soldBy"><a>Puzzlup</a></div>
  <div id="aod-offer-shipsFrom"><span>Amazon.ca</span></div>
  <span>In Stock.</span>
</div>`;
const own = rowFor(competitorAndOwn);
assert.equal(own.row.fba_price, 56.1);
assert.equal(own.row.buybox_seller, 'Other Seller');
assert.equal(own.row.currency, 'CAD');
assert.equal(own.row.in_stock, true);
assert.equal(own.row.fba_price === 49.99, false);

const imported = `
<div id="aod-offer">
  <span class="a-offscreen">C$40.00</span>
  <div id="aod-offer-soldBy"><a>Puzzlup</a></div>
  <div id="aod-offer-shipsFrom"><span>Amazon.ca</span></div>
  Import Fees Deposit included
</div>`;
const blocked = rowFor(imported, { productId: 11, name: 'Gift 5000', asin: 'B0FDBLB658' });
assert.equal(blocked.row.fba_price, null);
assert.equal(blocked.row.product_id, 11);
assert.equal(blocked.row.asin, 'B0FDBLB658');

const fbmOnly = `
<div id="aod-offer">
  <span class="a-offscreen">C$52.00</span>
  <div id="aod-offer-soldBy"><a>Qualico</a></div>
  <div id="aod-offer-shipsFrom"><span>Qualico</span></div>
</div>`;
const fbm = offer.observeOffers({
  ...(() => {
    const parsed = offer.parseAmazonOfferHtml(fbmOnly, 'CAD');
    return { offers: parsed.offers, buybox: parsed.buybox };
  })(),
  deliveryVerified: true,
  asinMatched: true,
});
assert.equal(fbm.ownFbaPrice, null);
assert.equal(fbm.ownFbmPrice, 52);
assert.equal(fbm.fulfillment, 'FBM');
const fbmRow = offer.buildMonitorRow({
  identity: { productId: 10, channelId: 31, name: 'Luxe 1500', asin: 'B0FDL8BD8V', listingUrl: 'https://www.amazon.ca/dp/B0FDL8BD8V', currency: 'CAD' },
  observation: fbm,
  columns: offer.MONITOR_COLUMNS,
  observedAt: '2026-10-12T12:00:00.000Z',
});
assert.equal(fbmRow.row.fba_price, null);
assert.equal(Object.hasOwn(fbmRow.row, 'fbm_price'), false);

const both = `
<div id="aod-offer">
  <span class="a-offscreen">C$56.10</span>
  <div id="aod-offer-soldBy"><a>Puzzlup</a></div>
  <div id="aod-offer-shipsFrom"><span>Amazon.ca</span></div>
</div>
<div id="aod-offer">
  <span class="a-offscreen">C$52.00</span>
  <div id="aod-offer-soldBy"><a>Puzzlup</a></div>
  <div id="aod-offer-shipsFrom"><span>Puzzlup</span></div>
</div>`;
const preferFba = offer.observeOffers({
  ...(() => {
    const parsed = offer.parseAmazonOfferHtml(both, 'CAD');
    return { offers: parsed.offers, buybox: parsed.buybox };
  })(),
  deliveryVerified: true,
  asinMatched: true,
});
assert.equal(preferFba.ownFbaPrice, 56.1);
assert.equal(preferFba.ownFbmPrice, null);
assert.equal(preferFba.fulfillment, 'FBA');

const missing = rowFor('<div id="tabular-buybox"></div>', { rating: Number.NaN, reviewCount: Number.NaN });
assert.equal(missing.row.fba_price, null);
assert.equal(missing.row.in_stock, null);
assert.equal(missing.row.buybox_seller, 'UNKNOWN');
assert.equal(Object.hasOwn(missing.row, 'rating'), false);
assert.equal(Object.hasOwn(missing.row, 'review_count'), false);
assert.equal(Object.hasOwn(missing.row, 'regular_price'), false);
assert.equal(Object.hasOwn(missing.row, 'sale_ends_at'), false);
assert.equal(offer.explicitSaleEnd('Buy now'), null);
assert.equal(offer.explicitRegularPrice('C$56.10'), null);
assert.equal(offer.explicitSaleEnd('Sale ends October 20, 2026'), 'October 20, 2026');
assert.equal(offer.explicitRegularPrice('List Price: C$60.00'), 60);
assert.equal(offer.availabilityFromEvidence({ text: null, addToCart: null }), 'unknown');
assert.equal(offer.availabilityFromEvidence({}), 'unknown');

const unverified = offer.buildMonitorRow({
  identity: { productId: 10, channelId: 31, name: 'Luxe 1500', asin: 'B0FDL8BD8V', listingUrl: 'https://www.amazon.ca/dp/B0FDL8BD8V', currency: 'CAD' },
  observation: { ...fbm, deliveryVerified: false, asinMatched: true },
  columns: offer.MONITOR_COLUMNS,
  observedAt: '2026-10-12T12:00:00.000Z',
});
assert.equal(unverified.row, null);
assert.equal(unverified.reason, 'delivery_unverified');

assert.equal(offer.canadaDeliveryVerified('Balzac T4B 2T3', 'M5V 3L9'), false);
assert.equal(offer.canadaDeliveryVerified('Deliver to M5V 3L9', 'M5V 3L9'), true);
assert.equal(offer.canadaDeliveryVerified('', 'M5V 3L9'), false);

assert.equal(offer.shouldSkipListing({ name: '1500 ECO', productId: 1, asin: 'B0BN3PLV93' }, 31), 'eco_outside_eu');
assert.equal(offer.shouldSkipListing({ name: '1500 ECO', productId: 1, asin: 'B0BN3PLV93' }, 22), null);
assert.equal(offer.shouldSkipListing({ name: 'Sorting Trays White', productId: 14, asin: 'B0FDBL9GRV' }, 22), 'discontinued_asin');
assert.equal(offer.shouldSkipListing({ name: 'Luxe 1500', productId: 10, asin: 'B0FDL8BD8V' }, 31), null);
assert.equal(offer.shouldSkipListing({ name: 'Gift 5000', productId: 11, asin: 'B0FDBLB658' }, 31), null);

assert.equal(offer.HELD_CA_LISTINGS.length, 1);
assert.equal(offer.HELD_CA_LISTINGS[0].asin, 'B0F8HW76VY');
assert.equal(offer.HELD_CA_LISTINGS[0].status, 'held');
assert.deepEqual(
  offer.columnsForWrite(['product_id', 'channel_id', 'fba_price', 'buybox_seller', 'in_stock', 'fbm_price']),
  ['product_id', 'channel_id', 'fba_price', 'buybox_seller', 'in_stock', 'fbm_price'],
);
assert.equal(offer.columnsForWrite(null).includes('fbm_price'), false);

console.log('listing monitor offer tests passed');
