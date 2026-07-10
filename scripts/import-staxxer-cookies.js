'use strict';



/** @deprecated Use integrate-staxxer-cookies.js */

const { integrateStaxxerCookies } = require('./integrate-staxxer-cookies');

const { readCookieInput, printStorageStateSummary, runSyncStorageStateCopies } = require('./cookie-integrate-shared');



const exportPath = process.argv[2];

if (!exportPath) {

  console.error('Usage: node import-staxxer-cookies.js <cookies-export.json>');

  console.error('Prefer: node scripts/integrate-staxxer-cookies.js < cookies.json');

  process.exit(1);

}



console.warn('DEPRECATED: import-staxxer-cookies.js — use integrate-staxxer-cookies.js\n');



try {

  const cookies = readCookieInput([exportPath]);

  const result = integrateStaxxerCookies(cookies);

  printStorageStateSummary(result);

  runSyncStorageStateCopies();

} catch (err) {

  console.error(err.message || err);

  process.exit(1);

}

