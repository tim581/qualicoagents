// Sellerboard P&L Export v10.0
// COMPLETE REWRITE: CSV download approach (replaces HTML scraping)
// - Downloads main P&L CSV per market (all 12 months in one file)
// - Downloads per-ASIN CSV per market per month (12 files per market)
// - Marketplace selector for both EU and US accounts
// - US account: Filter button required after marketplace change
// - Based on Playwright Codegen recordings (23 April 2026)

require('dotenv').config();

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// --- CONFIG ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOWNLOAD_DIR = path.join(__dirname, 'csv-downloads');
const STORAGE_STATE = path.join(__dirname, 'sellerboard-storage-state.json');
const RUN_ID = `sb-${Date.now()}`;

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Market config
const MARKET_CONFIG = {
  'Amazon.de':    { account: 'eu', treeitemName: 'Amazon.de' },
  'Amazon.co.uk': { account: 'eu', treeitemName: 'Amazon.co.uk' },
  'Amazon.fr':    { account: 'eu', treeitemName: 'Amazon.fr' },
  'Amazon.it':    { account: 'eu', treeitemName: 'Amazon.it' },
  'Amazon.es':    { account: 'eu', treeitemName: 'Amazon.es' },
  'Amazon.nl':    { account: 'eu', treeitemName: 'Amazon.nl' },
  'Amazon.com':   { account: 'us', treeitemName: 'Amazon.com' },
  'Amazon.ca':    { account: 'us', treeitemName: 'Amazon.ca' }
};

const EU_MARKETS = ['Amazon.de', 'Amazon.co.uk', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl'];
const US_MARKETS = ['Amazon.com', 'Amazon.ca'];
const ALL_MARKETS = [...EU_MARKETS, ...US_MARKETS];

// Generate month names for the last 12 months
function getLast12Months() {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthName = d.toLocaleString('en-US', { month: 'long' }); // "January", "February", etc.
    const year = d.getFullYear();
    const monthNum = String(d.getMonth() + 1).padStart(2, '0');
    months.push({ name: monthName, year, monthNum, dateKey: `${year}-${monthNum}` });
  }
  return months;
}

// --- SELECTORS (from Playwright Codegen) ---
const SELECTORS = {
  // Login
  emailInput: 'role=textbox[name="E-mail"]',
  passwordInput: 'role=textbox[name="Password"]',
  continueBtn: 'role=button[name="Continue"]',
  
  // Account switcher
  accountMenu: 'role=link[name="Tim@qualico.be"]',
  euAccount: 'role=link[name="Tim@qualico.be"]',  // nth(1) for EU
  usAccount: 'role=link[name="AMZ USA"]',
  
  // Marketplace dropdown
  marketplaceDropdownArrow: '.select-marketplaces-wrapper > .select2.select2-container > .selection > .select2-selection > .select2-selection__arrow > b > .feather',
  allMarketplacesLabel: 'label:has-text("All marketplaces")',
  filterButton: 'role=button[name="Filter"]',
  closeDropdownArea: '.col-md-1-5',
  
  // Main P&L CSV export (top navigation bar)
  mainExportBtn: 'nav:has-text("Tiles Chart P\\&L Map Trends") >> role=button',
  csvLink: 'role=link[name=".CSV"]',
  
  // Per-ASIN CSV export (bottom panel settings dropdown)
  perAsinExportBtn: '.dashboard-viewTypesSwitcher-settings > .dropdown > .btn',
  perAsinExportOpen: '.dropdown.dashboard-entries-export.open > .btn'
};

// --- HELPER FUNCTIONS ---

