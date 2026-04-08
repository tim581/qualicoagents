/**
 * price-monitor-scraper.js  v1.0
 *
 * Standalone Playwright script for weekly Puzzlup price & Buy Box monitoring.
 * Scrapes ~62 product variants across 11 sales channels:
 *   - 10 Amazon marketplaces (Playwright browser automation)
 *   - Bol.com (HTTP scraping)
 *   - Puzzlup Webshop (HTTP scraping)
 *
 * Triggered via Browser_Tasks table (task_type: 'price-scrape').
 * Runs on Tim's PC via playwright-task-executor.js.
 *
 * Prerequisites:
 *   cd C:\Users\Tim\playwright-render-service
 *   npm install playwright @supabase/supabase-js dotenv node-fetch
 *   node price-monitor-scraper.js
 *
 * .env must contain:
 *   SUPABASE_URL=https://zlteahycfmpiaxdbnlvr.supabase.co
 *   SUPABASE_KEY=<service_role key>
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const RUN_ID = `price_${Date.now()}`;
console.log(`\n🔍 Run ID: ${RUN_ID}`);

// ── CHANNEL CONFIG ───────────────────────────────────────────────────────────

const CHANNELS = {
  22: { name: 'AMZ DE', domain: 'amazon.de',     country: 'Germany',       currency: 'EUR', postalCode: '10115', locale: 'de' },
  23: { name: 'AMZ FR', domain: 'amazon.fr',     country: 'France',        currency: 'EUR', postalCode: '75001', locale: 'fr' },
  24: { name: 'AMZ ES', domain: 'amazon.es',     country: 'Spain',         currency: 'EUR', postalCode: '28001', locale: 'es' },
  25: { name: 'AMZ IT', domain: 'amazon.it',     country: 'Italy',         currency: 'EUR', postalCode: '20121', locale: 'it' },
  26: { name: 'AMZ BE', domain: 'amazon.com.be', country: 'Belgium',       currency: 'EUR', postalCode: '1000',  locale: 'nl' },
  27: { name: 'AMZ NL', domain: 'amazon.nl',     country: 'Netherlands',   currency: 'EUR', postalCode: '1012',  locale: 'nl' },
  30: { name: 'AMZ US', domain: 'amazon.com',    country: 'United States', currency: 'USD', postalCode: '10001', locale: 'en' },
  31: { name: 'AMZ CA', domain: 'amazon.ca',     country: 'Canada',        currency: 'CAD', postalCode: 'M5V 3L9', locale: 'en' },
  32: { name: 'AMZ UK', domain: 'amazon.co.uk',  country: 'United Kingdom',currency: 'GBP', postalCode: 'SW1A 1AA', locale: 'en' },
};

// ── PRODUCT CATALOG ──────────────────────────────────────────────────────────
// Hardcoded for reliability — this is the single source of truth

const AMAZON_PRODUCTS = {
  // ── AMAZON DE (channel 22) — Reference catalog ──
  22: {
    url: 'https://www.amazon.de/Puzzlematte-1500-Teile-zusammenrollen-Geschenkverpackung/dp/B09MBH7RFW?th=1',
    variants: [
      { name: 'Gift 1500',     productId: 12, asin: 'B09MBH7RFW' },
      { name: '1500 ECO',      productId: 1,  asin: 'B0BN3PLV93' },
      { name: '3000 ECO',      productId: 5,  asin: 'B0B8DDWL97' },
      { name: 'Gift 3000',     productId: 4,  asin: 'B09WTR77CV' },
      { name: 'Luxe 1500',     productId: 10, asin: 'B0FDL8BD8V' },
    ],
    traysUrl: 'https://www.amazon.de/dp/B0CNW5BJXF?th=1',
    trays: [
      { name: 'Sorting Trays 1500 Black', productId: 14, asin: 'B0CNW5BJXF' },
      { name: 'Sorting Trays 3000 Black', productId: 15, asin: 'B0FDBLCLSD' },
    ],
  },

  // ── AMAZON FR (channel 23) ──
  23: {
    url: 'https://www.amazon.fr/Puzzlup-Tapis-Puzzle-Rouler-Adulte/dp/B09MBH7RFW?th=1',
    variants: [
      { name: 'Gift 1500',     productId: 12, asin: 'B09MBH7RFW' },
      { name: '1500 Eco',      productId: 1,  asin: 'B0BN3PLV93' },
      { name: '3000 Eco',      productId: 5,  asin: 'B0B8DDWL97' },
      { name: 'Gift 3000',     productId: 4,  asin: 'B09WTR77CV' },
      { name: '1500 Luxury',   productId: 10, asin: 'B0FDL8BD8V' },
    ],
    traysUrl: 'https://www.amazon.fr/dp/B0CNW5BJXF?th=1',
    trays: [
      { name: 'Sorting Trays Noir 1500', productId: 14, asin: 'B0CNW5BJXF' },
      { name: 'Sorting Trays Noir 3000', productId: 15, asin: 'B0FDBLCLSD' },
    ],
  },

  // ── AMAZON UK (channel 32) ──
  32: {
    url: 'https://www.amazon.co.uk/Puzzlup-Jigsaw-Puzzle-Roll-Mat/dp/B09MBH7RFW?th=1',
    variants: [
      { name: '1500 GIFT',     productId: 12, asin: 'B09MBH7RFW' },
      { name: '1500 LUXE',     productId: 10, asin: 'B0FDL8BD8V' },
      { name: '3000 GIFT',     productId: 4,  asin: 'B09WTR77CV' },
      { name: '5000 GIFT',     productId: 11, asin: 'B0FDBLB658' },
    ],
    traysUrl: 'https://www.amazon.co.uk/Puzzlup-Jigsaw-Puzzle-Trays-Lid/dp/B0CNW5BJXF?th=1',
    trays: [
      { name: 'Sorting Trays Noir 1500', productId: 14, asin: 'B0CNW5BJXF' },
      { name: 'Sorting Trays Noir 3000', productId: 15, asin: 'B0FDBLCLSD' },
    ],
  },

  // ── AMAZON US (channel 30) — Search-based navigation ──
  30: {
    searchUrl: 'https://www.amazon.com/s?k=Puzzlup+puzzle+mat',
    url: null, // Navigate via search — first result leads to product page
    variants: [
      { name: 'Gift 1500',     productId: 12, asin: 'B09MBH7RFW' },
      { name: '1500 Lux',      productId: 10, asin: 'B0FDL8BD8V' },
      { name: '3000 Gift',     productId: 4,  asin: 'B09WTR77CV' },
    ],
    traysUrl: 'https://www.amazon.com/dp/B0CNW5BJXF?th=1',
    trays: [
      { name: 'Sorting Trays 1500 Black', productId: 14, asin: 'B0CNW5BJXF' },
      { name: 'Sorting Trays 3000 Black', productId: 15, asin: 'B0FDBLCLSD' },
    ],
  },

  // ── AMAZON CA (channel 31) — Search-based navigation ──
  31: {
    searchUrl: 'https://www.amazon.ca/s?k=Puzzlup+puzzle+mat',
    url: null,
    variants: [
      { name: 'Puzzle Mat 1500 (26x47 In)', productId: 12, asin: 'B09MBH7RFW' },
      { name: 'Puzzle Mat 3000 (37x59 In)', productId: 4,  asin: 'B09WTR77CV' },
    ],
    // CA Sorting Trays are SEPARATE ASIN listings (no variant selector)
    separateTrays: [
      { name: 'Sorting Trays 1500 Black', productId: 14, asin: 'B0CNW5BJXF', url: 'https://www.amazon.ca/dp/B0CNW5BJXF' },
      { name: 'Sorting Trays 3000 Black', productId: 15, asin: 'B0FDBLCLSD', url: 'https://www.amazon.ca/dp/B0FDBLCLSD' },
    ],
  },

  // ── AMAZON NL (channel 27) ──
  27: {
    url: 'https://www.amazon.nl/Puzzlup-oprolbare-puzzelmat-1500-volwassenen/dp/B09MBH7RFW?th=1',
    variants: [
      { name: 'Gift 1500',     productId: 12, asin: 'B09MBH7RFW' },
      { name: '1500 Eco',      productId: 1,  asin: 'B0BN3PLV93' },
      { name: 'ECO 3000',      productId: 5,  asin: 'B0B8DDWL97' },
      { name: 'Gift 3000',     productId: 4,  asin: 'B09WTR77CV' },
    ],
  },

  // ── AMAZON BE (channel 26) ──
  26: {
    url: 'https://www.amazon.com.be/-/nl/Puzzelmat-opgerold-accessoires-opbergmat-geschenkverpakking/dp/B09WTR77CV?th=1',
    variants: [
      { name: 'Gift 1500',     productId: 12, asin: 'B09MBH7RFW' },
      { name: '1500 Eco',      productId: 1,  asin: 'B0BN3PLV93' },
      { name: 'Eco 3000',      productId: 5,  asin: 'B0B8DDWL97' },
      { name: 'Gift 3000',     productId: 4,  asin: 'B09WTR77CV' },
    ],
  },

  // ── AMAZON IT (channel 25) ──
  25: {
    url: 'https://www.amazon.it/dp/B09MBH7RFW?th=1',
    variants: [
      { name: 'Gift 1500',     productId: 12, asin: 'B09MBH7RFW' },
      { name: '1500 Eco',      productId: 1,  asin: 'B0BN3PLV93' },
      { name: 'ECO 3000',      productId: 5,  asin: 'B0B8DDWL97' },
      { name: 'Gift 3000',     productId: 4,  asin: 'B09WTR77CV' },
      { name: 'Luxe 1500',     productId: 10, asin: 'B0FDL8BD8V' },
    ],
  },

  // ── AMAZON ES (channel 24) ──
  24: {
    url: 'https://www.amazon.es/dp/B09MBH7RFW/ref=twister_B0BFHRD7T9?th=1',
    variants: [
      { name: 'Gift 1500',     productId: 12, asin: 'B09MBH7RFW' },
      { name: '1500 Eco',      productId: 1,  asin: 'B0BN3PLV93' },
      { name: 'ECO 3000',      productId: 5,  asin: 'B0B8DDWL97' },
      { name: 'Gift 3000',     productId: 4,  asin: 'B09WTR77CV' },
      { name: 'Luxe 1500',     productId: 10, asin: 'B0FDL8BD8V' },
    ],
  },
};

// ── BOL.COM PRODUCTS ─────────────────────────────────────────────────────────

const BOL_PRODUCTS = [
  { name: '1500 Puzzelmat Gift',           productId: 12, url: 'https://www.bol.com/nl/nl/p/puzzlup-puzzelmat-1500-stukjes-puzzelrol-met-opbergtas/9200000134007498/' },
  { name: '1500 Puzzelmat Eco',            productId: 1,  url: 'https://www.bol.com/nl/nl/p/puzzlup-puzzelmat-1500-stukjes-eco-puzzelrol/9300000133618629/' },
  { name: '3000 Puzzelmat XXL Gift',       productId: 4,  url: 'https://www.bol.com/nl/nl/p/puzzlup-puzzelmat-3000-stukjes-xxl-puzzelrol-met-opbergtas/9200000134007526/' },
  { name: '3000 Puzzelmat XXL Eco',        productId: 5,  url: 'https://www.bol.com/nl/nl/p/puzzlup-puzzelmat-3000-stukjes-eco-puzzelrol/9300000133618630/' },
  { name: 'Luxe 1500 Puzzelmat',           productId: 10, url: 'https://www.bol.com/nl/nl/p/puzzlup-luxe-puzzelmat-1500-stukjes-premium-puzzelrol/9300000240566271/' },
  { name: 'Stapelbare Puzzelbakjes',       productId: 14, url: 'https://www.bol.com/nl/nl/p/puzzlup-stapelbare-puzzelbakjes-sorteerbakjes-1500-stukjes/9300000176363501/' },
  { name: 'Stapelbare Puzzelbakjes XL 3000', productId: 15, url: 'https://www.bol.com/nl/nl/p/puzzlup-stapelbare-puzzelbakjes-sorteerbakjes-xl-3000-stukjes/9300000240566990/' },
];

// ── WEBSHOP PRODUCTS ─────────────────────────────────────────────────────────

const WEBSHOP_PAGES = [
  { category: 'mats',  url: 'https://puzzlup.be/puzzle-mats/' },
  { category: 'trays', url: 'https://puzzlup.be/puzzle-trays/' },
];

// Map webshop product names to product IDs
const WEBSHOP_PRODUCT_MAP = {
  'eco 1500':    { productId: 1,  name: 'Eco 1500' },
  'gift 1500':   { productId: 12, name: 'Gift 1500' },
  'gift 1000':   { productId: 16, name: 'Gift 1000' },
  'gift 3000':   { productId: 4,  name: 'Gift 3000' },
  'eco 3000':    { productId: 5,  name: 'Eco 3000' },
  'luxury 1500': { productId: 10, name: 'Luxury 1500' },
  'trays 1500':  { productId: 14, name: 'Trays 1500' },
  '6 trays 1500':{ productId: 14, name: 'Trays 1500' },
  'trays 3000':  { productId: 15, name: 'Trays 3000' },
  '12 trays 3000':{ productId: 15, name: 'Trays 3000' },
};

// ── SKIP RULES ───────────────────────────────────────────────────────────────

const DISCONTINUED_ASINS = ['B0FDBL9GRV']; // White/Blanc/Crème trays
const SKIP_KEYWORDS = ['blanc', 'white', 'crème', 'creme', 'wit', 'off white', 'bianco'];
const INTERNATIONAL_KEYWORDS = ['shipped internationally', 'import fees deposit'];

function shouldSkipVariant(variantName) {
  const lower = variantName.toLowerCase();
  return SKIP_KEYWORDS.some(kw => lower.includes(kw));
}

function isInternationalShipping(pageText) {
  const lower = pageText.toLowerCase();
  return INTERNATIONAL_KEYWORDS.some(kw => lower.includes(kw));
}

// ── RESULTS COLLECTOR ────────────────────────────────────────────────────────

const results = [];     // Collected price data
const alerts = [];      // Buy Box alerts
const priceChanges = []; // Price changes vs last scrape

// ── DEBUG LOGGING ────────────────────────────────────────────────────────────

async function dbLog(step, status, message) {
  const short = (message || '').toString().substring(0, 3000);
  console.log(`  [${status}] ${step}: ${short.substring(0, 150)}`);
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/Price_Monitor_Debug_Log`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ run_id: RUN_ID, step, status, message: short }),
    });
  } catch (e) { /* never break main flow */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 2: AMAZON BROWSER SCRAPING
