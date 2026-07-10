#!/usr/bin/env node
'use strict';

/**
 * integrate-sellerboard-cookies.js — paste Cookie-Editor JSON → all Sellerboard scripts
 */

const path = require('path');
const {
  readCookieInput,
  runSyncStorageStateCopies,
  integrateStorageStatePlatform,
  printStorageStateSummary,
} = require('./cookie-integrate-shared');

const ROOT = path.join(__dirname, '..');
const RAW_FILE = path.join(__dirname, 'sellerboard-cookies-raw.json');
const STORAGE_TARGETS = [
  path.join(__dirname, 'sellerboard-storage-state.json'),
  path.join(ROOT, 'sellerboard-storage-state.json'),
];

function isSellerboardCookie(cookie) {
  return String(cookie.domain || '').toLowerCase().includes('sellerboard');
}

function integrateSellerboardCookies(incomingCookies) {
  return integrateStorageStatePlatform({
    incomingCookies,
    domainTest: isSellerboardCookie,
    rawFile: RAW_FILE,
    storageTargets: STORAGE_TARGETS,
    serviceLabel: 'Sellerboard',
  });
}

function main() {
  const cookies = readCookieInput();
  if (!cookies) {
    console.error('Usage: node scripts/integrate-sellerboard-cookies.js < cookies.json');
    process.exit(1);
  }
  const result = integrateSellerboardCookies(cookies);
  printStorageStateSummary(result);
  console.log('\nScripts using sellerboard-storage-state.json now share this session.');
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

module.exports = { integrateSellerboardCookies, RAW_FILE, STORAGE_TARGETS };
