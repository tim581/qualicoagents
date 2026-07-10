'use strict';

/** @deprecated Use integrate-flieber-cookies.js */

const { integrateFlieberCookies } = require('./integrate-flieber-cookies');

const { readCookieInput, printStorageStateSummary, runSyncStorageStateCopies } = require('./cookie-integrate-shared');



const exportPath = process.argv[2];

if (!exportPath) {

  console.error('Usage: node import-flieber-cookies.js <cookies-export.json>');

  console.error('Prefer: node scripts/integrate-flieber-cookies.js < cookies.json');

  process.exit(1);

}



console.warn('DEPRECATED: import-flieber-cookies.js — use integrate-flieber-cookies.js\n');



try {

  const cookies = readCookieInput([exportPath]);

  const result = integrateFlieberCookies(cookies);

  printStorageStateSummary(result);

  runSyncStorageStateCopies();

} catch (err) {

  console.error(err.message || err);

  process.exit(1);

}

