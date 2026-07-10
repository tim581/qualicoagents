#!/usr/bin/env node
'use strict';

/**
 * test-cookie-routing.js — verify Amazon domain routing without touching cookie files
 * Run: node scripts/test-cookie-routing.js
 */

const { routeAmazonCookie } = require('./convert-amazon-cookies');
const { detectPlatforms } = require('./integrate-cookies');

const AMAZON_SAMPLES = [
  ['amazon.com', 'na'],
  ['www.amazon.com', 'na'],
  ['sellercentral.amazon.com', 'na'],
  ['amazon.ca', 'ca'],
  ['sellercentral.amazon.ca', 'ca'],
  ['amazon.de', 'de'],
  ['sellercentral.amazon.de', 'de'],
  ['amazon.co.uk', 'eu'],
  ['sellercentral.amazon.co.uk', 'eu'],
  ['amazon.fr', 'eu'],
  ['amazon.it', 'eu'],
  ['amazon.es', 'eu'],
  ['amazon.nl', 'eu'],
  ['amazon.com.be', 'eu'],
  ['amazon.pl', 'eu'],
  ['amazon.se', 'eu'],
  ['amazon.ie', 'eu'],
  ['amazon.com.tr', 'eu'],
  ['sellercentral.amazon.fr', 'eu'],
  ['sellercentral.amazon.eu', 'eu'],
  ['advertising.amazon.com', 'ads'],
  ['advertising.amazon.de', 'ads'],
  ['advertising.amazon.co.uk', 'ads'],
  ['amazon.com.mx', 'na'],
  ['sellercentral.amazon.com.mx', 'na'],
  ['amazon.com.br', 'na'],
  ['amazon.co.jp', 'eu'],
  ['amazon.com.au', 'eu'],
  ['amazon.in', 'eu'],
  ['amazon.sg', 'eu'],
  ['amazon.ae', 'eu'],
  ['amazon.sa', 'eu'],
];

function runAmazonTests() {
  let failed = 0;
  for (const [domain, expected] of AMAZON_SAMPLES) {
    const bucket = routeAmazonCookie({ domain, name: 'test', value: 'x' });
    if (bucket !== expected) {
      console.error(`FAIL ${domain}: expected ${expected}, got ${bucket}`);
      failed++;
    }
  }
  console.log(`Amazon routing: ${AMAZON_SAMPLES.length - failed}/${AMAZON_SAMPLES.length} passed`);
  return failed;
}

function runPlatformDetectionTests() {
  const cookies = [
    { domain: '.amazon.de', name: 'a', value: '1' },
    { domain: '.bol.com', name: 'b', value: '2' },
    { domain: '.sellerboard.com', name: 'c', value: '3' },
    { domain: '.app.flieber.com', name: 'd', value: '4' },
    { domain: '.staxxer.com', name: 'e', value: '5' },
    { domain: '.mintsoft.co.uk', name: 'f', value: '6' },
    { domain: '.forceget.com', name: 'g', value: '7' },
    { domain: '.coraxwms.nl', name: 'h', value: '8' },
  ];
  const detected = detectPlatforms(cookies);
  const ids = detected.map((d) => d.platform.id).sort();
  const expected = ['amazon', 'bol', 'corax', 'flieber', 'forceget', 'mintsoft', 'sellerboard', 'staxxer'];
  const ok = JSON.stringify(ids) === JSON.stringify(expected);
  if (!ok) {
    console.error(`FAIL platform detection: expected ${expected.join(',')}, got ${ids.join(',')}`);
    return 1;
  }
  console.log(`Platform detection: ${ids.length} platforms detected OK`);
  return 0;
}

function main() {
  const amazonFails = runAmazonTests();
  const platformFails = runPlatformDetectionTests();
  if (amazonFails + platformFails > 0) process.exit(1);
  console.log('\nAll routing tests passed.');
}

main();
