#!/usr/bin/env node
'use strict';

/**
 * integrate-bol-cookies.js — paste Cookie-Editor JSON once → merge → all Bol scripts
 *
 * Usage:
 *   node scripts/integrate-bol-cookies.js < cookies.json
 *   node scripts/integrate-bol-cookies.js cookies.json
 *   node scripts/integrate-bol-cookies.js '[{...}]'
 *
 * Updates bol-cookies-raw.json (canonical export) and both bol-storage-state.json copies.
 */

const fs = require('fs');
const path = require('path');
const {
  mergeCookieLists,
  loadJsonCookies,
  saveJsonCookies,
  readCookieInput,
  runSyncStorageStateCopies,
} = require('./cookie-integrate-shared');

const ROOT = path.join(__dirname, '..');
const RAW_FILE = path.join(ROOT, 'bol-cookies-raw.json');
const STORAGE_TARGETS = [
  path.join(__dirname, 'bol-storage-state.json'),
  path.join(ROOT, 'bol-storage-state.json'),
];

function usage() {
  console.error(`Usage:
  node scripts/integrate-bol-cookies.js < cookies.json
  node scripts/integrate-bol-cookies.js cookies.json
  node scripts/integrate-bol-cookies.js '[{"name":"GATEKEEPER-u",...}]'`);
}

function toPlaywright(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.session ? -1 : c.expirationDate ? Math.floor(c.expirationDate) : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite:
      c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'strict' ? 'Strict' : 'Lax',
  };
}

function isBolCookie(cookie) {
  const d = String(cookie.domain || '').toLowerCase();
  return d.includes('bol.com');
}

function integrateBolCookies(incomingCookies) {
  if (!incomingCookies?.length) {
    throw new Error('No cookies provided');
  }

  const bolCookies = incomingCookies.filter(isBolCookie);
  const skipped = incomingCookies.length - bolCookies.length;
  if (bolCookies.length === 0) {
    const domains = [...new Set(incomingCookies.map((c) => c.domain).filter(Boolean))];
    throw new Error(`No bol.com cookies found. Domains seen: ${domains.join(', ') || '(none)'}`);
  }

  const existingRaw = loadJsonCookies(RAW_FILE);
  const mergedRaw = mergeCookieLists([existingRaw, bolCookies]);
  saveJsonCookies(RAW_FILE, mergedRaw);

  const playwrightCookies = mergedRaw.map(toPlaywright);
  const state = { cookies: playwrightCookies, origins: [] };

  for (const target of STORAGE_TARGETS) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(state, null, 2));
  }

  const gate = playwrightCookies.find((c) => c.name === 'GATEKEEPER-u');

  return {
    rawFile: path.relative(ROOT, RAW_FILE),
    incoming: bolCookies.length,
    skipped,
    total: playwrightCookies.length,
    gatekeeper: !!gate,
    storageTargets: STORAGE_TARGETS.map((f) => path.relative(ROOT, f)),
  };
}

function printSummary(result) {
  console.log('\n=== Bol cookie integration ===\n');
  console.log(`Raw file: ${result.rawFile} (+${result.incoming} incoming → ${result.total} total)`);
  if (result.skipped > 0) {
    console.log(`Skipped ${result.skipped} non-bol.com cookie(s)`);
  }
  console.log('Storage state updated:');
  for (const target of result.storageTargets) {
    console.log(`  ${target}`);
  }
  console.log(`GATEKEEPER-u present: ${result.gatekeeper ? 'yes' : 'NO — login may fail'}`);
  console.log('\nAll scripts using bol-storage-state.json now share this session.');
}

function main() {
  const cookies = readCookieInput();
  if (!cookies) {
    usage();
    process.exit(1);
  }

  const result = integrateBolCookies(cookies);
  printSummary(result);
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

module.exports = { integrateBolCookies, printSummary, RAW_FILE, STORAGE_TARGETS };
