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
const path = require('path');
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
  { name: '1500 Puzzelmat Gift',           productId: 12, url: 'https://www.bol.com/nl/nl/p/puzzlup-1500-puzzelmat-neopreen-zelfsluitend-antislip-portapuzzle-met-luxe-geschenkverpakking-voor-alle-puzzels-van-500-1000-en-1500-stukjes-66-x-120-cm/9300000045218332/' },
  { name: '1500 Puzzelmat Eco',            productId: 1,  url: 'https://www.bol.com/nl/nl/p/puzzlup-puzzelmat-1500-stukjes-eco-puzzelrol/9300000133618629/' },
  { name: '3000 Puzzelmat XXL Gift',       productId: 4,  url: 'https://www.bol.com/nl/nl/p/puzzlup-3000-xxl-puzzelmat-neopreen-zelfsluitend-en-antislip-portapuzzle-met-luxe-geschenkverpakking-voor-alle-puzzels-van-500-1000-1500-2000-en-3000-stukjes-95-x-150-cm/9300000045283847/' },
  { name: '3000 Puzzelmat XXL Eco',        productId: 5,  url: 'https://www.bol.com/nl/nl/p/puzzlup-3000-puzzelmat-xxl-formaat-neopreen-zelfsluitend-en-antislip-portapuzzle-met-zwarte-eco-verpakking-tot-en-met-3000-stukjes-95-x-150-cm/9300000117610237/' },
  { name: 'Luxe 1500 Puzzelmat',           productId: 10, url: 'https://www.bol.com/nl/nl/p/puzzlup-luxe-puzzelmat-1500-stukjes-premium-puzzelrol/9300000240566271/' },
  { name: 'Stapelbare Puzzelbakjes',       productId: 14, url: 'https://www.bol.com/nl/nl/p/puzzlup-stapelbare-puzzelbakjes-sorteerbakjes-1500-stukjes/9300000176363501/' },
  { name: 'Stapelbare Puzzelbakjes XL 3000', productId: 15, url: 'https://www.bol.com/nl/nl/p/puzzlup-stapelbare-puzzelbakjes-sorteerbakjes-xl-3000-stukjes/9300000240566990/' },
];

// ── WEBSHOP PRODUCTS ─────────────────────────────────────────────────────────

const WEBSHOP_PAGES = [
  { category: 'mats',  url: 'https://puzzlup.be/puzzle-mats/' },
  { category: 'trays', url: 'https://puzzlup.be/puzzle-trays/' },
];

// Map webshop product URLs to product IDs (more reliable than name matching)
const WEBSHOP_URL_MAP = {
  'puzzlemat-1500-eco':    { productId: 1,  name: 'Eco 1500' },
  'puzzlemat-1500-gift':   { productId: 12, name: 'Gift 1500' },
  'puzzlemat-1000-gift':   { productId: 16, name: 'Gift 1000' },
  'puzzlemat-3000-gift':   { productId: 4,  name: 'Gift 3000' },
  'puzzlemat-3000-eco':    { productId: 5,  name: 'Eco 3000' },
  'puzzlemat-1500-luxury': { productId: 10, name: 'Luxury 1500' },
  'trays-1500':            { productId: 14, name: 'Trays 1500' },
  'trays-3000':            { productId: 15, name: 'Trays 3000' },
};

// Legacy name map (fallback)
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
 * Country name mapping for Amazon's delivery location dropdown.
 * Amazon uses localized country names depending on the domain.
 */
const COUNTRY_NAMES = {
  'amazon.de':     ['Deutschland', 'Germany', 'Berlin'],
  'amazon.fr':     ['France', 'Paris'],
  'amazon.es':     ['España', 'Spain', 'Madrid'],
  'amazon.it':     ['Italia', 'Italy', 'Milano', 'Milan'],
  'amazon.com.be': ['België', 'Belgique', 'Belgium', 'Bruxelles', 'Brussel', 'Brussels'],
  'amazon.nl':     ['Nederland', 'Netherlands', 'Amsterdam'],
  'amazon.com':    ['United States', 'New York', 'NYC'],
  'amazon.ca':     ['Canada', 'Toronto'],
  'amazon.co.uk':  ['United Kingdom', 'London'],
};

