/**
 * staxxer-vat-scraper.js — Scrape VAT compliance data from Staxxer cloud portal
 *
 * Pages:
 *   - Dashboard (country / period status)
 *   - VAT Filings (todo / upcoming / done)
 *   - VAT Registrations
 *   - One Stop Shop registration
 *
 * Auth: scripts/staxxer-storage-state.json (cookies) → fallback Browser_Credentials staxxer_login
 * Output: Supabase tables staxxer_vat_* + JSON summary in task result
 *
 * Usage:
 *   node scripts/staxxer-vat-scraper.js
 *   BROWSER_TASK_ID=... node scripts/staxxer-vat-scraper.js
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const ACCOUNT_SLUG = process.env.STAXXER_ACCOUNT_SLUG || 'qualicobv';
const BASE_URL = `https://cloud.staxxer.com/${ACCOUNT_SLUG}`;
const STORAGE_PATH = path.join(__dirname, 'staxxer-storage-state.json');
const RUN_ID = process.env.BROWSER_TASK_ID
  ? `staxxer_vat_task_${process.env.BROWSER_TASK_ID}`
  : `staxxer_vat_${Date.now()}`;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const FILING_TABS = ['todo', 'upcoming', 'done'];

function log(step, msg) {
  console.log(`[staxxer-vat] ${step}: ${msg}`);
}

function sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function dbLog(step, status, message) {
  log(step, message);
  if (!supabase) return;
  try {
    await supabase.from('Flieber_Debug_Log').insert({
      run_id: RUN_ID,
      step,
      status,
      message: String(message).slice(0, 3000),
    });
  } catch {
    /* ignore */
  }
}

