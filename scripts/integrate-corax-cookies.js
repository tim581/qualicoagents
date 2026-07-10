#!/usr/bin/env node
'use strict';

/**
 * integrate-corax-cookies.js — paste Cookie-Editor JSON → all Corax/Vanthiel WMS scripts
 */

const path = require('path');
const {
  readCookieInput,
  runSyncStorageStateCopies,
  integrateStorageStatePlatform,
  printStorageStateSummary,
} = require('./cookie-integrate-shared');

const ROOT = path.join(__dirname, '..');
const RAW_FILE = path.join(ROOT, 'corax-wms-cookies.json');
const STORAGE_TARGETS = [
  path.join(__dirname, 'corax-wms-storage-state.json'),
  path.join(ROOT, 'corax-wms-storage-state.json'),
];

function isCoraxCookie(cookie) {
  const d = String(cookie.domain || '').toLowerCase();
  return d.includes('corax') || d.includes('vanthiel') || d.includes('coraxwms');
}

function integrateCoraxCookies(incomingCookies) {
  return integrateStorageStatePlatform({
    incomingCookies,
    domainTest: isCoraxCookie,
    rawFile: RAW_FILE,
    storageTargets: STORAGE_TARGETS,
    serviceLabel: 'Corax WMS',
  });
}

function main() {
  const cookies = readCookieInput();
  if (!cookies) {
    console.error('Usage: node scripts/integrate-corax-cookies.js < cookies.json');
    process.exit(1);
  }
  const result = integrateCoraxCookies(cookies);
  printStorageStateSummary(result);
  console.log('\nScripts using corax-wms-storage-state.json now share this session.');
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

module.exports = { integrateCoraxCookies, RAW_FILE, STORAGE_TARGETS };