/**
 * Set delivery location on Amazon.
 * 
 * EXACT FLOW (based on Amazon DE popup screenshot):
 *   1. Click "Liefern nach [country]" link (top-left header)
 *   2. Popup appears: "Wähle deinen Standort aus"
 *   3. Fill LOCAL postal code into input field
 *   4. Click "Bestätigen" / "Apply" / "Appliquer"
 *   5. Wait for page to update
 *   6. Click "Fertig" / "Done" / "Terminé" if visible
 *   7. Reload page to lock in new location cookies
 *   8. Verify header shows correct postal code (not "Belgien")
 * 
 * For NON-LOCAL delivery (e.g. delivering to France while on amazon.de),
 * use the "Zustellung außerhalb" dropdown instead.
 * But typically we scrape each domain with its LOCAL postal code.
 */
async function setDeliveryLocation(page, channel, channelId) {
  console.log(`  📍 Setting delivery to ${channel.country} — ${channel.postalCode}`);
  await dbLog(`location-${channel.name}`, 'info', `Setting: ${channel.country} ${channel.postalCode}`);

  // ─── Helper: check if delivery location is correct ───
  // Strategy: "Not the WRONG country" rather than "exact postal code"
  // If persistent context already has a valid local address, accept it.
  //
  // WRONG countries = any country that isn't this market's country.
  // We maintain a blocklist per domain of strings that indicate WRONG location.
  const WRONG_LOCATION_STRINGS = {
    'amazon.de':     ['belgi', 'france', 'españa', 'italia', 'nederland', 'united states', 'canada', 'united kingdom', 'london', 'paris', 'madrid', 'milan', 'amsterdam', 'toronto', 'nyc'],
    'amazon.fr':     ['belgi', 'deutschland', 'germany', 'españa', 'italia', 'nederland', 'united states', 'canada', 'united kingdom', 'london', 'berlin', 'madrid', 'milan', 'amsterdam', 'toronto', 'nyc'],
    'amazon.es':     ['belgi', 'deutschland', 'germany', 'france', 'italia', 'nederland', 'united states', 'canada', 'united kingdom', 'london', 'paris', 'berlin', 'milan', 'amsterdam', 'toronto', 'nyc'],
    'amazon.it':     ['belgi', 'deutschland', 'germany', 'france', 'españa', 'nederland', 'united states', 'canada', 'united kingdom', 'london', 'paris', 'berlin', 'madrid', 'amsterdam', 'toronto', 'nyc'],
    'amazon.com.be': ['deutschland', 'germany', 'france', 'españa', 'italia', 'nederland', 'united states', 'canada', 'united kingdom', 'london', 'paris', 'berlin', 'madrid', 'milan', 'amsterdam', 'toronto', 'nyc'],
    'amazon.nl':     ['belgi', 'deutschland', 'germany', 'france', 'españa', 'italia', 'united states', 'canada', 'united kingdom', 'london', 'paris', 'berlin', 'madrid', 'milan', 'toronto', 'nyc'],
    'amazon.com':    ['belgi', 'deutschland', 'germany', 'france', 'españa', 'italia', 'nederland', 'canada', 'united kingdom', 'london', 'paris', 'berlin', 'madrid', 'milan', 'amsterdam', 'toronto'],
    'amazon.ca':     ['belgi', 'deutschland', 'germany', 'france', 'españa', 'italia', 'nederland', 'united states', 'united kingdom', 'london', 'paris', 'berlin', 'madrid', 'milan', 'amsterdam', 'nyc', 'new york'],
    'amazon.co.uk':  ['belgi', 'deutschland', 'germany', 'france', 'españa', 'italia', 'nederland', 'united states', 'canada', 'paris', 'berlin', 'madrid', 'milan', 'amsterdam', 'toronto', 'nyc', 'new york'],
  };

  // "Update location" in all Amazon languages
  const UPDATE_LOCATION_PHRASES = [
    'update location', 'standort aktualisieren', 'aktualisieren',
    'locatie bijwerken', 'bijwerken', 'mettre à jour', 'actualiser',
    'actualizar ubicación', 'actualizar', 'aggiorna la posizione', 'aggiorna',
    'update je locatie', 'wijzig', 'modifier'
  ];

  function isUpdateLocationText(text) {
    const lower = text.toLowerCase();
    return UPDATE_LOCATION_PHRASES.some(phrase => lower.includes(phrase));
  }

  async function isLocationCorrect() {
    try {
      // Read both lines
      let line1Text = '', line2Text = '';
      try { line1Text = (await page.locator('#glow-ingress-line1').textContent({ timeout: 5000 })).trim(); } catch(e) {}
      try { line2Text = (await page.locator('#glow-ingress-line2').textContent({ timeout: 5000 })).trim(); } catch(e) {}
      
      console.log(`  📍 Location header — Line1: "${line1Text}" | Line2: "${line2Text}"`);
      
      // Combine both lines for checking
      const combined = `${line1Text} ${line2Text}`.toLowerCase();
      
      // If both empty, no location set
      if (!line1Text && !line2Text) {
        return { ok: false, header: '', reason: 'No location set (both lines empty)' };
      }
      
      // Check line2 first — this usually has the actual address (e.g. "Duffel 2570", "10115", "London")
      if (line2Text && !isUpdateLocationText(line2Text)) {
        // Line2 has actual text — check it's not a wrong country
        const wrongStrings = WRONG_LOCATION_STRINGS[channel.domain] || [];
        const isWrong = wrongStrings.some(w => line2Text.toLowerCase().includes(w));
        if (!isWrong) {
          console.log(`  ✅ Location OK: "${line2Text}" (not a wrong country)`);
          return { ok: true, header: line2Text };
        } else {
          const match = wrongStrings.find(w => line2Text.toLowerCase().includes(w));
          return { ok: false, header: line2Text, reason: `Wrong location in line2: "${match}" in "${line2Text}"` };
        }
      }
      
      // Line2 is "Update location" or equivalent — check line1 for actual address info
      // Line1 often shows "Deliver to Tim" or "Bestemming: Tim" or "Livrer à Balzac T4B 2T"
      if (line1Text) {
        // Strip common prefixes to get the location part
        const stripped = line1Text
          .replace(/^(deliver(ing)?\s+to|bestemming:?|livrer\s+à|liefern\s+nach|entregar\s+a|consegna\s+a)\s*/i, '')
          .trim();
        
        if (stripped && stripped.length > 1) {
          const wrongStrings = WRONG_LOCATION_STRINGS[channel.domain] || [];
          const isWrong = wrongStrings.some(w => stripped.toLowerCase().includes(w));
          if (!isWrong) {
            console.log(`  ✅ Location OK via line1: "${line1Text}" → "${stripped}" (not a wrong country)`);
            return { ok: true, header: stripped };
          } else {
            const match = wrongStrings.find(w => stripped.toLowerCase().includes(w));
            return { ok: false, header: stripped, reason: `Wrong location in line1: "${match}" in "${line1Text}"` };
          }
        }
      }
      
      // Last resort: read the FULL location widget container for any location clues
      try {
        const fullWidget = await page.locator('#nav-global-location-popover-link').textContent({ timeout: 3000 });
        const widgetText = (fullWidget || '').replace(/\s+/g, ' ').trim();
        console.log(`  📍 Full widget text: "${widgetText}"`);
        
        if (widgetText && widgetText.length > 5) {
          const widgetLower = widgetText.toLowerCase();
          const wrongStrings = WRONG_LOCATION_STRINGS[channel.domain] || [];
          const isWrong = wrongStrings.some(w => widgetLower.includes(w));
          if (!isWrong) {
            console.log(`  ✅ Location OK via full widget: "${widgetText}" (not a wrong country)`);
            return { ok: true, header: widgetText };
          } else {
            const match = wrongStrings.find(w => widgetLower.includes(w));
            return { ok: false, header: widgetText, reason: `Wrong location in widget: "${match}" in "${widgetText}"` };
          }
        }
      } catch (e) { /* widget read failed */ }
      
      return { ok: false, header: `${line1Text} | ${line2Text}`, reason: 'No recognizable location found' };
    } catch (e) {
      return { ok: false, header: null, reason: e.message };
    }
  }

  // ─── Helper: attempt the popup flow once ───
  async function attemptPopupFlow() {
    // Click delivery location link (top-left)
    console.log(`  📍 Clicking delivery location link...`);
    const locationLink = page.locator('#nav-global-location-popover-link');
    await locationLink.waitFor({ state: 'visible', timeout: 5000 });
    await locationLink.click();
    await page.waitForTimeout(2500);

    // Wait for popup to appear
    const popupVisible = await page.locator('#GLUXZipUpdateInput').isVisible({ timeout: 5000 }).catch(() => false);
    if (!popupVisible) {
      await page.waitForTimeout(2000);
      const anyInput = page.locator('.a-popover-wrapper input[type="text"], .a-popover-wrapper input:not([type])').first();
      if (!await anyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        throw new Error('No postal code input found in popup');
      }
    }

    // Clear and fill postal code
    console.log(`  📍 Entering postal code "${channel.postalCode}"...`);
    const zipInput = page.locator('#GLUXZipUpdateInput').or(
      page.locator('.a-popover-wrapper input[type="text"]').first()
    );
    await zipInput.click({ clickCount: 3 });
    await page.waitForTimeout(300);
    await zipInput.fill('');
    await page.waitForTimeout(300);
    await zipInput.fill(channel.postalCode);
    await page.waitForTimeout(500);

    // Click "Bestätigen" / "Apply"
    console.log(`  📍 Clicking confirm...`);
    const confirmBtn = page.locator(
      '#GLUXZipUpdate, ' +
      'input[aria-labelledby="GLUXZipUpdate-announce"], ' +
      '.a-popover-wrapper input[type="submit"], ' +
      'span:has-text("Bestätigen"), span:has-text("Apply"), ' +
      'span:has-text("Appliquer"), span:has-text("Aplicar"), ' +
      'span:has-text("Applica"), span:has-text("Toepassen")'
    );
    await confirmBtn.first().click({ timeout: 5000 });
    await page.waitForTimeout(3000);

    // Click "Fertig" / "Done" if visible
    const doneBtn = page.locator(
      '#GLUXConfirmClose, button.a-button-close, ' +
      'button:has-text("Fertig"), button:has-text("Done"), ' +
      'button:has-text("Terminé"), button:has-text("Hecho"), ' +
      'button:has-text("Fine"), button:has-text("Klaar"), ' +
      '.a-popover-footer button'
    );
    if (await doneBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await doneBtn.first().click();
      await page.waitForTimeout(2000);
    }

    // Reload to lock in cookies
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN FLOW: Pre-check → Attempt (with retry) → Hard verify
  // ═══════════════════════════════════════════════════════════

  // Pre-check: already correct?
  const preCheck = await isLocationCorrect();
  if (preCheck.ok) {
    console.log(`  ✅ Delivery already correct: "${preCheck.header}" — skipping popup!`);
    await dbLog(`location-${channel.name}`, 'success', `Already set: ${preCheck.header}`);
    return true;
  }
  console.log(`  📍 Current: "${preCheck.header}" — needs change`);

  // Attempt 1
  try {
    console.log(`  📍 Attempt 1/2...`);
    await attemptPopupFlow();

    const check1 = await isLocationCorrect();
    if (check1.ok) {
      console.log(`  ✅ VERIFIED on attempt 1: "${check1.header}"`);
      await dbLog(`location-${channel.name}`, 'success', `Verified: ${check1.header}`);
      return true;
    }
    console.log(`  ⚠️ Attempt 1 failed: ${check1.reason}`);
  } catch (e) {
    console.log(`  ⚠️ Attempt 1 error: ${e.message}`);
  }

  // Attempt 2 (retry)
  try {
    console.log(`  📍 Attempt 2/2 (retry)...`);
    // Navigate to fresh product page first
    const firstVariant = AMAZON_PRODUCTS[channelId]?.variants?.[0];
    if (firstVariant) {
      await page.goto(`https://www.${channel.domain}/dp/${firstVariant.asin}?th=1`, { 
        waitUntil: 'domcontentloaded', timeout: 20000 
      });
      await page.waitForTimeout(3000);
    }
    await attemptPopupFlow();

    const check2 = await isLocationCorrect();
    if (check2.ok) {
      console.log(`  ✅ VERIFIED on attempt 2: "${check2.header}"`);
      await dbLog(`location-${channel.name}`, 'success', `Verified retry: ${check2.header}`);
      return true;
    }
    console.log(`  ❌ Attempt 2 failed: ${check2.reason}`);
  } catch (e) {
    console.log(`  ❌ Attempt 2 error: ${e.message}`);
  }

  // HARD FAIL — could not set postal code
  console.log(`  🚫 HARD FAIL: Could NOT verify delivery location for ${channel.name}!`);
  console.log(`  🚫 SKIPPING this market to avoid incorrect prices.`);
  await dbLog(`location-${channel.name}`, 'CRITICAL', `HARD FAIL: Could not set ${channel.postalCode} — market SKIPPED`);
  return false;
}

/**
 * Parse a price string like "€34,95", "$69.95", "£79.95", "C$136.23"
 * Returns a float or null.
 */
function detectCurrency(rawPrice, fallback) {
  if (!rawPrice) return fallback;
  // Collapse newlines for matching (UK shows "EUR44\n.\n77")
  const normalized = rawPrice.replace(/[\r\n]+/g, ' ');
  if (normalized.includes('C$') || normalized.includes('CA$')) return 'CAD';
  if (normalized.includes('£') || /\bGBP/i.test(normalized)) return 'GBP';
  if (normalized.includes('€') || /\bEUR/i.test(normalized)) return 'EUR';
  // "$" is ambiguous: USD on .com, CAD on .ca — use fallback to distinguish
  if (normalized.includes('$') || /\bUSD/i.test(normalized)) {
    return fallback === 'CAD' ? 'CAD' : 'USD';
  }
  return fallback;
}

function parsePrice(priceStr) {
  if (!priceStr) return null;
  // Collapse newlines/whitespace (Amazon UK splits "EUR44\n.\n77")
  let cleaned = priceStr.replace(/[\r\n]+/g, '').replace(/\s+/g, ' ').trim();
  // Remove currency TEXT labels (EUR, GBP, USD, CAD) AND symbols (€, $, £)
  cleaned = cleaned.replace(/(EUR|GBP|USD|CAD|CA\$)/gi, '');
  cleaned = cleaned.replace(/[€$£]/g, '').trim();
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
  // Selectors in order of reliability
  const selectors = [
    '.priceToPay .a-offscreen',
    '#corePrice_feature_div .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-offscreen',
    '.reinventPricePriceToPayMargin .priceToPay .a-offscreen',
    '.a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-color-price',
    '#price_inside_buybox',
    '#newBuyBoxPrice',
    '#apex_offerDisplay_desktop .a-offscreen',
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

  // Fallback 1: try .a-offscreen textContent (may be hidden but present in DOM)
  try {
    const allOffscreen = await page.locator('.a-price .a-offscreen').allTextContents();
    for (const text of allOffscreen) {
      const price = parsePrice(text);
      if (price && price > 5 && price < 9999) {
        return { price, raw: text.trim() };
      }
    }
  } catch (e) { /* no price found */ }

  // Fallback 2: try innerText of .a-price (visible price without .a-offscreen)
  try {
    const priceElem = page.locator('.a-price').first();
    if (await priceElem.isVisible({ timeout: 1000 })) {
      const text = await priceElem.innerText();
      const price = parsePrice(text);
      if (price && price > 0 && price < 9999) {
        return { price, raw: text.trim() };
      }
    }
  } catch (e) { /* no price found */ }

  // Fallback 3: regex search in page content for price patterns
  try {
    const bodyText = await page.locator('#centerCol').innerText();
    const priceMatch = bodyText.match(/[€£$]\s*(\d{1,3}[.,]\d{2})/);
    if (priceMatch) {
      const price = parsePrice(priceMatch[0]);
      if (price && price > 5 && price < 9999) {
        console.log(`    🔍 Price found via regex fallback: ${priceMatch[0]}`);
        return { price, raw: priceMatch[0] };
      }
    }
  } catch (e) { /* no price found */ }

  // DEBUG: Log what we see so we can fix next time
  try {
    const debugSelectors = ['.priceToPay', '.a-price', '#corePrice_feature_div', '#corePriceDisplay_desktop_feature_div', '#apex_offerDisplay_desktop'];
    for (const sel of debugSelectors) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        const text = await page.locator(sel).first().innerText().catch(() => '(error)');
        console.log(`    🐛 DEBUG ${sel}: count=${count}, text="${text?.substring(0, 80)}"`);
      }
    }
  } catch (e) { /* debug only */ }

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
    // Multi-language "Sold by" selectors
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Sold by"] a',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Sold by"] span',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Vendu par"] a',        // FR
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Vendu par"] span',     // FR
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Verkauft von"] a',     // DE
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Verkauft von"] span',  // DE
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Verkocht door"] a',    // NL
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Verkocht door"] span', // NL
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Vendido por"] a',      // ES
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Vendido por"] span',   // ES
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Venduto da"] a',       // IT
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Venduto da"] span',    // IT
    // Fallback: any seller link in tabular buybox
    '#tabular-buybox a[role="link"]',
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

