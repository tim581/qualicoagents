/**
 * forceget-inventory.js — Scrape Forceget (CA + US) → forceget.json + Supabase 3PL CA
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const {
  writeWarehouseJson,
  writeWarehouseError,
  saveErrorScreenshot,
  matchProductName,
  classifyForcegetWarehouse,
  fillPassword,
  buildInventoryItem,
} = require('./inventory-helpers');
const { writeInventoryToSupabase } = require('./inventory-supabase');

const PORTAL_TIMEOUT = 60000;
const LOGIN_URL = 'https://app.forceget.com';
const INVENTORY_URL = 'https://app.forceget.com/inventory-management/inventory';
const EMAIL = 'tim@qualico.be';
const PASSWORD = 'Sdi3vV8xl!+[z(W{OnjG';

const KNOWN_CA_PRODUCTS = [
  'TRAYS 1500 BLACK',
  'PUZZLUP 1500 ECO',
  'PUZZLUP 3000 ECO',
  'PUZZL BOARD 1500',
];

async function angularLogin(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: PORTAL_TIMEOUT });
  await page.waitForTimeout(3000);

  const emailInput =
    (await page.$('input[type="email"]')) ||
    (await page.$('input[formcontrolname="email"]')) ||
    (await page.$('input[type="text"]'));

  if (!emailInput) throw new Error('Forceget login form not found');

  await emailInput.click();
  await emailInput.fill(EMAIL);
  await emailInput.evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  });

  await fillPassword(page, 'input[type="password"]', PASSWORD);
  await page.waitForTimeout(300);

  const submit =
    (await page.$('button[type="submit"]')) ||
    (await page.$('button:has-text("Sign In")')) ||
    (await page.$('button:has-text("Sign in")')) ||
    (await page.$('button:has-text("Log in")'));

  if (!submit) throw new Error('Forceget Sign In button not found');
  await submit.click();
  await page.waitForTimeout(5000);

  if (page.url().includes('login') || page.url().includes('sign-in')) {
    throw new Error('Forceget login failed — still on login page');
  }
}

async function scrapeInventoryTable(page) {
  await page.goto(INVENTORY_URL, { waitUntil: 'domcontentloaded', timeout: PORTAL_TIMEOUT });
  await page.waitForTimeout(4000);

  let rowsFound = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    rowsFound = await page.evaluate(() => document.querySelectorAll('table tbody tr, mat-row, .ag-row').length);
    if (rowsFound > 0) break;
    await page.waitForTimeout(2000);
  }
  if (!rowsFound) throw new Error('Forceget inventory table did not render');

  const allRows = [];
  let pageNum = 1;

  while (pageNum <= 20) {
    const pageRows = await page.evaluate(() => {
      const results = [];

      const parseRow = (cells) => {
        if (!cells.length) return null;
        const joined = cells.join(' | ');
        let warehouse = '';
        let productName = '';
        let ean = '';
        let stock = null;

        for (const cell of cells) {
          const val = cell.trim();
          if (!val) continue;
          if (/^541998\d{7}$/.test(val)) ean = val;
          if (/toronto|canada|los angeles|new york|forceget.*warehouse/i.test(val)) warehouse = val;
          if (/^(mat|tray|puzzl|qualico)/i.test(val)) productName = val;
        }

        for (let i = cells.length - 1; i >= 0; i--) {
          const num = parseInt(cells[i].replace(/[,.\s]/g, ''), 10);
          if (!isNaN(num) && num >= 0 && num < 1000000) {
            stock = num;
            break;
          }
        }

        if (!productName) {
          const nameCell = cells.find((c) => /mat|tray|puzzl|qualico/i.test(c));
          if (nameCell) productName = nameCell.trim();
        }
        if (!warehouse) {
          const whCell = cells.find((c) => /warehouse|toronto|angeles|york|canada|usa/i.test(c));
          if (whCell) warehouse = whCell.trim();
        }

        if (!productName && !ean) return null;
        return { productName, warehouse, ean, stock, raw: joined };
      };

      for (const table of document.querySelectorAll('table')) {
        for (const tr of table.querySelectorAll('tbody tr')) {
          const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim());
          const parsed = parseRow(cells);
          if (parsed) results.push(parsed);
        }
      }

      if (!results.length) {
        for (const row of document.querySelectorAll('mat-row, .ag-row, [role="row"]')) {
          const cells = Array.from(row.querySelectorAll('mat-cell, .ag-cell, [role="cell"], td')).map((c) =>
            c.innerText.trim()
          );
          const parsed = parseRow(cells);
          if (parsed) results.push(parsed);
        }
      }

      return results;
    });

    allRows.push(...pageRows);

    const hasNext = await page
      .$('button:has-text("Next"), .pagination-next:not(.disabled), [aria-label="Next page"]')
      .then(async (btn) => {
        if (!btn) return false;
        const disabled = await btn.getAttribute('disabled');
        const cls = (await btn.getAttribute('class')) || '';
        return !disabled && !cls.includes('disabled');
      })
      .catch(() => false);

    if (!hasNext) break;
    await page.click('button:has-text("Next"), .pagination-next:not(.disabled), [aria-label="Next page"]').catch(() => {});
    await page.waitForTimeout(2500);
    pageNum++;
  }

  return allRows;
}

function parseRows(rawRows) {
  const byKey = new Map();

  for (const row of rawRows) {
    const productName = matchProductName(row.ean || row.productName);
    const regionInfo = classifyForcegetWarehouse(row.warehouse);
    if (!productName || !regionInfo || row.stock == null) continue;

    const key = `${productName}|${regionInfo.country}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.on_hand += row.stock;
    } else {
      byKey.set(
        key,
        buildInventoryItem({
          product_name: productName,
          on_hand: row.stock,
          country: regionInfo.country,
          channel: regionInfo.channel,
          region: regionInfo.region,
        })
      );
    }
  }

  return Array.from(byKey.values());
}

function ensureKnownProducts(inventory) {
  const present = new Set(inventory.filter((i) => i.country === 'CA').map((i) => i.product_name));
  for (const productName of KNOWN_CA_PRODUCTS) {
    if (!present.has(productName)) {
      inventory.push(
        buildInventoryItem({
          product_name: productName,
          on_hand: 0,
          country: 'CA',
          channel: '3PL CA',
          region: 'Canada',
          missing: true,
        })
      );
    }
  }
  return inventory;
}

(async () => {
  let browser;
  let page;
  const warehouse = 'forceget';

  try {
    browser = await chromium.launch({ headless: false });
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    await angularLogin(page);
    const rawRows = await scrapeInventoryTable(page);
    let inventory = parseRows(rawRows);
    inventory = ensureKnownProducts(inventory);

    const file = writeWarehouseJson(warehouse, '3PL CA', inventory);
    await writeInventoryToSupabase('forceget', inventory.filter((i) => i.country === 'CA'));

    console.log(`✅ Forceget: ${inventory.length} products → ${file}`);
    for (const item of inventory) {
      console.log(`   ${item.product_name} (${item.country}): ${item.on_hand}${item.missing ? ' [missing]' : ''}`);
    }
  } catch (err) {
    const screenshot = await saveErrorScreenshot(page, warehouse);
    const file = writeWarehouseError(warehouse, '3PL CA', err.message);
    console.error(`❌ Forceget failed: ${err.message}`);
    if (screenshot) console.error(`   Screenshot: ${screenshot}`);
    console.error(`   Wrote error result → ${file}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
