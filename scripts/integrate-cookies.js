#!/usr/bin/env node
'use strict';

/**
 * integrate-cookies.js — universal cookie paste entry point
 *
 * Auto-detects platform(s) from cookie domains and delegates to platform integrators.
 * One paste can update Amazon + Bol + Sellerboard etc. if domains span multiple services.
 *
 * Usage:
 *   node scripts/integrate-cookies.js < cookies.json
 *   node scripts/integrate-cookies.js cookies.json
 *   npm run cookies -- < cookies.json
 */

const { readCookieInput, runSyncStorageStateCopies } = require('./cookie-integrate-shared');
const { routeAmazonCookie } = require('./convert-amazon-cookies');
const { integrateAmazonCookies, printSummary: printAmazonSummary } = require('./integrate-amazon-cookies');
const { integrateBolCookies, printSummary: printBolSummary } = require('./integrate-bol-cookies');
const { integrateSellerboardCookies } = require('./integrate-sellerboard-cookies');
const { integrateFlieberCookies } = require('./integrate-flieber-cookies');
const { integrateStaxxerCookies } = require('./integrate-staxxer-cookies');
const { integrateMintsoftCookies } = require('./integrate-mintsoft-cookies');
const { integrateForcegetCookies } = require('./integrate-forceget-cookies');
const { integrateCoraxCookies } = require('./integrate-corax-cookies');
const { printStorageStateSummary } = require('./cookie-integrate-shared');

const PLATFORMS = [
  {
    id: 'amazon',
    label: 'Amazon',
    test: (c) => !!routeAmazonCookie(c),
    integrate: integrateAmazonCookies,
    print: printAmazonSummary,
  },
  {
    id: 'bol',
    label: 'Bol.com',
    test: (c) => String(c.domain || '').toLowerCase().includes('bol.com'),
    integrate: integrateBolCookies,
    print: printBolSummary,
  },
  {
    id: 'sellerboard',
    label: 'Sellerboard',
    test: (c) => String(c.domain || '').toLowerCase().includes('sellerboard'),
    integrate: integrateSellerboardCookies,
    print: printStorageStateSummary,
  },
  {
    id: 'flieber',
    label: 'Flieber',
    test: (c) => String(c.domain || '').toLowerCase().includes('flieber'),
    integrate: integrateFlieberCookies,
    print: printStorageStateSummary,
  },
  {
    id: 'staxxer',
    label: 'Staxxer',
    test: (c) => String(c.domain || '').toLowerCase().includes('staxxer'),
    integrate: integrateStaxxerCookies,
    print: printStorageStateSummary,
  },
  {
    id: 'mintsoft',
    label: 'Mintsoft',
    test: (c) => String(c.domain || '').toLowerCase().includes('mintsoft'),
    integrate: integrateMintsoftCookies,
    print: printStorageStateSummary,
  },
  {
    id: 'forceget',
    label: 'Forceget',
    test: (c) => String(c.domain || '').toLowerCase().includes('forceget'),
    integrate: integrateForcegetCookies,
    print: printStorageStateSummary,
  },
  {
    id: 'corax',
    label: 'Corax WMS',
    test: (c) => {
      const d = String(c.domain || '').toLowerCase();
      return d.includes('corax') || d.includes('vanthiel') || d.includes('coraxwms');
    },
    integrate: integrateCoraxCookies,
    print: printStorageStateSummary,
  },
];

function detectPlatforms(cookies) {
  const matched = [];
  for (const platform of PLATFORMS) {
    const subset = cookies.filter(platform.test);
    if (subset.length > 0) matched.push({ platform, subset });
  }
  return matched;
}

function integrateAllCookies(incomingCookies) {
  if (!incomingCookies?.length) {
    throw new Error('No cookies provided');
  }

  const detected = detectPlatforms(incomingCookies);
  if (detected.length === 0) {
    const domains = [...new Set(incomingCookies.map((c) => c.domain).filter(Boolean))];
    throw new Error(
      `Could not detect any known platform. Domains seen: ${domains.join(', ') || '(none)'}\n` +
        `Supported: Amazon, Bol.com, Sellerboard, Flieber, Staxxer, Mintsoft, Forceget, Corax WMS`,
    );
  }

  const results = [];
  const handled = new Set();

  for (const { platform, subset } of detected) {
    for (const c of subset) handled.add(c);
    const result = platform.integrate(subset);
    platform.print(result);
    results.push({ platform: platform.id, label: platform.label, result });
  }

  const unhandled = incomingCookies.filter((c) => !handled.has(c));
  if (unhandled.length > 0) {
    const domains = [...new Set(unhandled.map((c) => c.domain).filter(Boolean))];
    console.log(`\nNote: ${unhandled.length} cookie(s) not matched to a platform (${domains.join(', ')})`);
  }

  return results;
}

function usage() {
  console.error(`Usage:
  node scripts/integrate-cookies.js < cookies.json
  node scripts/integrate-cookies.js cookies.json
  npm run cookies -- cookies.json`);
}

function main() {
  const cookies = readCookieInput();
  if (!cookies) {
    usage();
    process.exit(1);
  }

  console.log(`\n=== Universal cookie integration (${cookies.length} cookie(s)) ===`);
  integrateAllCookies(cookies);
  runSyncStorageStateCopies();
  console.log('\n=== Done — all detected platforms updated ===');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = { PLATFORMS, detectPlatforms, integrateAllCookies };