// clickVariant() REMOVED — replaced by ASIN-first navigation (direct /dp/{ASIN} per variant)

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

  // Detect actual currency from price text (Tim's account shows EUR everywhere)
  const detectedCurrency = detectCurrency(raw, channel.currency);
  if (detectedCurrency !== channel.currency) {
    console.log(`    ⚠️ Currency mismatch: expected ${channel.currency}, page shows ${detectedCurrency}`);
  }

  const result = {
    product_id: variant.productId,
    channel_id: channelId,
    variant_name: variant.name,
    fba_price: price,
    currency: detectedCurrency,
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
      currency: detectedCurrency,
    });
  } else if (buyboxSeller === 'SUPPRESSED') {
    alerts.push({
      type: 'BB_SUPPRESSED',
      channel: channel.name,
      variant: variant.name,
      price: price,
      currency: detectedCurrency,
    });
  }

  console.log(`    ✅ ${variant.name}: ${raw || 'NO PRICE'} | BB: ${buyboxSeller} | ★${rating || '-'} | ${inStock ? 'In Stock' : 'OOS'}`);
  return result;
}

/**
 * Scrape one Amazon market — ASIN-FIRST navigation.
 * Each variant is loaded directly via /dp/{ASIN} — no variant clicking needed.
 * This is 100% reliable and faster than twister clicking.
 */