// ══════════════════════════════════════════════════════════════════════════════

// Cookie consent selectors per locale
const COOKIE_SELECTORS = {
  de: '#sp-cc-accept',
  fr: '#sp-cc-accept',
  es: '#sp-cc-accept',
  it: '#sp-cc-accept',
  nl: '#sp-cc-accept',
  en: '#sp-cc-accept',
};

/**
 * Accept cookie consent banner (Amazon shows this on first visit)
 */
async function acceptCookies(page, locale) {
  try {
    const sel = COOKIE_SELECTORS[locale] || '#sp-cc-accept';
    const btn = page.locator(sel);
    if (await btn.isVisible({ timeout: 3000 })) {
      await btn.click();
      await page.waitForTimeout(1000);
      console.log('  🍪 Cookies accepted');
    }
  } catch (e) { /* no cookie banner — fine */ }
}

/**
 * Set delivery postal code on Amazon to get local prices.
 * Must be done ONCE per domain session.
 */
async function setDeliveryLocation(page, channel) {
  console.log(`  📍 Setting delivery to ${channel.postalCode} (${channel.country})`);
  await dbLog(`location-${channel.name}`, 'info', `Setting postal code: ${channel.postalCode}`);

  try {
    // Click the delivery location link (top-left of Amazon)
    const locationLink = page.locator('#nav-global-location-popover-link, #glow-ingress-block');
    await locationLink.click({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Type postal code in the input field
    const zipInput = page.locator('#GLUXZipUpdateInput, input[data-action="GLUXPostalInputAction"]');
    if (await zipInput.isVisible({ timeout: 3000 })) {
      await zipInput.fill('');
      await zipInput.fill(channel.postalCode);
      await page.waitForTimeout(500);

      // Click Apply button
      const applyBtn = page.locator('#GLUXZipUpdate, [data-action="GLUXPostalUpdateAction"] input[type="submit"]');
      await applyBtn.click({ timeout: 3000 });
      await page.waitForTimeout(2000);
    }

    // Close the popup if still open
    try {
      const closeBtn = page.locator('.a-popover-footer button, #GLUXConfirmClose, .a-button-close');
      if (await closeBtn.first().isVisible({ timeout: 2000 })) {
        await closeBtn.first().click();
        await page.waitForTimeout(1000);
      }
    } catch (e) { /* popup already closed */ }

    console.log(`  ✅ Location set to ${channel.postalCode}`);
    await dbLog(`location-${channel.name}`, 'success', `Set to ${channel.postalCode}`);
  } catch (e) {
    console.log(`  ⚠️ Could not set location: ${e.message}`);
    await dbLog(`location-${channel.name}`, 'warn', `Failed: ${e.message}`);
  }
}

/**
 * Parse a price string like "€34,95", "$69.95", "£79.95", "C$136.23"
 * Returns a float or null.
 */
function parsePrice(priceStr) {
  if (!priceStr) return null;
  // Remove currency symbols and whitespace
  let cleaned = priceStr.replace(/[€$£C\s]/g, '').trim();
  // Handle European format: 34,95 → 34.95 or 1.234,56 → 1234.56
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // 1.234,56 format
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    // 34,95 format (no dot)
    cleaned = cleaned.replace(',', '.');
  }
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

/**
 * Extract price from Amazon product page.
 * Looks for multiple price selectors in order of reliability.
 */
async function extractPrice(page) {
  const selectors = [
    '.priceToPay .a-offscreen',
    '#corePrice_feature_div .a-offscreen',
    '.a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-color-price',
    '#price_inside_buybox',
    '#newBuyBoxPrice',
  ];

  for (const sel of selectors) {
    try {
      const elem = page.locator(sel).first();
      if (await elem.isVisible({ timeout: 1000 })) {
        const text = await elem.textContent();
        const price = parsePrice(text);
        if (price && price > 0 && price < 9999) {
          return { price, raw: text.trim() };
        }
      }
    } catch (e) { /* try next selector */ }
  }

  // Fallback: try to find any price on page
  try {
    const allPrices = await page.locator('.a-price .a-offscreen').allTextContents();
    for (const text of allPrices) {
      const price = parsePrice(text);
      if (price && price > 5 && price < 9999) {
        return { price, raw: text.trim() };
      }
    }
  } catch (e) { /* no price found */ }

  return { price: null, raw: null };
}

/**
 * Extract Buy Box seller information.
 * Returns: "Puzzlup" | "Qualico" | "SUPPRESSED" | competitor name
 */
async function extractBuyBoxSeller(page) {
  const selectors = [
    '#sellerProfileTriggerId',
    '#merchant-info a',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Sold by"] a',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Sold by"] span',
    '#buyboxTabularTruncate-0 a',
    '#aod-offer-soldBy .a-fixed-left-grid-col a',
  ];

  for (const sel of selectors) {
    try {
      const elem = page.locator(sel).first();
      if (await elem.isVisible({ timeout: 1500 })) {
        const text = (await elem.textContent()).trim();
        if (text) return text;
      }
    } catch (e) { /* try next */ }
  }

  // Check if Buy Box is suppressed (no "Add to Cart" button)
  try {
    const addToCart = page.locator('#add-to-cart-button');
    const buyNow = page.locator('#buy-now-button');
    const hasCart = await addToCart.isVisible({ timeout: 1500 });
    const hasBuy = await buyNow.isVisible({ timeout: 1000 });
    if (!hasCart && !hasBuy) {
      return 'SUPPRESSED';
    }
  } catch (e) { /* assume present */ }

  // Check "Available from these sellers" = suppressed
  try {
    const otherSellers = page.locator('#availability_feature_div, #availabilityInsideBuyBox_feature_div');
    const text = await otherSellers.textContent({ timeout: 1000 });
    if (text && text.toLowerCase().includes('available from these sellers')) {
      return 'SUPPRESSED';
    }
  } catch (e) { /* fallback */ }

  return 'UNKNOWN';
}

/**
 * Extract rating (e.g. "4.5 out of 5 stars" → 4.5)
 */
async function extractRating(page) {
  try {
    const ratingElem = page.locator('#acrPopover .a-icon-alt, .reviewCountTextLinkedHistogram .a-icon-alt').first();
    if (await ratingElem.isVisible({ timeout: 2000 })) {
      const text = await ratingElem.textContent();
      const match = text.match(/([\d,.]+)/);
      if (match) {
        return parseFloat(match[1].replace(',', '.'));
      }
    }
  } catch (e) { /* no rating */ }
  return null;
}

/**
 * Extract review count (e.g. "1,234 ratings" → 1234)
 */
async function extractReviewCount(page) {
  try {
    const reviewElem = page.locator('#acrCustomerReviewText').first();
    if (await reviewElem.isVisible({ timeout: 2000 })) {
      const text = await reviewElem.textContent();
      const match = text.match(/([\d,.]+)/);
      if (match) {
        return parseInt(match[1].replace(/[,.]/g, ''));
      }
    }
  } catch (e) { /* no reviews */ }
  return null;
}

/**
 * Check if product is in stock
 */
async function checkInStock(page) {
  try {
    const avail = page.locator('#availability span, #availability_feature_div span').first();
    if (await avail.isVisible({ timeout: 2000 })) {
      const text = (await avail.textContent()).toLowerCase();
      if (text.includes('currently unavailable') || text.includes('not available') || 
          text.includes('nicht verfügbar') || text.includes('indisponible') ||
          text.includes('no disponible') || text.includes('non disponibile') ||
          text.includes('niet beschikbaar')) {
        return false;
      }
    }
    // If Add to Cart exists → in stock
    const addToCart = page.locator('#add-to-cart-button');
    return await addToCart.isVisible({ timeout: 1500 });
  } catch (e) {
    return true; // assume in stock
  }
}

/**
 * Click a specific variant on an Amazon product page.
 * Amazon uses twister (variation selector) buttons.
 */
async function clickVariant(page, variantName) {
  console.log(`    → Clicking variant: "${variantName}"`);
  
  // Try multiple strategies
  // Strategy 1: Exact text match in twister
  try {
    const twisterBtn = page.locator(`#twister li[title*="${variantName}"], #twister_feature_div li[title*="${variantName}"]`).first();
    if (await twisterBtn.isVisible({ timeout: 2000 })) {
      await twisterBtn.click();
      await page.waitForTimeout(2500);
      return true;
    }
  } catch (e) { /* try next strategy */ }

  // Strategy 2: Button with matching text
  try {
    const btn = page.locator(`#twister .a-button-text:has-text("${variantName}")`).first();
    if (await btn.isVisible({ timeout: 2000 })) {
      await btn.click();
      await page.waitForTimeout(2500);
      return true;
    }
  } catch (e) { /* try next */ }

  // Strategy 3: Find in dropdown
  try {
    const dropdown = page.locator('#native_dropdown_selected_size_name, select#native_dropdown_selected_color_name');
    if (await dropdown.isVisible({ timeout: 2000 })) {
      await dropdown.selectOption({ label: variantName });
      await page.waitForTimeout(2500);
      return true;
    }
  } catch (e) { /* try next */ }

  // Strategy 4: Image swatch with alt text
  try {
    const swatch = page.locator(`img[alt*="${variantName}"]`).first();
    if (await swatch.isVisible({ timeout: 2000 })) {
      await swatch.click();
      await page.waitForTimeout(2500);
      return true;
    }
  } catch (e) { /* variant not found */ }

  console.log(`    ⚠️ Could not find variant: "${variantName}"`);
  return false;
}

/**
 * Scrape a single Amazon variant after it's been selected.
 * Returns structured price data.
 */
async function scrapeCurrentVariant(page, channelId, variant, channel) {
  const { price, raw } = await extractPrice(page);
  const buyboxSeller = await extractBuyBoxSeller(page);
  const rating = await extractRating(page);
  const reviewCount = await extractReviewCount(page);
  const inStock = await checkInStock(page);

  // Get listing URL from address bar
  const listingUrl = page.url();

  // Check for international shipping
  try {
    const pageText = await page.locator('#delivery-block-ags-dcp-container_, #mir-layout-DELIVERY_BLOCK').textContent({ timeout: 2000 });
    if (isInternationalShipping(pageText)) {
      console.log(`    ⏭️ SKIP: International shipping detected`);
      return null;
    }
  } catch (e) { /* no shipping block — fine */ }

  const result = {
    product_id: variant.productId,
    channel_id: channelId,
    variant_name: variant.name,
    fba_price: price,
    currency: channel.currency,
    buybox_seller: buyboxSeller,
    rating: rating,
    review_count: reviewCount,
    in_stock: inStock,
    listing_url: listingUrl,
    asin: variant.asin,
    last_updated: new Date().toISOString(),
  };

  // Check Buy Box status
  const seller = (buyboxSeller || '').toLowerCase();
  const isPuzzlup = seller.includes('puzzlup') || seller.includes('qualico');
  
  if (!isPuzzlup && buyboxSeller !== 'SUPPRESSED' && buyboxSeller !== 'UNKNOWN') {
    alerts.push({
      type: 'BB_LOST',
      channel: channel.name,
      variant: variant.name,
      seller: buyboxSeller,
      price: price,
      currency: channel.currency,
    });
  } else if (buyboxSeller === 'SUPPRESSED') {
    alerts.push({
      type: 'BB_SUPPRESSED',
      channel: channel.name,
      variant: variant.name,
      price: price,
      currency: channel.currency,
    });
  }

  console.log(`    ✅ ${variant.name}: ${raw || 'NO PRICE'} | BB: ${buyboxSeller} | ★${rating || '-'} | ${inStock ? 'In Stock' : 'OOS'}`);
  return result;
}

/**
 * Scrape one Amazon market (all variants on the mat listing + trays listing)
 */
async function scrapeAmazonMarket(browser, channelId) {
  const channel = CHANNELS[channelId];
  const products = AMAZON_PRODUCTS[channelId];
  if (!products) return;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🌍 SCRAPING ${channel.name} (${channel.domain})`);
  console.log(`${'═'.repeat(60)}`);
  await dbLog(`market-${channelId}`, 'info', `Starting ${channel.name}`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: channel.locale,
  });
  const page = await context.newPage();

  try {
    // Step 1: Navigate to product or search page
    let startUrl = products.url || products.searchUrl;
    console.log(`  📄 Navigating to: ${startUrl}`);
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Step 2: Accept cookies
    await acceptCookies(page, channel.locale);

    // Step 3: Set delivery location
    await setDeliveryLocation(page, channel);

    // Step 4: If search-based (US/CA), click first Puzzlup result
    if (!products.url && products.searchUrl) {
      console.log(`  🔍 Search-based navigation — finding Puzzlup result...`);
      try {
        const result = page.locator('[data-component-type="s-search-result"] a:has-text("Puzzlup")').first();
        await result.click({ timeout: 10000 });
        await page.waitForTimeout(3000);
      } catch (e) {
        console.log(`  ❌ Could not find Puzzlup in search results`);
        await dbLog(`market-${channelId}`, 'error', `Search nav failed: ${e.message}`);
        await context.close();
        return;
      }
    }

    // Step 5: Scrape mat variants
    console.log(`\n  📦 Scraping ${products.variants.length} mat variants...`);
    for (let i = 0; i < products.variants.length; i++) {
      const variant = products.variants[i];
      if (shouldSkipVariant(variant.name)) {
        console.log(`    ⏭️ SKIP (discontinued): ${variant.name}`);
        continue;
      }

      // Click variant (skip first if it's already selected)
      if (i > 0 || products.variants.length > 1) {
        const clicked = await clickVariant(page, variant.name);
        if (!clicked) {
          // Try navigating directly to ASIN
          console.log(`    → Fallback: direct ASIN navigation`);
          await page.goto(`https://www.${channel.domain}/dp/${variant.asin}?th=1`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(3000);
        }
      }

      const data = await scrapeCurrentVariant(page, channelId, variant, channel);
      if (data) results.push(data);
    }

    // Step 6: Scrape trays (separate listing)
    if (products.trays && products.traysUrl) {
      console.log(`\n  📦 Scraping ${products.trays.length} tray variants...`);
      await page.goto(products.traysUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      for (let i = 0; i < products.trays.length; i++) {
        const variant = products.trays[i];
        if (shouldSkipVariant(variant.name)) continue;

        if (i > 0) {
          const clicked = await clickVariant(page, variant.name);
          if (!clicked) {
            await page.goto(`https://www.${channel.domain}/dp/${variant.asin}?th=1`, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForTimeout(3000);
          }
        }

        const data = await scrapeCurrentVariant(page, channelId, variant, channel);
        if (data) results.push(data);
      }
    }

    // Step 7: CA separate tray listings
    if (products.separateTrays) {
      console.log(`\n  📦 Scraping ${products.separateTrays.length} separate tray ASINs...`);
      for (const tray of products.separateTrays) {
        if (shouldSkipVariant(tray.name)) continue;
        
        await page.goto(tray.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        
        const data = await scrapeCurrentVariant(page, channelId, tray, channel);
        if (data) results.push(data);
      }
    }

    await dbLog(`market-${channelId}`, 'success', `Done: ${results.filter(r => r.channel_id === channelId).length} variants scraped`);

  } catch (err) {
    console.log(`  ❌ Market error: ${err.message}`);
    await dbLog(`market-${channelId}`, 'error', err.message);
  } finally {
    await context.close();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 3: BOL.COM HTTP SCRAPING
// ══════════════════════════════════════════════════════════════════════════════

async function scrapeBolcom() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🟠 SCRAPING BOL.COM (HTTP)`);
  console.log(`${'═'.repeat(60)}`);
  await dbLog('bol', 'info', `Scraping ${BOL_PRODUCTS.length} products`);

  for (const product of BOL_PRODUCTS) {
    try {
      console.log(`  📦 ${product.name}...`);
      
      const response = await fetch(product.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'nl-NL,nl;q=0.9',
        },
      });

      if (!response.ok) {
        console.log(`    ❌ HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();

      // Extract price — Bol.com uses "XX,XX" format in <meta> or price spans
      let price = null;
      let raw = null;
      
      // Strategy 1: meta tag
      const metaMatch = html.match(/"price":\s*"?([\d,.]+)"?/);
      if (metaMatch) {
        price = parsePrice(metaMatch[1]);
        raw = metaMatch[1];
      }

      // Strategy 2: price display
      if (!price) {
        const priceMatch = html.match(/class="promo-price"[^>]*>([\d]+)<sup>([\d]+)<\/sup>/);
        if (priceMatch) {
          price = parseFloat(`${priceMatch[1]}.${priceMatch[2]}`);
          raw = `€${priceMatch[1]},${priceMatch[2]}`;
        }
      }

      // Strategy 3: structured data
      if (!price) {
        const sdMatch = html.match(/"price":\s*([\d.]+)/);
        if (sdMatch) {
          price = parseFloat(sdMatch[1]);
          raw = `€${sdMatch[1]}`;
        }
      }

      // Check stock
      const inStock = !html.includes('Niet leverbaar') && !html.includes('Uitverkocht');

      // Extract rating
      let rating = null;
      const ratingMatch = html.match(/rating.*?([\d,.]+)\s*\/\s*5|"ratingValue":\s*"?([\d,.]+)"?/);
      if (ratingMatch) {
        rating = parseFloat((ratingMatch[1] || ratingMatch[2]).replace(',', '.'));
      }

      // Extract review count
      let reviewCount = null;
      const reviewMatch = html.match(/"reviewCount":\s*"?(\d+)"?|(\d+)\s*reviews?/);
      if (reviewMatch) {
        reviewCount = parseInt(reviewMatch[1] || reviewMatch[2]);
      }

      results.push({
        product_id: product.productId,
        channel_id: 33,
        variant_name: product.name,
        fba_price: price,
        currency: 'EUR',
        buybox_seller: 'D2C', // Own channel — no Buy Box
        rating: rating,
        review_count: reviewCount,
        in_stock: inStock,
        listing_url: product.url,
        asin: null,
        last_updated: new Date().toISOString(),
      });

      console.log(`    ✅ ${product.name}: €${price || 'N/A'} | ${inStock ? 'In Stock' : 'OOS'}`);

    } catch (err) {
      console.log(`    ❌ ${product.name}: ${err.message}`);
      await dbLog('bol', 'error', `${product.name}: ${err.message}`);
    }
  }

  await dbLog('bol', 'success', `Done: ${results.filter(r => r.channel_id === 33).length} products scraped`);
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 4: WEBSHOP HTTP SCRAPING
// ══════════════════════════════════════════════════════════════════════════════

async function scrapeWebshop() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🟣 SCRAPING WEBSHOP (puzzlup.be)`);
  console.log(`${'═'.repeat(60)}`);
  await dbLog('webshop', 'info', 'Starting webshop scrape');

  for (const page of WEBSHOP_PAGES) {
    try {
      console.log(`  📄 Fetching ${page.url}...`);

      const response = await fetch(page.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Accept-Language': 'en-GB,en;q=0.9',
        },
      });

      if (!response.ok) {
        console.log(`    ❌ HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();

      // Find all product cards with name and price
      // WooCommerce pattern: product cards with price
      const productRegex = /<li[^>]*class="[^"]*product[^"]*"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<span class="[^"]*amount[^"]*"[^>]*>[€$£]?\s*([\d,.\s]+)<\/span>/gi;
      
      let match;
      while ((match = productRegex.exec(html)) !== null) {
        const rawName = match[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
        const priceStr = match[2].trim();
        
        // Try to match to known product
        let mapped = null;
        for (const [key, val] of Object.entries(WEBSHOP_PRODUCT_MAP)) {
          if (rawName.includes(key) || key.includes(rawName.substring(0, 8))) {
            mapped = val;
            break;
          }
        }

        if (!mapped) {
          console.log(`    ⚠️ Unknown webshop product: "${rawName}" — skipping`);
          continue;
        }

        const price = parsePrice(priceStr);

        results.push({
          product_id: mapped.productId,
          channel_id: 36,
          variant_name: mapped.name,
          fba_price: price,
          currency: 'EUR',
          buybox_seller: 'D2C',
          rating: null,
          review_count: null,
          in_stock: true, // Webshop only shows in-stock products
          listing_url: page.url,
          asin: null,
          last_updated: new Date().toISOString(),
        });

        console.log(`    ✅ ${mapped.name}: €${price || 'N/A'}`);
      }

    } catch (err) {
      console.log(`    ❌ Webshop error: ${err.message}`);
      await dbLog('webshop', 'error', err.message);
    }
  }

  await dbLog('webshop', 'success', `Done: ${results.filter(r => r.channel_id === 36).length} products scraped`);
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 5: DATABASE WRITES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Load previous prices for change detection
 */
