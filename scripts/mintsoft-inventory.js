/**
 * mintsoft-inventory.js — Scrape Mintsoft/WePrep UK → mintsoft.json + Supabase 3PL UK
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const {
  writeWarehouseJson,
  writeWarehouseError,
  saveErrorScreenshot,
  matchProductName,
  fillPassword,
  buildInventoryItem,
} = require('./inventory-helpers');
const { writeInventoryToSupabase } = require('./inventory-supabase');

const PORTAL_TIMEOUT = 60000;
const LOGIN_URL = 'https://om.mintsoft.co.uk/UserAccount/LogOn?ReturnUrl=%2fProduct%2f&signInOptions=false';
const PRODUCT_URL = 'https://om.mintsoft.co.uk/Product/';
const EMAIL = 'tim@qualico.be';
const PASSWORD = ':(=efV\\5CzI[-KJYtoHA';

const KNOWN_UK_PRODUCTS = [
  'PUZZLUP 1000 GIFT',
  'PUZZLUP 1500 GIFT',
  '1500 MAT LUX',
  'PUZZLUP 3000 GIFT',
  'PUZZLUP 5000 GIFT',
  'TRAYS 1500 BLACK',
  'TRAYS 1500 WHITE',
  'TRAYS 3000 BLACK',
];

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: PORTAL_TIMEOUT });
  await page.waitForTimeout(2000);

  const customerLink = page.getByRole('link', { name: 'Customer / Client sign In' });
  if (await customerLink.isVisible().catch(() => false)) {
    await customerLink.click();
    await page.waitForTimeout(1000);
  }

  await page.getByRole('textbox', { name: 'UserName' }).fill(EMAIL);
  try {
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  } catch {
    await fillPassword(page, 'input[name="password"]', PASSWORD);
  }

  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForTimeout(5000);

  if (page.url().includes('LogOn')) {
    throw new Error('Mintsoft login failed — still on login page');
  }

  try {
    const closeBtn = await page.$('button.close, .modal button:has-text("Close"), [aria-label="Close"]');
    if (closeBtn) await closeBtn.click();
  } catch {}
}

async function setPageSize100(page) {
  await page.evaluate(() => {
    const sel = document.querySelector('.dataTables_length select, select[name*="length"]');
    if (!sel) return;
    sel.value = '100';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(3000);
}

async function scrapeTablePage(page) {
  return page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('table thead th')).map((th, i) => ({
      index: i,
      text: th.innerText.trim().toLowerCase(),
    }));
    const skuIdx = headers.findIndex((h) => h.text === 'sku');
    const nameIdx = headers.findIndex((h) => h.text === 'name');
    const inventoryIdx = headers.findIndex((h) => h.text === 'inventory' || h.text === 'stock');

    return Array.from(document.querySelectorAll('table tbody tr'))
      .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim()))
      .filter((cells) => cells.length > 2)
      .map((cells) => ({
        sku: skuIdx >= 0 ? cells[skuIdx] : '',
        name: nameIdx >= 0 ? cells[nameIdx] : '',
        inventoryRaw: inventoryIdx >= 0 ? cells[inventoryIdx] : '',
      }));
  });
}

async function scrapeProducts(page) {
  await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: PORTAL_TIMEOUT });
  await page.waitForTimeout(3000);
  await setPageSize100(page);

  const allRows = [...(await scrapeTablePage(page))];
  let pages = 1;

  while (pages < 20) {
    const next = page.locator('.paginate_button.next:not(.disabled), a.next:not(.disabled)').first();
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(2500);
    allRows.push(...(await scrapeTablePage(page)));
    pages++;
  }

  return allRows;
}

function parseWpRaeburnStock(inventoryRaw) {
  if (!inventoryRaw) return 0;
  const parts = inventoryRaw.split('\n').map((p) => p.trim()).filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === 'WP_Raeburn' || parts[i].includes('Raeburn')) {
      return parseInt(parts[i + 1], 10) || 0;
    }
  }
  return 0;
}

function parseRows(rawRows) {
  const byProduct = new Map();

  for (const row of rawRows) {
    const productName = matchProductName(row.sku || row.name);
    if (!productName) continue;

    const stock = parseWpRaeburnStock(row.inventoryRaw);
    byProduct.set(productName, (byProduct.get(productName) || 0) + stock);
  }

  const inventory = [];
  for (const [productName, on_hand] of byProduct.entries()) {
    inventory.push(
      buildInventoryItem({
        product_name: productName,
        on_hand,
        country: 'UK',
        channel: '3PL UK',
        region: 'UK',
      })
    );
  }

  const present = new Set(inventory.map((i) => i.product_name));
  for (const productName of KNOWN_UK_PRODUCTS) {
    if (!present.has(productName)) {
      inventory.push(
        buildInventoryItem({
          product_name: productName,
          on_hand: 0,
          country: 'UK',
          channel: '3PL UK',
          region: 'UK',
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
  const warehouse = 'mintsoft';

  try {
    browser = await chromium.launch({ headless: false });
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    await login(page);
    const rawRows = await scrapeProducts(page);
    const inventory = parseRows(rawRows);

    const file = writeWarehouseJson(warehouse, '3PL UK', inventory);
    await writeInventoryToSupabase('mintsoft', inventory);

    console.log(`✅ Mintsoft: ${inventory.length} products → ${file}`);
    for (const item of inventory) {
      console.log(`   ${item.product_name}: ${item.on_hand}${item.missing ? ' [missing]' : ''}`);
    }
  } catch (err) {
    const screenshot = await saveErrorScreenshot(page, warehouse);
    const file = writeWarehouseError(warehouse, '3PL UK', err.message);
    console.error(`❌ Mintsoft failed: ${err.message}`);
    if (screenshot) console.error(`   Screenshot: ${screenshot}`);
    console.error(`   Wrote error result → ${file}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
