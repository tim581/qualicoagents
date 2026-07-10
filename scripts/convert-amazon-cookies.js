/**
 * convert-amazon-cookies.js — merge Cookie-Editor exports → Playwright storage state
 *
 * Inputs (repo root):
 *   amazon-cookies-raw.json      — EU sellercentral.amazon.co.uk session (optional if DE present)
 *   amazon-cookies-de-raw.json   — DE sellercentral.amazon.de session (optional)
 *   amazon-cookies-na-raw.json   — NA sellercentral.amazon.com session (optional)
 *   amazon-cookies-ca-raw.json   — CA sellercentral.amazon.ca session (optional)
 *   amazon-cookies-ads-raw.json  — advertising.amazon.com session (optional)
 *
 * Output:
 *   scripts/amazon-storage-state.json
 *
 * Usage: node scripts/convert-amazon-cookies.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { mergeCookieLists, loadJsonCookies } = require('./cookie-integrate-shared');

const ROOT = path.join(__dirname, '..');

const AMAZON_RAW_FILES = {
  eu: { id: 'eu', label: 'UK/EU', file: path.join(ROOT, 'amazon-cookies-raw.json') },
  de: { id: 'de', label: 'DE', file: path.join(ROOT, 'amazon-cookies-de-raw.json') },
  na: { id: 'na', label: 'NA', file: path.join(ROOT, 'amazon-cookies-na-raw.json') },
  ca: { id: 'ca', label: 'CA', file: path.join(ROOT, 'amazon-cookies-ca-raw.json') },
  ads: { id: 'ads', label: 'Ads', file: path.join(ROOT, 'amazon-cookies-ads-raw.json') },
};

/** Legacy UK-only export file — merged into EU bucket on read; new pastes go to amazon-cookies-raw.json */
const AMAZON_UK_LEGACY_RAW = path.join(ROOT, 'amazon-cookies-uk-raw.json');

const OUT = path.join(__dirname, 'amazon-storage-state.json');

function toPlaywrightCookie(c) {
  const sameSiteMap = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };
  let sameSite = 'Lax';
  if (c.sameSite != null) {
    const key = String(c.sameSite).toLowerCase();
    sameSite = sameSiteMap[key] || (key === 'null' ? 'Lax' : 'Lax');
  }
  const expires = c.expirationDate ?? c.expires;
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.session ? -1 : Math.floor(Number(expires) || 0),
    httpOnly: !!c.httpOnly,
    secure: c.secure !== false,
    sameSite,
  };
}

/** Route a Cookie-Editor cookie to a marketplace bucket id. */
function routeAmazonCookie(cookie) {
  const d = String(cookie.domain || '').toLowerCase();
  if (!d.includes('amazon') && !d.includes('sellercentral')) return null;

  // Advertising (all regional TLDs: advertising.amazon.com, .de, .co.uk, etc.)
  if (d.includes('advertising.amazon')) return 'ads';

  // Germany
  if (d.includes('amazon.de') || d.includes('sellercentral.amazon.de')) return 'de';

  // Canada
  if (d.includes('amazon.ca') || d.includes('sellercentral.amazon.ca')) return 'ca';

  // United States + Mexico + Brazil (NA seller central cluster)
  if (d.includes('amazon.com.mx') || d.includes('sellercentral.amazon.com.mx')) return 'na';
  if (d.includes('amazon.com.br') || d.includes('sellercentral.amazon.com.br')) return 'na';
  if (
    d.endsWith('amazon.com') ||
    d.endsWith('.amazon.com') ||
    d === 'amazon.com' ||
    (d.includes('sellercentral.amazon.com') && !d.includes('.com.mx') && !d.includes('.com.br'))
  ) {
    return 'na';
  }

  // UK + EU retail + seller central (FR, IT, ES, NL, BE, PL, SE, IE, TR, EU portal)
  if (
    /amazon\.(co\.uk|fr|it|es|nl|com\.be|pl|se|ie|com\.tr|eu)/.test(d) ||
    /sellercentral\.amazon\.(co\.uk|fr|it|es|nl|com\.be|pl|se|ie|com\.tr|eu)/.test(d)
  ) {
    return 'eu';
  }

  // APAC + MENA + other Amazon TLDs (merged into EU bucket for shared SSO)
  if (
    /amazon\.(co\.jp|com\.au|in|sg|ae|sa|eg|com\.mx|com\.br)/.test(d) ||
    /sellercentral\.amazon\.(co\.jp|com\.au|in|sg|ae|sa|eg)/.test(d)
  ) {
    return 'eu';
  }

  // Generic sellercentral fallback (non-US/DE/CA portals)
  if (d.includes('sellercentral.amazon.')) return 'eu';

  // Remaining amazon.* domains (vendorcentral, brandregistry, etc.)
  if (d.includes('amazon.')) return 'eu';

  return null;
}

