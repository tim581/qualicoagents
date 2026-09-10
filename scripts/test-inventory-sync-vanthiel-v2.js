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

console.log(JSON.stringify({
  ok: true,
  canonical_ean_count: snapshot.rows.length,
  total_units: snapshot.total_units,
  ignored_zero_rows: snapshot.ignored_zero_rows.length,
}));
