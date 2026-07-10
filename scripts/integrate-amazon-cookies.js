#!/usr/bin/env node
'use strict';

/**
 * integrate-amazon-cookies.js — paste Cookie-Editor JSON once → route → merge → all Amazon scripts
 *
 * Usage:
 *   node scripts/integrate-amazon-cookies.js < cookies.json
 *   node scripts/integrate-amazon-cookies.js cookies.json
 *   node scripts/integrate-amazon-cookies.js '[{...}]'
 *
 * Always updates the correct amazon-cookies-*-raw.json file(s) by domain, then runs
 * convert-amazon-cookies.js merge into scripts/amazon-storage-state.json.
 */

const path = require('path');
const {
  mergeCookieLists,
  loadJsonCookies,
  saveJsonCookies,
  readCookieInput,
  runSyncStorageStateCopies,
} = require('./cookie-integrate-shared');
const {
  AMAZON_RAW_FILES,
  routeAmazonCookies,
  mergeAllAmazonCookies,
} = require('./convert-amazon-cookies');

function usage() {
  console.error(`Usage:
  node scripts/integrate-amazon-cookies.js < cookies.json
  node scripts/integrate-amazon-cookies.js cookies.json
  node scripts/integrate-amazon-cookies.js '[{"name":"session-id",...}]'`);
}

function integrateAmazonCookies(incomingCookies) {
  if (!incomingCookies?.length) {
    throw new Error('No cookies provided');
  }

  const routed = routeAmazonCookies(incomingCookies);
  const updatedFiles = [];

  for (const [bucketId, bucketCookies] of Object.entries(routed)) {
    if (bucketId === 'unclassified' || bucketCookies.length === 0) continue;

    const meta = AMAZON_RAW_FILES[bucketId];
    const existing = loadJsonCookies(meta.file);
    const merged = mergeCookieLists([existing, bucketCookies]);
    saveJsonCookies(meta.file, merged);
    updatedFiles.push({
      bucket: meta.label,
      file: path.relative(path.join(__dirname, '..'), meta.file),
      incoming: bucketCookies.length,
      total: merged.length,
    });
  }

  if (updatedFiles.length === 0) {
    const domains = [...new Set(incomingCookies.map((c) => c.domain).filter(Boolean))];
    throw new Error(
      `Could not route any cookies to an Amazon marketplace bucket. Domains seen: ${domains.join(', ') || '(none)'}`,
    );
  }

  const mergeResult = mergeAllAmazonCookies();

  return {
    updatedFiles,
    unclassified: routed.unclassified.length,
    unclassifiedDomains: [...new Set(routed.unclassified.map((c) => c.domain).filter(Boolean))],
    storageState: path.relative(path.join(__dirname, '..'), mergeResult.out),
    totalCookies: mergeResult.total,
    marketplaces: mergeResult.marketplaces,
    rawCounts: mergeResult.counts,
  };
}

function printSummary(result) {
  console.log('\n=== Amazon cookie integration ===\n');
  console.log('Raw files updated:');
  for (const row of result.updatedFiles) {
    console.log(`  ${row.file} (${row.bucket}): +${row.incoming} incoming → ${row.total} total`);
  }
  if (result.unclassified > 0) {
    console.log(`\nWarning: ${result.unclassified} cookie(s) not routed (${result.unclassifiedDomains.join(', ')})`);
  }
  console.log(`\nMerged storage state: ${result.storageState} (${result.totalCookies} cookies)`);
  console.log(`Marketplaces covered: ${result.marketplaces.join(', ') || 'none'}`);
  console.log(
    `Per-bucket in storage: UK/EU=${result.rawCounts.eu}, DE=${result.rawCounts.de}, ` +
      `NA=${result.rawCounts.na}, CA=${result.rawCounts.ca}, Ads=${result.rawCounts.ads}`,
  );
  console.log('\nAll scripts using scripts/amazon-storage-state.json now share this session.');
}

function main() {
  const cookies = readCookieInput();
  if (!cookies) {
    usage();
    process.exit(1);
  }

  const result = integrateAmazonCookies(cookies);
  printSummary(result);
  runSyncStorageStateCopies();
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = { integrateAmazonCookies, printSummary };
