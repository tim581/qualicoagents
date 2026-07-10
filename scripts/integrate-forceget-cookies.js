#!/usr/bin/env node
'use strict';

/**
 * integrate-forceget-cookies.js — paste Cookie-Editor JSON → all Forceget scripts
 */

const path = require('path');
const {
  readCookieInput,
  runSyncStorageStateCopies,
  integrateStorageStatePlatform,
  printStorageStateSummary,
} = require('./cookie-integrate-shared');

const ROOT = path.join(__dirname, '..');
const RAW_FILE = path.join(ROOT, 'forceget-cookies-raw.json');
const STORAGE_TARGETS = [
  path.join(__dirname, 'forceget-storage-state.json'),
  path.join(ROOT, 'forceget-storage-state.json'),
];

function isForcegetCookie(cookie) {
  return String(cookie.domain || '').toLowerCase().includes('forceget');
}

function integrateForcegetCookies(incomingCookies) {
  return integrateStorageStatePlatform({
    incomingCookies,
    domainTest: isForcegetCookie,
    rawFile: RAW_FILE,
    storageTargets: STORAGE_TARGETS,
    serviceLabel: 'Forceget',
  });
}

function main() {
  const cookies = readCookieInput();
  if (!cookies) {
    console.error('Usage: node scripts/integrate-forceget-cookies.js < cookies.json');
    process.exit(1);
  }
  const result = integrateForcegetCookies(cookies);
  printStorageStateSummary(result);
  console.log('\nScripts using forceget-storage-state.json now share this session.');
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

module.exports = { integrateForcegetCookies, RAW_FILE, STORAGE_TARGETS };