async function scrapeAmazonMarket(browser, channelId) {
  const channel = CHANNELS[channelId];
  const products = AMAZON_PRODUCTS[channelId];
  if (!products) return;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🌍 SCRAPING ${channel.name} (${channel.domain})`);
  console.log(`${'═'.repeat(60)}`);
  await dbLog(`market-${channelId}`, 'info', `Starting ${channel.name}`);

  // Use the shared persistent context (cookies persist between runs!)
  const context = browser; // browser IS the persistent context
  const page = await context.newPage();

  try {
    // Step 1: Navigate to FIRST variant to set up cookies & delivery location
    const firstVariant = products.variants[0];
    const firstUrl = `https://www.${channel.domain}/dp/${firstVariant.asin}?th=1`;
    console.log(`  📄 Opening ${channel.domain} via: ${firstUrl}`);
    await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Step 2: Accept cookies
    await acceptCookies(page, channel.locale);

    // Step 3: Set delivery location (COUNTRY + postal code) — HARD GATE
    const locationOk = await setDeliveryLocation(page, channel, channelId);
    if (!locationOk) {
      console.log(`  🚫 SKIPPING ${channel.name} — delivery location NOT verified!`);
      console.log(`  🚫 Prices would be wrong without correct local delivery.`);
      await dbLog(`market-${channelId}`, 'SKIPPED', `Delivery location failed — market skipped entirely`);
      return; // EXIT — do NOT scrape this market
    }

    // Step 4: Scrape ALL mat variants via direct ASIN navigation
    const allVariants = [...products.variants, ...(products.trays || [])];
    console.log(`\n  📦 Scraping ${allVariants.length} variants via direct ASIN navigation...`);

    for (let i = 0; i < allVariants.length; i++) {
      const variant = allVariants[i];
      if (shouldSkipVariant(variant.name)) {
        console.log(`    ⏭️ SKIP (discontinued): ${variant.name}`);
        continue;
      }

      // Navigate directly to this variant's ASIN
      const variantUrl = `https://www.${channel.domain}/dp/${variant.asin}?th=1`;
      console.log(`    → [${i + 1}/${allVariants.length}] ${variant.name} → /dp/${variant.asin}`);
      await page.goto(variantUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2500);

      const data = await scrapeCurrentVariant(page, channelId, variant, channel);
      if (data) results.push(data);
    }

    // CA has separate ASIN listings for trays (no traysUrl, already in allVariants above)
    // Other markets: trays are in products.trays[] with their own ASINs — already handled above

    // All variants (mats + trays) already scraped via ASIN-first loop above

    await dbLog(`market-${channelId}`, 'success', `Done: ${results.filter(r => r.channel_id === channelId).length} variants scraped`);

  } catch (err) {
    console.log(`  ❌ Market error: ${err.message}`);
    await dbLog(`market-${channelId}`, 'error', err.message);
  } finally {
    await page.close(); // Close page only — context is shared & persistent
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

      // Check stock — positive signal "Op voorraad" is definitive
      // "Niet leverbaar" / "Uitverkocht" can appear elsewhere in the HTML, so use positive matching
      const hasOpVoorraad = /op\s*voorraad/i.test(html);
      const hasNietLeverbaar = html.includes('Niet leverbaar') || html.includes('Uitverkocht');
      const inStock = hasOpVoorraad ? true : !hasNietLeverbaar;

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
        buybox_seller: /verkoop\s+door\s+qualico/i.test(html) ? 'Qualico NL (D2C)' : 'D2C',
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-GB,en;q=0.9,nl;q=0.8',
        },
      });

      if (!response.ok) {
        console.log(`    ❌ HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();

      // puzzlup.be uses JetWooBuilder — split by jet-woo-products__item blocks
      const blocks = html.split(/jet-woo-products__item\b/).slice(1);
      console.log(`    Found ${blocks.length} product blocks`);

      for (const block of blocks) {
        // 1. Extract product URL (most reliable identifier)
        const urlMatch = block.match(/href="https:\/\/puzzlup\.be\/product\/([^"\/]+)\/?"/);
        if (!urlMatch) continue;
        const urlSlug = urlMatch[1];
        const productUrl = `https://puzzlup.be/product/${urlSlug}/`;

        // 2. Match URL slug to known product
        let mapped = WEBSHOP_URL_MAP[urlSlug];
        
        // Fallback: try name matching
        if (!mapped) {
          const titleMatch = block.match(/product(?:__|-)title[^>]*>([^<]+)/);
          if (titleMatch) {
            const rawName = titleMatch[1].replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim().toLowerCase();
            for (const [key, val] of Object.entries(WEBSHOP_PRODUCT_MAP)) {
              if (rawName.includes(key)) {
                mapped = val;
                break;
              }
            }
          }
        }

        if (!mapped) {
          console.log(`    ⚠️ Unknown webshop product: "${urlSlug}" — skipping`);
          continue;
        }

        // 3. Extract price — pattern: €</span> followed by digits, or amount class with digits
        let price = null;
        const priceMatch = block.match(/(?:€|&euro;)\s*<\/span>\s*([0-9]+[,.]?[0-9]*)/);
        if (priceMatch) {
          price = parsePrice(priceMatch[1]);
        } else {
          const amountMatch = block.match(/amount[^>]*>(?:<[^>]+>)*\s*([0-9]+[,.]?[0-9]*)/);
          if (amountMatch) {
            price = parsePrice(amountMatch[1]);
          }
        }

        if (!price) {
          console.log(`    ⚠️ ${mapped.name}: no price found — skipping`);
          continue;
        }

        // Avoid duplicates (same product can appear in multiple blocks)
        if (results.some(r => r.channel_id === 36 && r.product_id === mapped.productId)) {
          continue;
        }

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
          listing_url: productUrl,
          asin: null,
          last_updated: new Date().toISOString(),
        });

        console.log(`    ✅ ${mapped.name}: €${price}`);
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
// ══════════════════════════════════════════════════════════════════════════════
// PART 5.5: LIVE EXCHANGE RATE CONVERSION (EUR → GBP/USD/CAD)
// Belgian Amazon account shows ALL prices in EUR. For UK/US/CA we need local currency.
// Uses ECB rates via frankfurter.app (free, no API key).
// ══════════════════════════════════════════════════════════════════════════════