async function debugLog(page, step, message) {
  console.log(`      ${message}`);
  
  if (SUPABASE_KEY) {
    try {
      let screenshotBase64 = null;
      if (page) {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 40 });
        screenshotBase64 = buffer.toString('base64');
      }
      await fetch(`${SUPABASE_URL}/rest/v1/Sellerboard_Debug_Log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
          run_id: RUN_ID,
          step,
          message: message.substring(0, 2000),
          screenshot: screenshotBase64,
          created_at: new Date().toISOString()
        })
      });
    } catch (e) { /* ignore */ }
  }
}

// Download a file and wait for it to complete
async function downloadCSV(page, clickAction, filename) {
  try {
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await clickAction();
    const download = await downloadPromise;
    
    const savePath = path.join(DOWNLOAD_DIR, filename);
    await download.saveAs(savePath);
    console.log(`      💾 Downloaded: ${filename} (${fs.statSync(savePath).size} bytes)`);
    return savePath;
  } catch (err) {
    console.log(`      ❌ Download failed for ${filename}: ${err.message}`);
    return null;
  }
}

// Login to Sellerboard
async function login(page) {
  console.log('\n🔐 Logging in...');
  await page.goto('https://app.sellerboard.com/en/auth/login/');
  await page.waitForTimeout(2000);
  
  // Check if already logged in (storage state)
  const url = page.url();
  if (url.includes('/dashboard')) {
    console.log('   ✅ Already logged in (storage state)');
    return;
  }
  
  await page.getByRole('textbox', { name: 'E-mail' }).fill('tim@qualico.be');
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.SELLERBOARD_PASSWORD || 'deAK}Uce7JF,6[<2@}Q1');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(5000);
  await debugLog(page, 'login', '🔐 Logged in');
}

// Switch to EU or US account
async function switchAccount(page, accountType, currentAccount) {
  if (currentAccount === accountType) {
    console.log(`   ✅ Already on ${accountType} account`);
    return;
  }
  
  console.log(`   🔄 Switching to ${accountType} account...`);
  
  // Open account menu — wait for it to be visible (may take time after login)
  const accountLink = page.getByRole('link', { name: 'Tim@qualico.be' }).first();
  await accountLink.waitFor({ state: 'visible', timeout: 30000 });
  await accountLink.click();
  await page.waitForTimeout(1500);
  
  if (accountType === 'eu') {
    // EU account is the second "Tim@qualico.be" link in the dropdown
    await page.getByRole('link', { name: 'Tim@qualico.be' }).nth(1).click();
  } else {
    await page.getByRole('link', { name: 'AMZ USA' }).click();
  }
  
  await page.waitForTimeout(5000); // Wait for account switch + data load
  await debugLog(page, `switch-${accountType}`, `🔄 Switched to ${accountType}`);
}

// Select a specific marketplace in the dropdown
async function selectMarketplace(page, marketName, accountType) {
  console.log(`   🎯 Selecting marketplace: ${marketName}...`);
  
  // Step 1: Open the marketplace dropdown
  await page.locator(SELECTORS.marketplaceDropdownArrow).click();
  await page.waitForTimeout(1500);
  
  // Step 2: Click "All marketplaces" to deselect all
  await page.locator('label').filter({ hasText: 'All marketplaces' }).click();
  await page.waitForTimeout(500);
  
  // Step 3: Click "All marketplaces" again (toggle — ensures clean state)
  await page.locator('label').filter({ hasText: 'All marketplaces' }).click();
  await page.waitForTimeout(500);
  
  // Step 4: Select the specific marketplace
  await page.getByRole('treeitem', { name: marketName, exact: true }).click();
  await page.waitForTimeout(500);
  
  if (accountType === 'us') {
    // US account: must click Filter button to confirm
    try {
      await page.getByRole('button', { name: 'Filter' }).click({ timeout: 3000 });
      console.log(`   ✅ Filter applied for ${marketName}`);
    } catch (e) {
      // Filter button disabled = marketplace was already selected
      console.log(`   ℹ️ Filter button not needed (already on ${marketName})`);
      // Close dropdown by clicking outside
      await page.locator(SELECTORS.closeDropdownArea).first().click().catch(() => {});
    }
  } else {
    // EU account: just click outside to close dropdown
    await page.locator(SELECTORS.closeDropdownArea).first().click().catch(() => {});
  }
  
  await page.waitForTimeout(5000); // Wait for data to load
  await debugLog(page, `marketplace-${marketName}`, `🎯 Selected ${marketName}`);
}

// Download main P&L CSV (all 12 months in one file)
async function downloadMainPLCSV(page, market) {
  console.log(`   📋 Downloading main P&L CSV for ${market}...`);
  
  const filename = `main_pl_${market.replace('.', '_')}_${RUN_ID}.csv`;
  
  // Click the export button in the top navigation
  await page.getByRole('navigation').filter({ hasText: 'Tiles Chart P&L Map Trends' }).getByRole('button').click();
  await page.waitForTimeout(1000);
  
  // Click .CSV link and wait for download
  const filepath = await downloadCSV(page, 
    async () => await page.getByRole('link', { name: '.CSV' }).click(),
    filename
  );
  
  return filepath;
}

// Download per-ASIN CSV for a specific month
async function downloadPerAsinCSV(page, market, monthInfo) {
  console.log(`   📊 Per-ASIN: switching to ${monthInfo.name} ${monthInfo.year}...`);
  
  // Click the month name in the P&L table to switch per-ASIN view
  try {
    await page.getByText(monthInfo.name, { exact: true }).click();
    await page.waitForTimeout(3000); // Wait for per-ASIN panel to update
  } catch (e) {
    console.log(`   ⚠️ Could not click month "${monthInfo.name}": ${e.message}`);
    return null;
  }
  
  const filename = `per_asin_${market.replace('.', '_')}_${monthInfo.dateKey}_${RUN_ID}.csv`;
  
  // Open per-ASIN export dropdown (different from main P&L!)
  await page.locator('.dashboard-viewTypesSwitcher-settings > .dropdown > .btn').first().click();
  await page.waitForTimeout(1000);
  
  // Click CSV download
  const filepath = await downloadCSV(page,
    async () => await page.getByRole('link', { name: '.CSV' }).click(),
    filename
  );
  
  return filepath;
}

// Upload CSV content to Supabase Sellerboard_Exports table
async function saveCSVToSupabase(market, viewType, csvContent, periodInfo) {
  if (!SUPABASE_KEY) return;
  
  try {
    // Parse CSV to get headers and rows
    const lines = csvContent.split('\n').filter(l => l.trim());
    const headers = lines[0];
    const rows = lines.slice(1);
    
    const body = {
      market,
      view_type: viewType,
      headers: JSON.stringify(headers.split(',')),
      rows: JSON.stringify(rows.map(r => r.split(','))),
      row_count: rows.length,
      period_start: periodInfo?.start || null,
      period_end: periodInfo?.end || null,
      created_at: new Date().toISOString()
    };
    
    // UPSERT by market + view_type
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Sellerboard_Exports`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(body)
      }
    );
    
    if (res.ok) {
      console.log(`      ✅ Saved to Supabase: ${market} / ${viewType}`);
    } else {
      console.log(`      ⚠️ Supabase save failed: ${res.status}`);
    }
  } catch (e) {
    console.log(`      ⚠️ Supabase upload error: ${e.message}`);
  }
}