async function loadPreviousPrices() {
  const { data, error } = await supabase
    .from('amazon_monitor_fba_puzzlup')
    .select('product_id, channel_id, variant_name, fba_price, buybox_seller');

  if (error) {
    console.log(`⚠️ Could not load previous prices: ${error.message}`);
    return {};
  }

  const map = {};
  for (const row of (data || [])) {
    map[`${row.product_id}_${row.channel_id}_${row.variant_name}`] = row;
  }
  return map;
}

/**
 * Detect price changes and Buy Box switches
 */
function detectChanges(previousPrices) {
  for (const r of results) {
    const key = `${r.product_id}_${r.channel_id}_${r.variant_name}`;
    const prev = previousPrices[key];

    if (prev) {
      // Price change detection
      if (prev.fba_price && r.fba_price && prev.fba_price !== r.fba_price) {
        const pctChange = ((r.fba_price - prev.fba_price) / prev.fba_price * 100).toFixed(1);
        priceChanges.push({
          channel: CHANNELS[r.channel_id]?.name || `CH${r.channel_id}`,
          variant: r.variant_name,
          oldPrice: prev.fba_price,
          newPrice: r.fba_price,
          currency: r.currency,
          pctChange: pctChange,
        });
      }

      // FBA → FBM switch detection
      const prevSeller = (prev.buybox_seller || '').toLowerCase();
      const newSeller = (r.buybox_seller || '').toLowerCase();
      const prevIsPuzzlup = prevSeller.includes('puzzlup') || prevSeller.includes('qualico');
      const newIsPuzzlup = newSeller.includes('puzzlup') || newSeller.includes('qualico');
      
      if (prevIsPuzzlup && !newIsPuzzlup && r.buybox_seller !== 'D2C') {
        alerts.push({
          type: 'BB_SWITCH',
          channel: CHANNELS[r.channel_id]?.name || `BOL/WEB`,
          variant: r.variant_name,
          from: prev.buybox_seller,
          to: r.buybox_seller,
        });
      }
    }
  }
}

