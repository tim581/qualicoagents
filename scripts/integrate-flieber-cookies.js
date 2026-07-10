#!/usr/bin/env node
'use strict';

/**
 * integrate-flieber-cookies.js — paste Cookie-Editor JSON → all Flieber scripts
 *
 * Canonical raw: scripts/flieber-auth.json
 * Storage: scripts/flieber-storage-state.json (synced by sync-storage-state-copies.js)
 */

const path = require('path');
const {
  readCookieInput,
  runSyncStorageStateCopies,
  integrateStorageStatePlatform,
  printStorageStateSummary,
} = require('./cookie-integrate-shared');

const RAW_FILE = path.join(__dirname, 'flieber-auth.json');
const STORAGE_TARGETS = [path.join(__dirname, 'flieber-storage-state.json')];

function isFlieberCookie(cookie) {
  return String(cookie.domain || '').toLowerCase().includes('flieber');
}

function integrateFlieberCookies(incomingCookies) {
  return integrateStorageStatePlatform({
    incomingCookies,
    domainTest: isFlieberCookie,
    rawFile: RAW_FILE,
    storageTargets: STORAGE_TARGETS,
    serviceLabel: 'Flieber',
  });
}

function main() {
  const cookies = readCookieInput();
  if (!cookies) {
    console.error('Usage: node scripts/integrate-flieber-cookies.js < cookies.json');
    process.exit(1);
  }
  const result = integrateFlieberCookies(cookies);
  printStorageStateSummary(result);
  console.log('\nScripts using flieber-storage-state.json / flieber-auth.json now share this session.');
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

module.exports = { integrateFlieberCookies, RAW_FILE, STORAGE_TARGETS };