// Which channels need EUR → local currency conversion
const CURRENCY_CONVERSION = {
  32: 'GBP',  // UK
  30: 'USD',  // US
  31: 'CAD',  // CA
};

async function fetchExchangeRates() {
  console.log('\n💱 Fetching live ECB exchange rates...');
  try {
    const resp = await fetch('https://api.frankfurter.app/latest?from=EUR&to=GBP,USD,CAD');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    console.log(`  ✅ Rates (${data.date}): 1 EUR = ${data.rates.GBP} GBP | ${data.rates.USD} USD | ${data.rates.CAD} CAD`);
    return data.rates; // { GBP: 0.85, USD: 1.08, CAD: 1.47 }
  } catch (err) {
    console.log(`  ⚠️ Exchange rate API failed: ${err.message}`);
    console.log('  ⚠️ Using fallback rates (may be slightly off)');
    return { GBP: 0.86, USD: 1.08, CAD: 1.50 }; // Conservative fallback
  }
}

async function convertToLocalCurrency(rates) {
  let converted = 0;
  for (const result of results) {
    const targetCurrency = CURRENCY_CONVERSION[result.channel_id];
    if (!targetCurrency) continue; // EUR market — no conversion needed
    
    if (result.currency === 'EUR' && result.fba_price) {
      const rate = rates[targetCurrency];
      const eurPrice = result.fba_price;
      const localPrice = Math.round(eurPrice * rate * 100) / 100; // Round to 2 decimals
      console.log(`  💱 ${CHANNELS[result.channel_id]?.name} ${result.variant_name}: €${eurPrice} × ${rate} = ${targetCurrency} ${localPrice}`);
      result.fba_price = localPrice;
      result.currency = targetCurrency;
      converted++;
    } else if (result.currency === targetCurrency) {
      // Already in local currency (rare — page showed local price)
      console.log(`  ✅ ${CHANNELS[result.channel_id]?.name} ${result.variant_name}: already ${targetCurrency} ${result.fba_price}`);
    }
  }
  console.log(`  💱 Converted ${converted} prices from EUR to local currency`);
}

