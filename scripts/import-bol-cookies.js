'use strict';

/** Merge Cookie-Editor export into bol-storage-state.json (both scripts/ and repo root). */
const { integrateBolCookies, printSummary } = require('./integrate-bol-cookies');
const { readCookieInput, runSyncStorageStateCopies } = require('./cookie-integrate-shared');

const exportPath = process.argv[2];
if (!exportPath) {
  console.error('Usage: node import-bol-cookies.js <cookies-export.json>');
  console.error('Prefer: node scripts/integrate-bol-cookies.js < cookies.json');
  process.exit(1);
}

try {
  const cookies = readCookieInput([exportPath]);
  const result = integrateBolCookies(cookies);
  printSummary(result);
  runSyncStorageStateCopies();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
