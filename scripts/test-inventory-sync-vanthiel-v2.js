#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const run = require('./inventory-sync-vanthiel-v2.js');

const fixturePath = path.join(__dirname, 'vanthiel-v2-test-fixture.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const { buildSnapshotPayload } = run._private;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const snapshot = buildSnapshotPayload(fixture.rows, fixture.master, fixture.mappings);
const byEan = Object.fromEntries(snapshot.rows.map((row) => [row.ean, row.on_hand]));

assert.equal(snapshot.rows.length, fixture.master.length, 'every eligible EAN must have one canonical row');
assert.equal(snapshot.total_units, fixture.expected.total_units, 'portal COLLI must convert to expected total units');
assert.deepEqual(byEan, fixture.expected.on_hand_by_ean, 'each EAN must aggregate and convert correctly');
assert.equal(byEan['5419980047441'], fixture.expected.on_hand_by_ean['5419980047441'], 'QUALICO 3000 must not map to MAT 3000 GIFT');
assert.equal(byEan['5419980414724'], fixture.expected.on_hand_by_ean['5419980414724'], '5000 GIFT must use current product-master carton factor');

const rawUnits = clone(fixture.rows);
rawUnits[0].stock_text = '106 units';
assert.throws(
  () => buildSnapshotPayload(rawUnits, fixture.master, fixture.mappings),
  /Expected a COLLI quantity/,
  'unit label changes must fail closed',
);

const incomplete = clone(fixture.rows).filter((row) => !/tray(?:s)?[^0-9]*1500/i.test(row.article));
assert.throws(
  () => buildSnapshotPayload(incomplete, fixture.master, fixture.mappings),
  /selling EANs absent from source/,
  'missing portal product rows must fail closed rather than become zero stock',
);

const unknownPositive = clone(fixture.rows);
unknownPositive.push({ article: 'Unknown Corax item', stock_text: '1 Colli' });
assert.throws(
  () => buildSnapshotPayload(unknownPositive, fixture.master, fixture.mappings),
  /Unresolved positive Corax stock row/,
  'unknown positive stock must not be silently dropped or written without an EAN',
);

async function testCredentialFallback() {
  let calls = 0;
  const fakeSupabase = {
    from(table) {
      assert.equal(table, 'Browser_Credentials');
      return {
        select(columns) {
          assert.equal(columns, 'username,password');
          return {
            eq(column, value) {
              assert.equal(column, 'key');
              assert.equal(value, 'vanthiel_corax_wms');
              return {
                async single() {
                  calls += 1;
                  return { data: { username: 'corax-user', password: 'corax-password' }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const fallback = await run._private.loadCoraxCredentials(null, fakeSupabase);
  assert.deepEqual(fallback, { username: 'corax-user', password: 'corax-password' });
  assert.equal(calls, 1, 'legacy executor fallback must query the configured Corax credential once');

  const injected = await run._private.loadCoraxCredentials(
    { username: 'injected-user', password: 'injected-password' },
    { from() { throw new Error('fallback must not run when executor injects credentials'); } },
  );
  assert.deepEqual(injected, { username: 'injected-user', password: 'injected-password' });
}

testCredentialFallback()
  .then(() => {
    console.log(JSON.stringify({
      ok: true,
      canonical_ean_count: snapshot.rows.length,
      total_units: snapshot.total_units,
      ignored_zero_rows: snapshot.ignored_zero_rows.length,
      credential_fallback: 'passed',
    }));
  })
  .catch((error) => {
    console.error(error.stack || String(error));
    process.exit(1);
  });