async function writeToSupabase() {
  // Filter out records with null prices (would violate NOT NULL constraint)
  const validResults = results.filter(r => r.fba_price !== null && r.fba_price !== undefined);
  const skipped = results.length - validResults.length;
  
  if (skipped > 0) {
    console.log(`\n⚠️ Skipping ${skipped} records with null prices`);
    await dbLog('db-write', 'warn', `${skipped} records have null prices — skipped`);
  }

  console.log(`\n💾 Writing ${validResults.length} records to Supabase...`);
  await dbLog('db-write', 'info', `Upserting ${validResults.length} records (${skipped} skipped — null price)`);

  if (validResults.length === 0) {
    console.log(`⚠️ No valid records to write`);
    return;
  }

  // Batch upsert
  const { error } = await supabase
    .from('amazon_monitor_fba_puzzlup')
    .upsert(validResults, {
      onConflict: 'product_id,channel_id',
    });

  if (error) {
    console.log(`❌ Supabase upsert failed: ${error.message}`);
    await dbLog('db-write', 'error', error.message);
  } else {
    console.log(`✅ ${validResults.length} records upserted`);
    await dbLog('db-write', 'success', `${validResults.length} records`);
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

  // Step 1: Launch browser with PERSISTENT context (saves cookies between runs!)
  // This means: login once → stays logged in. Delivery location set once → persists.
  const userDataDir = path.join(__dirname, '.browser-data');
  console.log(`\n🚀 Launching browser (persistent context: ${userDataDir})...`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // Use visible browser on Tim's PC
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  try {
    // Step 2: Scrape all Amazon markets (sequential — one at a time)
    // All markets use persistent context (logged in). UK/US/CA will show EUR prices
    // because of Belgian account — these get converted to local currency in Step 6.
    const marketOrder = [22, 23, 32, 30, 31, 27, 26, 25, 24]; // DE first (reference)
    for (const channelId of marketOrder) {
      await scrapeAmazonMarket(context, channelId);
    }

    // Step 3: Close browser
    await context.close();
    console.log('\n🛑 Browser closed');

    // Step 4: Bol.com (HTTP)
    await scrapeBolcom();

    // Step 5: Webshop (HTTP)
    await scrapeWebshop();

    // Step 5.5: Convert EUR → local currency for UK/US/CA
    const exchangeRates = await fetchExchangeRates();
    await convertToLocalCurrency(exchangeRates);

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

