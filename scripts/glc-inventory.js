/**
 * glc-inventory.js — Scrape GLC (US) → glc.json + Supabase 3PL US (combined with forceget.json)
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const {
  writeWarehouseJson,
  writeWarehouseError,
  saveErrorScreenshot,
  matchProductName,
  buildInventoryItem,
  readResultJson,
} = require('./inventory-helpers');
const { writeInventoryToSupabase, combineUsInventory } = require('./inventory-supabase');

const PORTAL_TIMEOUT = 60000;
const REPORT_URL = 'https://wms.glc-inc.com/Report/ConsolidatedInventory';
const USERNAME = 'Qualico.Be';
const PASSWORD = 'Qualico.Be';

async function loginIfNeeded(page) {
  await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: PORTAL_TIMEOUT });
  await page.waitForTimeout(3000);

  const onLogin =
    page.url().includes('Account/Login') ||
    page.url().includes('/Login') ||
    !!(await page.$('input[name="UserName"], input#UserName, input[type="text"]'));

  if (!onLogin) return;

  const userField =
    (await page.$('input[name="UserName"]')) ||
    (await page.$('input#UserName')) ||
    (await page.$('input[type="text"]'));
  const passField = await page.$('input[name="Password"], input#Password, input[type="password"]');

  if (!userField || !passField) throw new Error('GLC login form not found');

  await userField.fill(USERNAME);
  await passField.fill(PASSWORD);

  const submit =
    (await page.$('button[type="submit"]')) ||
    (await page.$('input[type="submit"]')) ||
    (await page.$('button:has-text("Sign In")')) ||
    (await page.$('button:has-text("Log In")'));

  if (submit) await submit.click();
  else await page.keyboard.press('Enter');

  await page.waitForTimeout(4000);

  if (!page.url().includes('ConsolidatedInventory')) {
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: PORTAL_TIMEOUT });
    await page.waitForTimeout(3000);
  }
}

async function runSearch(page) {
  const searchBtn =
    (await page.$('button:has-text("Search")')) ||
    (await page.$('input[type="submit"][value="Search"]')) ||
    (await page.$('a:has-text("Search")'));

  if (searchBtn) {
    await searchBtn.click();
    await page.waitForTimeout(4000);
  }
}

async function scrapeTable(page) {
  let rowCount = 0;
  for (let i = 0; i < 10; i++) {
    rowCount = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
    if (rowCount > 0) break;
    await page.waitForTimeout(2000);
  }
  if (!rowCount) throw new Error('GLC inventory table did not render');

  return page.evaluate(() => {
    const rows = [];
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.innerText.trim().toLowerCase());
      const descIdx = headers.findIndex((h) => h.includes('description'));
      const availIdx = headers.findIndex((h) => h.includes('available'));
      const onHandIdx = headers.findIndex((h) => h.includes('on hand'));

      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim());
        if (cells.length < 3) continue;

        const description = descIdx >= 0 ? cells[descIdx] : cells.find((c) => /541998\d{7}/.test(c)) || cells[1] || '';
        const availableRaw = availIdx >= 0 ? cells[availIdx] : cells[cells.length - 3] || '0';
        const onHandRaw = onHandIdx >= 0 ? cells[onHandIdx] : cells[cells.length - 4] || '0';

        const eanMatch = description.match(/\b(541998\d{7})\b/);
        rows.push({
          description,
          ean: eanMatch ? eanMatch[1] : null,
          available_qty: parseInt(String(availableRaw).replace(/[,.\s]/g, ''), 10) || 0,
          on_hand_qty: parseInt(String(onHandRaw).replace(/[,.\s]/g, ''), 10) || 0,
          cells,
        });
      }
    }
    return rows;
  });
}

function parseRows(rawRows) {
  const inventory = [];

  for (const row of rawRows) {
    const productName = matchProductName(row.ean || row.description);
    if (!productName) continue;

    inventory.push(
      buildInventoryItem({
        product_name: productName,
        on_hand: row.available_qty,
        available_qty: row.available_qty,
        country: 'US',
        channel: '3PL US',
        region: 'US',
      })
    );
  }

  if (!inventory.some((i) => i.product_name === 'TRAYS 1500 BLACK')) {
    inventory.push(
      buildInventoryItem({
        product_name: 'TRAYS 1500 BLACK',
        on_hand: 0,
        available_qty: 0,
        country: 'US',
        channel: '3PL US',
        region: 'US',
        missing: true,
      })
    );
  }

  return inventory;
}

(async () => {
  let browser;
  let page;
  const warehouse = 'glc';

  try {
    browser = await chromium.launch({ headless: false });
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    await loginIfNeeded(page);
    await runSearch(page);
    const rawRows = await scrapeTable(page);
    const inventory = parseRows(rawRows);

    const forcegetData = readResultJson('forceget');
    const usCombined = combineUsInventory(forcegetData?.products, inventory);
    const file = writeWarehouseJson(warehouse, '3PL US', usCombined);
    await writeInventoryToSupabase('us_combined', usCombined);

    console.log(`✅ GLC: ${inventory.length} products → ${file}`);
    console.log(`   US combined: ${usCombined.length} products`);
    for (const item of inventory) {
      console.log(`   ${item.product_name}: available=${item.available_qty}${item.missing ? ' [missing]' : ''}`);
    }
  } catch (err) {
    const screenshot = await saveErrorScreenshot(page, warehouse);
    const file = writeWarehouseError(warehouse, '3PL US', err.message);
    console.error(`❌ GLC failed: ${err.message}`);
    if (screenshot) console.error(`   Screenshot: ${screenshot}`);
    console.error(`   Wrote error result → ${file}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