/**
 * UPSERT all results to amazon_monitor_fba_puzzlup
 */
async function writeToSupabase() {
  console.log(`\n💾 Writing ${results.length} records to Supabase...`);
  await dbLog('db-write', 'info', `Upserting ${results.length} records`);

  // Batch upsert
  const { error } = await supabase
    .from('amazon_monitor_fba_puzzlup')
    .upsert(results, {
      onConflict: 'product_id,channel_id,variant_name',
    });

  if (error) {
    console.log(`❌ Supabase upsert failed: ${error.message}`);
    await dbLog('db-write', 'error', error.message);
  } else {
    console.log(`✅ ${results.length} records upserted`);
    await dbLog('db-write', 'success', `${results.length} records`);
  }
}

/**
 * Update puzzlup_margins.price_incl_vat_local with new scraped prices
 * (Strategy A: match on product_id + channel_id)
 */
async function updateMargins() {
  console.log(`\n📊 Updating margin prices...`);
  let updated = 0;

  for (const r of results) {
    if (!r.fba_price || r.fba_price <= 0) continue;

    const { error } = await supabase
      .from('puzzlup_margins')
      .update({ price_incl_vat_local: r.fba_price })
      .eq('product_id', r.product_id)
      .eq('channel_id', r.channel_id);

    if (!error) updated++;
  }

  console.log(`✅ ${updated} margin records updated`);
  await dbLog('margins', 'success', `${updated} records updated`);
}