// --- MAIN ---
async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  let marketsToProcess = ALL_MARKETS;
  let monthsToProcess = null; // null = all 12
  
  if (args.includes('--eu')) marketsToProcess = EU_MARKETS;
  if (args.includes('--us')) marketsToProcess = US_MARKETS;
  if (args.includes('--market')) {
    const idx = args.indexOf('--market');
    marketsToProcess = [args[idx + 1]];
  }
  if (args.includes('--months')) {
    const idx = args.indexOf('--months');
    monthsToProcess = parseInt(args[idx + 1]); // e.g., --months 3 = last 3 months
  }
  
  const allMonths = getLast12Months();
  const months = monthsToProcess ? allMonths.slice(-monthsToProcess) : allMonths;
  
  console.log('═══════════════════════════════════════');
  console.log(`🚀 Sellerboard CSV Export v10.0`);
  console.log(`   Markets: ${marketsToProcess.join(', ')}`);
  console.log(`   Months: ${months.map(m => `${m.name} ${m.year}`).join(', ')}`);
  console.log(`   Run ID: ${RUN_ID}`);
  console.log('═══════════════════════════════════════\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...(fs.existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {}),
    acceptDownloads: true
  });
  const page = await context.newPage();
  
  const summary = {};
  let currentAccount = null;
  
  try {
    // Login
    await login(page);
    
    // Navigate to dashboard (P&L table view)
    await page.goto('https://app.sellerboard.com/en/dashboard/?viewType=table');
    await page.waitForTimeout(5000);
    
    for (const market of marketsToProcess) {
      const config = MARKET_CONFIG[market];
      console.log(`\n${'═'.repeat(50)}`);
      console.log(`📦 Processing: ${market} (${config.account} account)`);
      console.log('═'.repeat(50));
      
      try {
        // Switch account if needed
        await switchAccount(page, config.account, currentAccount);
        currentAccount = config.account;
        
        // Select marketplace
        await selectMarketplace(page, market, config.account);
        
        // === MAIN P&L CSV (all 12 months in one file) ===
        const mainPath = await downloadMainPLCSV(page, market);
        summary[market] = { main_pl: mainPath ? '✅' : '❌' };
        
        // === PER-ASIN CSVs (one per month) ===
        const perAsinResults = [];
        
        for (const month of months) {
          const asinPath = await downloadPerAsinCSV(page, market, month);
          perAsinResults.push({
            month: `${month.name} ${month.year}`,
            dateKey: month.dateKey,
            success: !!asinPath,
            path: asinPath
          });
        }
        
        const successCount = perAsinResults.filter(r => r.success).length;
        summary[market].per_asin = `${successCount}/${months.length} months ✅`;
        
        // Save CSV files to Supabase
        if (mainPath) {
          const csvContent = fs.readFileSync(mainPath, 'utf-8');
          await saveCSVToSupabase(market, 'main_pl', csvContent, {
            start: months[0].dateKey,
            end: months[months.length - 1].dateKey
          });
        }
        
        for (const result of perAsinResults) {
          if (result.path) {
            const csvContent = fs.readFileSync(result.path, 'utf-8');
            await saveCSVToSupabase(market, `per_asin_${result.dateKey}`, csvContent, {
              start: result.dateKey,
              end: result.dateKey
            });
          }
        }
        
      } catch (err) {
        console.log(`\n   ❌ FAILED: ${market} — ${err.message}`);
        summary[market] = { error: err.message };
        await debugLog(page, `error-${market}`, `❌ ${err.message}`);
      }
    }
    
    // Save storage state for next run
    await context.storageState({ path: STORAGE_STATE });
    
  } catch (err) {
    console.error(`\n💥 Fatal error: ${err.message}`);
  } finally {
    await browser.close();
  }
  
  // === SUMMARY ===
  console.log('\n═══════════════════════════════════════');
  console.log('📊 SUMMARY');
  console.log('═══════════════════════════════════════');
  for (const [market, result] of Object.entries(summary)) {
    console.log(`   ${market}: ${JSON.stringify(result)}`);
  }
  console.log(`\n   📁 CSVs saved to: ${DOWNLOAD_DIR}`);
  console.log('═══════════════════════════════════════\n');
  
  // Write summary to Supabase Browser_Tasks if task_id provided
  const taskId = process.env.BROWSER_TASK_ID;
  if (taskId && SUPABASE_KEY) {
    await fetch(`${SUPABASE_URL}/rest/v1/Browser_Tasks?id=eq.${taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        status: 'completed',
        result: JSON.stringify(summary),
        updated_at: new Date().toISOString()
      })
    }).catch(() => {});
  }
}

main().catch(console.error);
