#!/usr/bin/env node
'use strict';

/**
 * integrate-staxxer-cookies.js — paste Cookie-Editor JSON → all Staxxer scripts
 */

const path = require('path');
const {
  readCookieInput,
  runSyncStorageStateCopies,
  integrateStorageStatePlatform,
  printStorageStateSummary,
} = require('./cookie-integrate-shared');

const RAW_FILE = path.join(__dirname, 'staxxer-cookies-raw.json');
const STORAGE_TARGETS = [path.join(__dirname, 'staxxer-storage-state.json')];

function isStaxxerCookie(cookie) {
  return String(cookie.domain || '').toLowerCase().includes('staxxer');
}

function integrateStaxxerCookies(incomingCookies) {
  return integrateStorageStatePlatform({
    incomingCookies,
    domainTest: isStaxxerCookie,
    rawFile: RAW_FILE,
    storageTargets: STORAGE_TARGETS,
    serviceLabel: 'Staxxer',
  });
}

function main() {
  const cookies = readCookieInput();
  if (!cookies) {
    console.error('Usage: node scripts/integrate-staxxer-cookies.js < cookies.json');
    process.exit(1);
  }
  const result = integrateStaxxerCookies(cookies);
  printStorageStateSummary(result);
  console.log('\nScripts using staxxer-storage-state.json now share this session.');
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

module.exports = { integrateStaxxerCookies, RAW_FILE, STORAGE_TARGETS };
