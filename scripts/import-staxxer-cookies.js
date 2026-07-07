'use strict';

/** Merge Cookie-Editor export into scripts/staxxer-storage-state.json */
const fs = require('fs');
const path = require('path');

const exportPath = process.argv[2];
const authPath = path.join(__dirname, 'staxxer-storage-state.json');

if (!exportPath) {
  console.error('Usage: node import-staxxer-cookies.js <cookies-export.json>');
  process.exit(1);
}

const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
const auth = fs.existsSync(authPath)
  ? JSON.parse(fs.readFileSync(authPath, 'utf8'))
  : { cookies: [], origins: [] };

const byKey = new Map((auth.cookies || []).map((c) => [`${c.domain}|${c.name}|${c.path}`, c]));

for (const c of exported) {
  const key = `${c.domain}|${c.name}|${c.path || '/'}`;
  byKey.set(key, {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.session ? -1 : c.expirationDate ? Math.floor(c.expirationDate) : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite:
      c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'strict' ? 'Strict' : 'Lax',
  });
}

auth.cookies = [...byKey.values()];
fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));
console.log(`Updated ${authPath} with ${auth.cookies.length} cookies`);