function parseEuDate(text) {
  if (!text || text === '-' || text === '—') return null;
  const m = String(text).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseIsoDate(text) {
  if (!text) return null;
  const t = String(text).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return parseEuDate(t);
}

function parseAmount(text) {
  if (!text || text === '-' || text === '—') {
    return { amount_text: text || null, amount_value: null, currency: null };
  }
  const raw = String(text).trim();
  const currencyMatch = raw.match(/^([€$£]|PLN|CZK|EUR|GBP|USD)\s*/i);
  let currency = null;
  let numericPart = raw;
  if (currencyMatch) {
    const c = currencyMatch[1].toUpperCase();
    currency = c === '€' ? 'EUR' : c === '£' ? 'GBP' : c;
    numericPart = raw.slice(currencyMatch[0].length).trim();
  } else if (raw.startsWith('€')) {
    currency = 'EUR';
    numericPart = raw.slice(1).trim();
  } else if (raw.startsWith('£')) {
    currency = 'GBP';
    numericPart = raw.slice(1).trim();
  }

  let cleaned = numericPart.replace(/[^\d,.-]/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    if (lastDot > lastComma) {
      cleaned = cleaned.replace(/,/g, '');
    } else {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastDot > -1) {
    const frac = cleaned.split('.').pop();
    if (frac.length === 2) {
      cleaned = cleaned.replace(/,/g, '');
    } else if (frac.length === 3) {
      cleaned = cleaned.replace(/\./g, '');
    }
  } else if (lastComma > -1) {
    const frac = cleaned.split(',').pop();
    if (frac.length === 2) {
      cleaned = cleaned.replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  }

  const value = parseFloat(cleaned);
  return {
    amount_text: raw,
    amount_value: Number.isFinite(value) ? value : null,
    currency,
  };
}

function cleanFilingPeriod(text) {
  if (!text) return null;
  return String(text).split('?')[0].replace(/\s+/g, ' ').trim() || null;
}

async function loadCredentials() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.staxxer_login&select=username,password`,
    { headers: sbHeaders() },
  );
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

function loadStorageStatePath() {
  if (fs.existsSync(STORAGE_PATH)) return STORAGE_PATH;
  return null;
}

async function passwordLogin(page, creds) {
  await page.goto('https://cloud.staxxer.com/authentication/login', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(1500);

  const emailField = page.locator('input[type="email"], input[name="email"], input[name="username"]').first();
  const passwordField = page.locator('input[type="password"]').first();
  await emailField.waitFor({ state: 'visible', timeout: 30000 });
  await emailField.fill(creds.username);
  await passwordField.fill(creds.password);
  await page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")').first().click();
  await page.waitForURL(`**/${ACCOUNT_SLUG}**`, { timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(2000);
}

async function ensureLoggedIn(page) {
  const storage = loadStorageStatePath();
  if (storage) {
    log('auth', `Using cookies from ${path.basename(storage)}`);
  }

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => null);
  await page.waitForTimeout(3000);

  const url = page.url();
  if (url.includes(ACCOUNT_SLUG) && !url.includes('login')) {
    await dbLog('auth', 'success', 'Staxxer session valid via cookies');
    return;
  }

  const creds = await loadCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error(
      'Staxxer login failed — refresh staxxer-storage-state.json or add Browser_Credentials key=staxxer_login',
    );
  }

  await dbLog('auth', 'info', 'Cookies expired — logging in with staxxer_login credentials');
  await passwordLogin(page, creds);
  await page.context().storageState({ path: STORAGE_PATH });

  if (!page.url().includes(ACCOUNT_SLUG)) {
    throw new Error(`Staxxer login failed — landed on ${page.url()}`);
  }
  await dbLog('auth', 'success', 'Logged in and saved fresh cookies');
}

async function scrapeTableRows(page) {
  return page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    const out = [];
    for (const table of tables) {
      const headers = [...table.querySelectorAll('thead th')].map((th) =>
        th.textContent.replace(/\s+/g, ' ').trim(),
      );
      const bodyRows = [...table.querySelectorAll('tbody tr')];
      for (const tr of bodyRows) {
        const cells = [...tr.querySelectorAll('td')].map((td) =>
          td.textContent.replace(/\s+/g, ' ').trim(),
        );
        if (cells.length && cells.some(Boolean)) out.push({ headers, cells });
      }
    }
    return out;
  });
}

function mapRegistrationRow(cells) {
  const [country, number, status, startDate, endDate] = cells;
  if (!country || country === 'Country') return null;
  return {
    country,
    vat_number: number || null,
    status: status || null,
    start_date: parseIsoDate(startDate),
    end_date: parseIsoDate(endDate),
  };
}

function mapFilingRow(tab, cells) {
  const [country, filingPeriod, paymentDue, paymentDate, amount, status] = cells;
  if (!country || country === 'Country') return null;
  const amountParsed = parseAmount(amount);
  return {
    tab,
    country,
    filing_period: cleanFilingPeriod(filingPeriod),
    payment_due: parseEuDate(paymentDue),
    payment_date: parseEuDate(paymentDate),
    amount_text: amountParsed.amount_text,
    amount_value: amountParsed.amount_value,
    currency: amountParsed.currency,
    status: status || null,
  };
}

async function scrapeRegistrations(page) {
  await page.goto(`${BASE_URL}/vat-registrations`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3000);
  const rows = await scrapeTableRows(page);
  return rows.map((r) => mapRegistrationRow(r.cells)).filter(Boolean);
}

async function scrapeFilings(page) {
  const all = [];
  for (const tab of FILING_TABS) {
    await page.goto(`${BASE_URL}/vat-filing?tab=${tab}`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(3500);
    const rows = await scrapeTableRows(page);
    for (const row of rows) {
      const mapped = mapFilingRow(tab, row.cells);
      if (mapped) all.push(mapped);
    }
    log('filings', `${tab}: ${all.filter((f) => f.tab === tab).length} rows`);
  }
  return all;
}

async function scrapeOss(page) {
  await page.goto(`${BASE_URL}/onestopshop`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3000);
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const linked = [];
    const regBlock = text.match(/VAT registration([\s\S]*?)(?:Registration date|OSS Settings|$)/i);
    if (regBlock) {
      const lines = regBlock[1].split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^(.+?)\s*-\s*([A-Z]{2}[A-Z0-9]+)$/);
        if (m) linked.push({ country: m[1].trim(), vat_number: m[2].trim() });
      }
    }
    const dateMatch = text.match(/Registration date\s*\n?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2}-\d{4})/i);
    const endMatch = text.match(/end date\s*\n?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2}-\d{4})/i);
    const inputs = [...document.querySelectorAll('input[type="date"], input[type="text"]')].map((el) => ({
      name: el.getAttribute('name') || el.id || '',
      value: el.value || '',
    }));
    const regInput = inputs.find((i) => i.name.includes('active_date'));
    const endInput = inputs.find((i) => i.name.includes('ending_date'));
    return {
      registration_date: regInput?.value || (dateMatch ? dateMatch[1] : null),
      end_date: endInput?.value || (endMatch ? endMatch[1] : null),
      linked_vat_numbers: linked,
      additional_data: { inputs, excerpt: text.slice(0, 2000) },
    };
  });
}

async function scrapeDashboard(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(4000);
  return page.evaluate(() => {
    const allowedCountries = new Set([
      'Belgium', 'Czechia', 'France', 'Germany', 'Italy', 'Netherlands',
      'Poland', 'Spain', 'United Kingdom', 'OSS Belgium',
    ]);
    const items = [];
    const headings = [...document.querySelectorAll('h2, h3, h4, h5, .card-title')];
    for (const h of headings) {
      const title = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (!title || title.length > 80) continue;
      const parentText = (h.parentElement?.innerText || '').replace(/\s+/g, ' ').trim();
      const statusMatch = parentText.match(/In progress|Done|Todo|Upcoming|Paid|No Action Required/i);
      const periodMatches = parentText.match(/Q[1-4]\s*-\s*\d{4}/g) || [];

      if (allowedCountries.has(title)) {
        for (const period of periodMatches.length ? periodMatches : [null]) {
          items.push({
            section: title === 'OSS Belgium' ? 'OSS' : 'Country',
            country: title,
            period_label: period,
            status_label: statusMatch ? statusMatch[0] : null,
          });
        }
      } else if (/^OSS$/i.test(title) || /^Q[1-4]\s*-\s*\d{4}/.test(title)) {
        items.push({
          section: /^OSS$/i.test(title) ? 'OSS' : 'Dashboard',
          country: null,
          period_label: /^Q[1-4]\s*-\s*\d{4}/.test(title) ? title : periodMatches[0] || null,
          status_label: statusMatch ? statusMatch[0] : null,
        });
      }
    }

    const seen = new Set();
    return items.filter((item) => {
      const key = `${item.section}|${item.country}|${item.period_label}|${item.status_label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

async function createRun() {
  if (!supabase) return;
  const { error } = await supabase.from('staxxer_vat_sync_runs').insert({
    run_id: RUN_ID,
    account_slug: ACCOUNT_SLUG,
    status: 'running',
  });
  if (error) throw new Error(`staxxer_vat_sync_runs insert failed: ${error.message}`);
}

async function finishRun(summary, errorMessage) {
  if (!supabase) return;
  const { error } = await supabase
    .from('staxxer_vat_sync_runs')
    .update({
      status: errorMessage ? 'failed' : 'done',
      filings_count: summary.filings?.length || 0,
      registrations_count: summary.registrations?.length || 0,
      dashboard_items_count: summary.dashboard?.length || 0,
      error_message: errorMessage || null,
      raw_summary: summary,
    })
    .eq('run_id', RUN_ID);
  if (error) log('supabase', `run update failed: ${error.message}`);
}

async function persistData(summary) {
  if (!supabase) {
    log('supabase', 'Skipped — no SUPABASE_URL/KEY');
    return;
  }

  if (summary.registrations?.length) {
    const rows = summary.registrations.map((r) => ({
      run_id: RUN_ID,
      account_slug: ACCOUNT_SLUG,
      ...r,
    }));
    const { error } = await supabase.from('staxxer_vat_registrations').upsert(rows, {
      onConflict: 'run_id,country,vat_number',
    });
    if (error) throw new Error(`registrations upsert: ${error.message}`);
  }

  if (summary.filings?.length) {
    const rows = summary.filings.map((f) => ({
      run_id: RUN_ID,
      account_slug: ACCOUNT_SLUG,
      ...f,
    }));
    const { error } = await supabase.from('staxxer_vat_filings').upsert(rows, {
      onConflict: 'run_id,tab,country,filing_period,payment_due',
    });
    if (error) throw new Error(`filings upsert: ${error.message}`);
  }

  if (summary.oss) {
    const { error } = await supabase.from('staxxer_oss_snapshot').upsert(
      {
        run_id: RUN_ID,
        account_slug: ACCOUNT_SLUG,
        registration_date: parseIsoDate(summary.oss.registration_date),
        end_date: parseIsoDate(summary.oss.end_date),
        linked_vat_numbers: summary.oss.linked_vat_numbers || [],
        additional_data: summary.oss.additional_data || {},
      },
      { onConflict: 'run_id' },
    );
    if (error) throw new Error(`oss upsert: ${error.message}`);
  }

  if (summary.dashboard?.length) {
    const rows = summary.dashboard.map((d) => ({
      run_id: RUN_ID,
      account_slug: ACCOUNT_SLUG,
      ...d,
    }));
    const { error } = await supabase.from('staxxer_vat_dashboard').insert(rows);
    if (error) throw new Error(`dashboard insert: ${error.message}`);
  }
}

async function run() {
  await dbLog('init', 'info', `Starting Staxxer VAT scrape for ${ACCOUNT_SLUG}`);
  await createRun();

  let browser;
  const summary = {
    run_id: RUN_ID,
    account_slug: ACCOUNT_SLUG,
    scraped_at: new Date().toISOString(),
    registrations: [],
    filings: [],
    oss: null,
    dashboard: [],
  };

  try {
    const storage = loadStorageStatePath();
    browser = await chromium.launch({
      headless: process.env.STAXXER_HEADLESS !== '0',
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext(
      storage
        ? { storageState: storage, viewport: { width: 1400, height: 900 } }
        : { viewport: { width: 1400, height: 900 } },
    );
    const page = await context.newPage();

    await ensureLoggedIn(page);

    summary.registrations = await scrapeRegistrations(page);
    await dbLog('registrations', 'success', `Scraped ${summary.registrations.length} registrations`);

    summary.filings = await scrapeFilings(page);
    await dbLog('filings', 'success', `Scraped ${summary.filings.length} filing rows`);

    summary.oss = await scrapeOss(page);
    await dbLog('oss', 'success', `OSS linked VAT numbers: ${summary.oss.linked_vat_numbers?.length || 0}`);

    summary.dashboard = await scrapeDashboard(page);
    await dbLog('dashboard', 'success', `Dashboard items: ${summary.dashboard.length}`);

    await persistData(summary);
    await finishRun(summary, null);

    const outputPath = path.join(__dirname, 'staxxer-vat-scrape-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

    return { success: true, data: summary };
  } catch (err) {
    await dbLog('fatal', 'error', err.message);
    await finishRun(summary, err.message);
    return { success: false, error: err.message, data: summary };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = run;

if (require.main === module) {
  run()
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