/**
 * Write scrape summary to Shared_Knowledge
 */
async function writeToSharedKnowledge() {
  const summary = [
    `${results.length} variants scraped across ${new Set(results.map(r => r.channel_id)).size} channels.`,
    `${priceChanges.length} price changes detected.`,
    `${alerts.length} Buy Box alerts.`,
    `Run ID: ${RUN_ID}`,
  ].join(' ');

  const { error } = await supabase
    .from('Shared_Knowledge')
    .upsert({
      agent_name: '📊 Price Monitor',
      topic: 'pricing',
      key: `scrape_${new Date().toISOString().split('T')[0]}`,
      value: summary,
      domain: 'company',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent_name,topic,key' });

  if (error) console.log(`⚠️ Shared_Knowledge write: ${error.message}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 6: MAIN EXECUTION
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║     📊 PUZZLUP PRICE MONITOR — Playwright Scraper v1.0      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\n⏰ Started: ${new Date().toISOString()}`);

  // Step 0: Load previous prices for change detection
  const previousPrices = await loadPreviousPrices();
  console.log(`📂 Loaded ${Object.keys(previousPrices).length} previous prices for comparison`);

  // Step 1: Launch browser
  console.log('\n🚀 Launching browser...');
  const browser = await chromium.launch({
    headless: false, // Use visible browser on Tim's PC
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    // Step 2: Scrape all Amazon markets (sequential — one at a time)
    const marketOrder = [22, 23, 32, 30, 31, 27, 26, 25, 24]; // DE first (reference)
    for (const channelId of marketOrder) {
      await scrapeAmazonMarket(browser, channelId);
    }

    // Step 3: Close browser (not needed for HTTP scraping)
    await browser.close();
    console.log('\n🛑 Browser closed');

    // Step 4: Bol.com (HTTP)
    await scrapeBolcom();

    // Step 5: Webshop (HTTP)
    await scrapeWebshop();

    // Step 6: Detect changes vs previous scrape
    detectChanges(previousPrices);

    // Step 7: Write to Supabase
    await writeToSupabase();

    // Step 8: Update margins
    await updateMargins();

    // Step 9: Write to Shared_Knowledge
    await writeToSharedKnowledge();

    // Step 10: Print summary
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                        📊 SUMMARY                            ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`  Total variants scraped: ${results.length}`);
    console.log(`  Price changes: ${priceChanges.length}`);
    console.log(`  Buy Box alerts: ${alerts.length}`);
    console.log(`  Channels: ${new Set(results.map(r => r.channel_id)).size}`);
    console.log(`\n  Per channel:`);
    for (const chId of [...new Set(results.map(r => r.channel_id))].sort((a,b) => a-b)) {
      const chResults = results.filter(r => r.channel_id === chId);
      const chName = CHANNELS[chId]?.name || (chId === 33 ? 'BOL.COM' : chId === 36 ? 'WEBSHOP' : `CH${chId}`);
      console.log(`    ${chName}: ${chResults.length} variants`);
    }

    if (priceChanges.length > 0) {
      console.log('\n  Price Changes:');
      for (const pc of priceChanges) {
        const arrow = parseFloat(pc.pctChange) > 0 ? '📈' : '📉';
        console.log(`    ${arrow} ${pc.channel} ${pc.variant}: ${pc.currency} ${pc.oldPrice} → ${pc.newPrice} (${pc.pctChange}%)`);
      }
    }

    if (alerts.length > 0) {
      console.log('\n  Buy Box Alerts:');
      for (const a of alerts) {
        const icon = a.type === 'BB_LOST' ? '🔴' : a.type === 'BB_SUPPRESSED' ? '⚠️' : '🔄';
        console.log(`    ${icon} ${a.channel} ${a.variant}: ${a.type} ${a.seller || a.to || ''}`);
      }
    }

    console.log(`\n✅ Completed: ${new Date().toISOString()}`);

    // Return result for Browser_Tasks
    return {
      success: true,
      data: {
        total_scraped: results.length,
        price_changes: priceChanges.length,
        buybox_alerts: alerts.length,
        channels: new Set(results.map(r => r.channel_id)).size,
        run_id: RUN_ID,
        priceChanges: priceChanges.slice(0, 20), // Limit for Browser_Tasks result field
        alerts: alerts.slice(0, 20),
      },
    };

  } catch (err) {
    console.error(`\n❌ FATAL: ${err.message}`);
    await dbLog('fatal', 'error', err.message);
    try { await browser.close(); } catch (e) { /* already closed */ }
    return { success: false, error: err.message };
  }
}

// ── RUN ──────────────────────────────────────────────────────────────────────

main()
  .then(result => {
    console.log('\n🏁 Script finished.');
    if (result && !result.success) process.exit(1);
    process.exit(0);
  })
  .catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });

