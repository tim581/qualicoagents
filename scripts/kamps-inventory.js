/**
 * kamps-inventory.js — Scrape Kamps/Corax EU → kamps.json + Supabase 3PL EU
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const {
  writeWarehouseJson,
  writeWarehouseError,
  saveErrorScreenshot,
  matchProductName,
  getProductMeta,
  fillPassword,
  detectMfaOrCaptcha,
  buildInventoryItem,
} = require('./inventory-helpers');
const { writeInventoryToSupabase } = require('./inventory-supabase');

const PORTAL_TIMEOUT = 60000;
const SITE_URL = 'https://kampspijnacker.coraxwms.nl';
const EMAIL = 'qualico@coraxwms.nl';
const PASSWORD = 'GXE.NYeUJX6.f!J';

const KNOWN_EU_PRODUCTS = [
  'PUZZLUP 1500 GIFT',
  'PUZZLUP 1500 ECO',
  'PUZZLUP 3000 GIFT',
  'PUZZLUP 3000 ECO',
  'QUALICO 1500',
  'QUALICO 3000',
  'TRAYS 1500 BLACK',
];

async function loginMicrosoft(page) {
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: PORTAL_TIMEOUT });
  await page.waitForTimeout(4000);

  if (!(page.url().includes('login') || page.url().includes('microsoftonline'))) {
    return;
  }

  const emailField = page.getByRole('textbox', { name: 'someone@coraxwms.nl' });
  await emailField.waitFor({ state: 'visible', timeout: PORTAL_TIMEOUT });
  await emailField.fill(EMAIL);
  await page.getByRole('button', { name: 'Volgende' }).click();
  await page.waitForTimeout(2000);

  try {
    const pwField = page.getByRole('textbox', { name: 'Voer het wachtwoord voor' });
    await pwField.waitFor({ state: 'visible', timeout: 5000 });
    await pwField.fill(PASSWORD);
  } catch {
    await page.locator('#i0118').fill(PASSWORD);
  }

  await page.getByRole('button', { name: 'Aanmelden' }).click();
  await page.waitForTimeout(4000);

  if (await detectMfaOrCaptcha(page)) {
    throw new Error('Corax MFA required — manual login needed');
  }

  try {
    await page.getByRole('button', { name: 'Ja' }).click({ timeout: 5000 });
    await page.waitForTimeout(3000);
  } catch {}

  if (await detectMfaOrCaptcha(page)) {
    throw new Error('Corax MFA required — manual login needed');
  }

  await page.waitForTimeout(3000);
}

async function openStocksPerArtikel(page) {
  await page.getByRole('button', { name: 'Voorraad ' }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('link', { name: 'Stocks per artikel' }).click();
  await page.waitForTimeout(3000);

  try {
    await page.getByRole('combobox').nth(1).selectOption('number:150');
    await page.waitForTimeout(2000);
  } catch {}
}

async function scrapeAllPages(page) {
  const aggregated = new Map();
  let pageNum = 1;

  while (pageNum <= 10) {
    const rows = await page.evaluate(() => {
      const parsed = [];
      for (const table of document.querySelectorAll('table')) {
        const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.innerText.trim().toLowerCase());
        const nameIdx = headers.findIndex((h) => h.includes('artikel') || h.includes('product') || h.includes('omschrijving'));
        const colliIdx = headers.findIndex((h) => h.includes('colli') || h.includes('koli') || h.includes('voorraad'));

        for (const tr of table.querySelectorAll('tbody tr')) {
          const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim());
          if (cells.length < 2) continue;
          const name = nameIdx >= 0 ? cells[nameIdx] : cells[0];
          let colli = 0;
          if (colliIdx >= 0) {
            colli = parseInt(cells[colliIdx].replace(/[^0-9-]/g, ''), 10) || 0;
          } else {
            for (let i = 1; i < cells.length; i++) {
              const num = parseInt(cells[i].replace(/[^0-9-]/g, ''), 10);
              if (!isNaN(num)) {
                colli = num;
                break;
              }
            }
          }
          parsed.push({ name, colli });
        }
      }
      return parsed;
    });

    for (const row of rows) {
      const productName = matchProductName(row.name);
      if (!productName) continue;
      const prev = aggregated.get(productName) || 0;
      aggregated.set(productName, prev + (row.colli || 0));
    }

    const next =
      (await page.$('a:has-text("Volgende"), button:has-text("Volgende"), [aria-label="Next page"], .pagination-next:not(.disabled)')) ||
      (await page.$('a:has-text("Next"), button:has-text("Next")'));

    if (!next) break;
    const cls = (await next.getAttribute('class')) || '';
    if (cls.includes('disabled')) break;

    await next.click();
    await page.waitForTimeout(2500);
    pageNum++;
  }

  return aggregated;
}

function toInventory(aggregated) {
  const inventory = [];

  for (const [productName, colli] of aggregated.entries()) {
    const meta = getProductMeta(productName);
    const upm = meta?.units_per_master || 1;
    inventory.push(
      buildInventoryItem({
        product_name: productName,
        colli,
        units_per_master: upm,
        on_hand: colli * upm,
        country: 'NL',
        channel: '3PL EU',
        region: 'Europe',
      })
    );
  }

  const present = new Set(inventory.map((i) => i.product_name));
  for (const productName of KNOWN_EU_PRODUCTS) {
    if (!present.has(productName)) {
      const meta = getProductMeta(productName);
      inventory.push(
        buildInventoryItem({
          product_name: productName,
          colli: 0,
          units_per_master: meta?.units_per_master || 1,
          on_hand: 0,
          country: 'NL',
          channel: '3PL EU',
          region: 'Europe',
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
  const warehouse = 'kamps';

  try {
    browser = await chromium.launch({ headless: false });
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    await loginMicrosoft(page);
    await openStocksPerArtikel(page);
    const aggregated = await scrapeAllPages(page);
    const inventory = toInventory(aggregated);

    const file = writeWarehouseJson(warehouse, '3PL EU', inventory);
    await writeInventoryToSupabase('kamps', inventory);

    console.log(`✅ Kamps: ${inventory.length} products → ${file}`);
    for (const item of inventory) {
      console.log(`   ${item.product_name}: ${item.on_hand} units (${item.colli} colli)`);
    }
  } catch (err) {
    const screenshot = await saveErrorScreenshot(page, warehouse);
    const file = writeWarehouseError(warehouse, '3PL EU', err.message);
    console.error(`❌ Kamps failed: ${err.message}`);
    if (screenshot) console.error(`   Screenshot: ${screenshot}`);
    console.error(`   Wrote error result → ${file}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
