#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'price-monitor-scraper.js'), 'utf8');

function extractAssignedObject(text, constName) {
  const marker = `const ${constName} = `;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, constName);
  const brace = text.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(brace, i + 1);
    }
  }
  throw new Error(`unterminated ${constName}`);
}

function extractFunction(text, name) {
  const marker = `function ${name}(`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, name);
  const brace = text.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function evalObject(literal) {
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${literal})`)));
}

const CHANNELS = evalObject(extractAssignedObject(source, 'CHANNELS'));
const AMAZON_PRODUCTS = evalObject(extractAssignedObject(source, 'AMAZON_PRODUCTS'));
const CURRENCY_CONVERSION = evalObject(extractAssignedObject(source, 'CURRENCY_CONVERSION'));
const detectCurrency = vm.runInNewContext(`${extractFunction(source, 'detectCurrency')}; detectCurrency`);

const ca = AMAZON_PRODUCTS[31];
const existing = [
  { name: 'Puzzle Mat 1500 (26x47 In)', productId: 12, asin: 'B09MBH7RFW' },
  { name: 'Puzzle Mat 3000 (37x59 In)', productId: 4, asin: 'B09WTR77CV' },
  { name: 'Sorting Trays 1500 Black', productId: 14, asin: 'B0CNW5BJXF', url: 'https://www.amazon.ca/dp/B0CNW5BJXF' },
  { name: 'Sorting Trays 3000 Black', productId: 15, asin: 'B0FDBLCLSD', url: 'https://www.amazon.ca/dp/B0FDBLCLSD' },
];
const launched = [
  { name: 'Luxe 1500', productId: 10, asin: 'B0FDL8BD8V', url: 'https://www.amazon.ca/dp/B0FDL8BD8V' },
  { name: 'Gift 5000', productId: 11, asin: 'B0FDBLB658', url: 'https://www.amazon.ca/dp/B0FDBLB658' },
];

assert.deepEqual(ca.variants, existing.slice(0, 2));
assert.deepEqual(ca.separateTrays, existing.slice(2));
assert.deepEqual(ca.separateProducts, launched);
assert.equal(ca.trays, undefined);

const iterated = [
  ...ca.variants,
  ...(ca.trays || []),
  ...(ca.separateProducts || []),
  ...(ca.separateTrays || []),
];
assert.equal(iterated.length, 6);
assert.deepEqual(iterated.map((item) => item.asin), [
  'B09MBH7RFW',
  'B09WTR77CV',
  'B0FDL8BD8V',
  'B0FDBLB658',
  'B0CNW5BJXF',
  'B0FDBLCLSD',
]);
assert.deepEqual(
  iterated.map((item) => ({ name: item.name, productId: item.productId, asin: item.asin })),
  [
    { name: 'Puzzle Mat 1500 (26x47 In)', productId: 12, asin: 'B09MBH7RFW' },
    { name: 'Puzzle Mat 3000 (37x59 In)', productId: 4, asin: 'B09WTR77CV' },
    { name: 'Luxe 1500', productId: 10, asin: 'B0FDL8BD8V' },
    { name: 'Gift 5000', productId: 11, asin: 'B0FDBLB658' },
    { name: 'Sorting Trays 1500 Black', productId: 14, asin: 'B0CNW5BJXF' },
    { name: 'Sorting Trays 3000 Black', productId: 15, asin: 'B0FDBLCLSD' },
  ],
);

assert.equal(source.includes('...(products.separateProducts || [])'), true);
assert.equal(source.includes('https://www.${channel.domain}/dp/${variant.asin}?th=1'), true);
for (const item of launched) {
  assert.equal(`https://www.amazon.ca/dp/${item.asin}?th=1`.startsWith(item.url), true);
  assert.equal(Object.hasOwn(item, 'fba_price'), false);
  assert.equal(Object.hasOwn(item, 'in_stock'), false);
}

assert.equal(CHANNELS[31].name, 'AMZ CA');
assert.equal(CHANNELS[31].domain, 'amazon.ca');
assert.equal(CHANNELS[31].currency, 'CAD');
assert.equal(CURRENCY_CONVERSION[31], 'CAD');
assert.equal(detectCurrency('C$49.99', CHANNELS[31].currency), 'CAD');
assert.equal(detectCurrency('$49.99', CHANNELS[31].currency), 'CAD');
assert.equal(detectCurrency('€49.99', CHANNELS[31].currency), 'EUR');

assert.equal(source.includes("if (!locationOk)"), true);
assert.equal(source.includes("'shipped internationally'"), true);
assert.equal(source.includes("'import fees deposit'"), true);
assert.equal(source.includes("'amazon.ca':     ['belgi'"), true);

const deSeparate = AMAZON_PRODUCTS[22].separateProducts.map((item) => item.asin);
assert.deepEqual(deSeparate, ['B0C11B8PDB']);
assert.equal(AMAZON_PRODUCTS[22].variants.some((item) => item.asin === 'B0FDL8BD8V'), true);

console.log('canada listing monitor config tests passed');
