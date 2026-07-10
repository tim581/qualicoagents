'use strict';

const fs = require('fs');
const path = require('path');

function cookieKey(c) {
  return `${c.domain}|${c.path || '/'}|${c.name}`;
}

function mergeCookieLists(lists) {
  const map = new Map();
  for (const list of lists) {
    for (const c of list || []) {
      if (!c?.name || !c?.domain || c.value == null) continue;
      map.set(cookieKey(c), c);
    }
  }
  return [...map.values()];
}

function normalizeCookieInput(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.cookies)) return raw.cookies;
  throw new Error('Cookie input must be a JSON array or { cookies: [...] }');
}

function loadJsonCookies(file) {
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return normalizeCookieInput(raw);
}

function saveJsonCookies(file, cookies) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cookies, null, 2));
}

function readCookieInput(argv = process.argv.slice(2)) {
  const fileArg = argv.find((a) => !a.startsWith('-'));
  if (fileArg && fileArg !== '-') {
    const resolved = path.resolve(fileArg);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Cookie file not found: ${resolved}`);
    }
    return normalizeCookieInput(JSON.parse(fs.readFileSync(resolved, 'utf8')));
  }

  if (!process.stdin.isTTY) {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (!stdin) throw new Error('No cookie JSON on stdin');
    return normalizeCookieInput(JSON.parse(stdin));
  }

  if (argv.length === 1 && argv[0].startsWith('[')) {
    return normalizeCookieInput(JSON.parse(argv[0]));
  }

  return null;
}

function runSyncStorageStateCopies() {
  require('child_process').execSync('node sync-storage-state-copies.js', {
    cwd: __dirname,
    stdio: 'inherit',
  });
}

function toPlaywrightCookie(c) {
  const sameSiteMap = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };
  let sameSite = 'Lax';
  if (c.sameSite != null) {
    const key = String(c.sameSite).toLowerCase();
    sameSite = sameSiteMap[key] || 'Lax';
  }
  const expires = c.expirationDate ?? c.expires;
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.session ? -1 : Math.floor(Number(expires) || 0),
    httpOnly: !!c.httpOnly,
    secure: c.secure !== false,
    sameSite,
  };
}

/**
 * Generic integrate: filter by domain → merge raw → write storage-state copies.
 */
function integrateStorageStatePlatform({
  incomingCookies,
  domainTest,
  rawFile,
  storageTargets,
  serviceLabel,
}) {
  const fs = require('fs');
  if (!incomingCookies?.length) {
    throw new Error('No cookies provided');
  }

  const matched = incomingCookies.filter(domainTest);
  const skipped = incomingCookies.length - matched.length;
  if (matched.length === 0) {
    const domains = [...new Set(incomingCookies.map((c) => c.domain).filter(Boolean))];
    throw new Error(
      `No ${serviceLabel} cookies found. Domains seen: ${domains.join(', ') || '(none)'}`,
    );
  }

  const existingRaw = loadJsonCookies(rawFile);
  const mergedRaw = mergeCookieLists([existingRaw, matched]);
  saveJsonCookies(rawFile, mergedRaw);

  const playwrightCookies = mergedRaw.map(toPlaywrightCookie);
  const state = { cookies: playwrightCookies, origins: [] };

  for (const target of storageTargets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(state, null, 2));
  }

  return {
    serviceLabel,
    rawFile: path.relative(path.join(__dirname, '..'), rawFile),
    incoming: matched.length,
    skipped,
    total: playwrightCookies.length,
    storageTargets: storageTargets.map((f) => path.relative(path.join(__dirname, '..'), f)),
  };
}

function printStorageStateSummary(result) {
  console.log(`\n=== ${result.serviceLabel} cookie integration ===\n`);
  console.log(`Raw file: ${result.rawFile} (+${result.incoming} incoming → ${result.total} total)`);
  if (result.skipped > 0) {
    console.log(`Skipped ${result.skipped} non-matching cookie(s)`);
  }
  console.log('Storage state updated:');
  for (const target of result.storageTargets) {
    console.log(`  ${target}`);
  }
}

module.exports = {
  cookieKey,
  mergeCookieLists,
  normalizeCookieInput,
  loadJsonCookies,
  saveJsonCookies,
  readCookieInput,
  runSyncStorageStateCopies,
  toPlaywrightCookie,
  integrateStorageStatePlatform,
  printStorageStateSummary,
};
