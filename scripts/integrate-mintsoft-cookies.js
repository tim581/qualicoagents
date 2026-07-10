#!/usr/bin/env node
'use strict';

/**
 * integrate-mintsoft-cookies.js — paste Cookie-Editor JSON → all Mintsoft scripts
 */

const path = require('path');
const {
  readCookieInput,
  runSyncStorageStateCopies,
  integrateStorageStatePlatform,
  printStorageStateSummary,
} = require('./cookie-integrate-shared');

const ROOT = path.join(__dirname, '..');
const RAW_FILE = path.join(ROOT, 'mintsoft-cookies-raw.json');
const STORAGE_TARGETS = [
  path.join(__dirname, 'mintsoft-storage-state.json'),
  path.join(ROOT, 'mintsoft-storage-state.json'),
];

function isMintsoftCookie(cookie) {
  return String(cookie.domain || '').toLowerCase().includes('mintsoft');
}

function integrateMintsoftCookies(incomingCookies) {
  return integrateStorageStatePlatform({
    incomingCookies,
    domainTest: isMintsoftCookie,
    rawFile: RAW_FILE,
    storageTargets: STORAGE_TARGETS,
    serviceLabel: 'Mintsoft',
  });
}

function main() {
  const cookies = readCookieInput();
  if (!cookies) {
    console.error('Usage: node scripts/integrate-mintsoft-cookies.js < cookies.json');
    process.exit(1);
  }
  const result = integrateMintsoftCookies(cookies);
  printStorageStateSummary(result);
  console.log('\nScripts using mintsoft-storage-state.json now share this session.');
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

module.exports = { integrateMintsoftCookies, RAW_FILE, STORAGE_TARGETS };