function routeAmazonCookies(cookies) {
  const buckets = { eu: [], de: [], na: [], ca: [], ads: [], unclassified: [] };
  for (const c of cookies) {
    const bucket = routeAmazonCookie(c);
    if (bucket) buckets[bucket].push(c);
    else buckets.unclassified.push(c);
  }
  return buckets;
}

function loadRawBucket(bucketId) {
  const meta = AMAZON_RAW_FILES[bucketId];
  if (!meta) return [];

  const sources = [];
  // Legacy UK file feeds EU bucket only (merged first so amazon-cookies-raw.json wins on conflicts)
  if (bucketId === 'eu' && fs.existsSync(AMAZON_UK_LEGACY_RAW)) {
    sources.push(loadJsonCookies(AMAZON_UK_LEGACY_RAW));
  }
  if (fs.existsSync(meta.file)) sources.push(loadJsonCookies(meta.file));
  if (sources.length === 0) return [];
  return mergeCookieLists(sources).map(toPlaywrightCookie);
}

function mergeAllAmazonCookies() {
  const eu = loadRawBucket('eu');
  const de = loadRawBucket('de');
  const na = loadRawBucket('na');
  const ca = loadRawBucket('ca');
  const ads = loadRawBucket('ads');

  if (eu.length === 0 && de.length === 0 && na.length === 0 && ca.length === 0 && ads.length === 0) {
    throw new Error(
      'No cookie files found. Add at least one of: amazon-cookies-raw.json (UK/EU), ' +
        'amazon-cookies-de-raw.json, amazon-cookies-na-raw.json, amazon-cookies-ca-raw.json, amazon-cookies-ads-raw.json',
    );
  }

  const cookies = mergeCookieLists([eu, de, na, ca, ads]);
  if (cookies.length === 0) {
    throw new Error('No valid cookies found after conversion (name/domain/value required).');
  }

  fs.writeFileSync(OUT, JSON.stringify({ cookies, origins: [] }, null, 2));

  return {
    out: OUT,
    total: cookies.length,
    counts: { eu: eu.length, de: de.length, na: na.length, ca: ca.length, ads: ads.length },
    marketplaces: Object.entries({ eu, de, na, ca, ads })
      .filter(([, list]) => list.length > 0)
      .map(([id]) => AMAZON_RAW_FILES[id].label),
  };
}

function main() {
  const result = mergeAllAmazonCookies();
  const { counts } = result;
  console.log(
    `Wrote ${OUT} (${result.total} cookies: UK/EU=${counts.eu}, DE=${counts.de}, ` +
      `NA=${counts.na}, CA=${counts.ca}, Ads=${counts.ads})`,
  );
  require('child_process').execSync('node sync-storage-state-copies.js', {
    cwd: __dirname,
    stdio: 'inherit',
  });
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = {
  AMAZON_RAW_FILES,
  AMAZON_UK_LEGACY_RAW,
  OUT,
  toPlaywrightCookie,
  routeAmazonCookie,
  routeAmazonCookies,
  mergeAllAmazonCookies,
};
