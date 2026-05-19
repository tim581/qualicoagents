/**
 * bol-price-update.js
 * ====================
 * Sets or updates a "Tijdelijke prijs" (promotional price) on Bol.com Partner Portal.
 * Built on top of bol-seller-template.js (stealth + cookies + Decodo proxy).
 *
 * INPUT (via Browser_Tasks.actions JSON):
 * {
 *   "ean": "9300000117610237",          // Bol product ID (EAN or bol product ID)
 *   "offer_uid": "4ab15dc1-...",        // Offer UUID from Bol
 *   "promotional_price": 48.95,         // New promotional price in EUR
 *   "start_date": "2026-05-19",         // Start date (YYYY-MM-DD)
 *   "end_date": "2026-09-30",           // End date (YYYY-MM-DD)
 *   "action": "set" | "remove"          // "set" = create/update promo, "remove" = delete promo
 * }
 *
 * OUTPUT (written to Browser_Tasks.result):
 * {
 *   "success": true/false,
 *   "data": { "old_price": ..., "new_price": ..., "period": ... },
 *   "error": null | "error message"
 * }
 *
 * Version: 1.0.0
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

chromium.use(StealthPlugin());

// ─── Config ───────────────────────────────────────────────────────────────────
const PROXY = {
  server: 'http://nl.decodo.com:10001',
  username: 'spx615l7f1',
  password: 'BHrGlyvt9mRqv2=j62'
};

const SUPABASE_URL = 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TASK_ID = process.env.BROWSER_TASK_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format date from YYYY-MM-DD to DD-MM-YYYY (Bol.com format)
 */
function formatDateBol(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}

/**
 * Format price to Dutch locale string (e.g. 48.95 → "48,95")
 */
function formatPriceBol(price) {
  return price.toFixed(2).replace('.', ',');
}

/**
 * Wait and retry helper
 */
async function waitAndRetry(fn, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`[price-update] Retry ${i + 1}/${retries}...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  let browser;
  const result = { success: false, data: null, error: null };

  try {
    // ── 1. Load task parameters ───────────────────────────────────────────
    let taskParams;
    if (TASK_ID) {
      const { data: task, error } = await supabase
        .from('Browser_Tasks')
        .select('actions')
        .eq('id', TASK_ID)
        .single();
      if (error) throw new Error(`Failed to load task: ${error.message}`);
      taskParams = typeof task.actions === 'string' ? JSON.parse(task.actions) : task.actions;
    } else {
      // Allow running standalone with env vars for testing
      taskParams = JSON.parse(process.env.TASK_PARAMS || '{}');
    }

    const { ean, offer_uid, promotional_price, start_date, end_date, action = 'set' } = taskParams;

    if (!ean || !offer_uid) {
      throw new Error('Missing required params: ean, offer_uid');
    }
    if (action === 'set' && (!promotional_price || !start_date || !end_date)) {
      throw new Error('For action "set": promotional_price, start_date, end_date are required');
    }

    console.log(`[price-update] Action: ${action} | Product: ${ean} | Price: €${promotional_price} | Period: ${start_date} → ${end_date}`);

    // ── 2. Launch stealth browser ─────────────────────────────────────────
    const storageStatePath = path.join(__dirname, 'bol-storage-state.json');
    if (!fs.existsSync(storageStatePath)) {
      throw new Error('bol-storage-state.json not found. Run convert-cookies.js first.');
    }
    const storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));

    browser = await chromium.launch({
      headless: true,
      proxy: PROXY,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'nl-NL',
    });

    if (storageState.cookies && storageState.cookies.length > 0) {
      await context.addCookies(storageState.cookies);
    }

    const page = await context.newPage();

    // ── 3. Navigate to product pricing page ───────────────────────────────
    const productUrl = `https://partner.bol.com/sdd/assortment-new/product/${ean}/?offerUid=${offer_uid}`;
    console.log(`[price-update] Navigating to: ${productUrl}`);

    await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Check login
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('accounts.bol.com')) {
      throw new Error('Not logged in — cookies expired. Refresh bol-storage-state.json.');
    }
    console.log('[price-update] Logged in ✅');

    // Wait for pricing section to load
    await page.waitForTimeout(3000);

    // ── 4. Scroll to "Tijdelijke prijs" section ──────────────────────────
    const tijdelijkePrijsHeader = page.locator('text=Tijdelijke prijs').first();
    await tijdelijkePrijsHeader.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    // ── 5. Handle action ──────────────────────────────────────────────────
    if (action === 'remove') {
      // ── REMOVE: Click the delete (trash) button ──────────────────────
      console.log('[price-update] Removing existing promotional price...');
      
      const deleteBtn = page.locator('[data-testid="delete-promotional-price"], button:has(svg[data-testid="DeleteIcon"]), .tijdelijke-prijs button[aria-label*="verwijder" i]').first();
      
      // Fallback: look for trash icon near "Tijdelijke prijs" section
      if (!(await deleteBtn.isVisible().catch(() => false))) {
        // Try the trash icon button that's visible in the UI
        const trashBtn = page.locator('section:has-text("Tijdelijke prijs") button:last-of-type').first();
        if (await trashBtn.isVisible().catch(() => false)) {
          await trashBtn.click();
        } else {
          throw new Error('Could not find delete button for promotional price');
        }
      } else {
        await deleteBtn.click();
      }

      // Confirm deletion if dialog appears
      await page.waitForTimeout(1000);
      const confirmBtn = page.locator('button:has-text("Bevestigen"), button:has-text("Verwijderen"), button:has-text("Ja")').first();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
      }

      // Wait for save and look for the save/submit button
      await page.waitForTimeout(1000);
      await clickSaveIfExists(page);

      result.success = true;
      result.data = { action: 'removed', ean, offer_uid };
      console.log('[price-update] Promotional price removed ✅');

    } else {
      // ── SET: Create or update promotional price ──────────────────────
      console.log('[price-update] Setting promotional price...');

      // Check if there's already a promotional price row
      const existingPriceInput = page.locator('section:has-text("Tijdelijke prijs") input[type="text"], section:has-text("Tijdelijke prijs") input[type="number"]').first();
      const addButton = page.locator('text=Tijdelijke prijs toevoegen').first();

      let priceInput;

      if (await existingPriceInput.isVisible().catch(() => false)) {
        // Existing promo — update the price field
        console.log('[price-update] Found existing promotional price — updating...');
        priceInput = existingPriceInput;
      } else if (await addButton.isVisible().catch(() => false)) {
        // No existing promo — click "Tijdelijke prijs toevoegen"
        console.log('[price-update] No existing promo — adding new...');
        await addButton.click();
        await page.waitForTimeout(2000);
        priceInput = page.locator('section:has-text("Tijdelijke prijs") input[type="text"], section:has-text("Tijdelijke prijs") input[type="number"]').first();
      } else {
        throw new Error('Could not find promotional price section or add button');
      }

      // ── Fill in the price ────────────────────────────────────────────
      // Read old price first
      const oldValue = await priceInput.inputValue().catch(() => '');
      console.log(`[price-update] Old price value: ${oldValue}`);

      // Clear and type new price
      await priceInput.click({ clickCount: 3 }); // Select all
      await page.waitForTimeout(200);
      await priceInput.fill(formatPriceBol(promotional_price));
      await page.waitForTimeout(500);
      // Tab out to trigger validation
      await priceInput.press('Tab');
      await page.waitForTimeout(500);

      // ── Fill in the dates ────────────────────────────────────────────
      // Find the date/period element — it could be a date picker or text input
      const periodSection = page.locator('section:has-text("Tijdelijke prijs")');
      
      // Try to find date inputs or the period edit button (calendar icon)
      const calendarBtn = periodSection.locator('button:has(svg), [aria-label*="datum" i], [aria-label*="kalender" i], [data-testid*="calendar"], [data-testid*="date"]').first();
      
      if (await calendarBtn.isVisible().catch(() => false)) {
        console.log('[price-update] Found calendar button — clicking...');
        await calendarBtn.click();
        await page.waitForTimeout(1000);

        // Fill start and end date in the date picker
        const dateInputs = page.locator('input[type="date"], input[placeholder*="dd"], input[aria-label*="datum" i]');
        const dateCount = await dateInputs.count();
        
        if (dateCount >= 2) {
          // Start date
          await dateInputs.nth(0).click({ clickCount: 3 });
          await dateInputs.nth(0).fill(formatDateBol(start_date));
          await page.waitForTimeout(300);
          
          // End date
          await dateInputs.nth(1).click({ clickCount: 3 });
          await dateInputs.nth(1).fill(formatDateBol(end_date));
          await page.waitForTimeout(300);
        } else {
          // Single date range input
          const dateInput = dateInputs.first();
          if (await dateInput.isVisible().catch(() => false)) {
            await dateInput.click({ clickCount: 3 });
            await dateInput.fill(`${formatDateBol(start_date)} - ${formatDateBol(end_date)}`);
          }
        }

        // Confirm date selection if there's a confirm button in the picker
        const dateConfirmBtn = page.locator('.date-picker button:has-text("Bevestig"), .date-picker button:has-text("OK"), [role="dialog"] button:has-text("Bevestig")').first();
        if (await dateConfirmBtn.isVisible().catch(() => false)) {
          await dateConfirmBtn.click();
        }
      } else {
        console.log('[price-update] No calendar button found — dates may already be set or use different UI');
        // Try direct text input for dates
        const allInputs = await periodSection.locator('input').all();
        console.log(`[price-update] Found ${allInputs.length} inputs in section`);
        
        // If there are date-like inputs beyond the price input
        for (let i = 1; i < allInputs.length; i++) {
          const placeholder = await allInputs[i].getAttribute('placeholder').catch(() => '');
          const type = await allInputs[i].getAttribute('type').catch(() => '');
          console.log(`[price-update] Input ${i}: type=${type} placeholder=${placeholder}`);
        }
      }

      await page.waitForTimeout(1000);

      // ── Click Save ───────────────────────────────────────────────────
      await clickSaveIfExists(page);

      // ── Take screenshot for verification ─────────────────────────────
      const screenshotPath = path.join(__dirname, `price-update-${ean}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`[price-update] Screenshot saved: ${screenshotPath}`);

      // ── Verify: re-read the price section ────────────────────────────
      await page.waitForTimeout(2000);
      
      // Check for success indicators
      const statusBadge = periodSection.locator('text=Actief').first();
      const isActive = await statusBadge.isVisible().catch(() => false);

      result.success = true;
      result.data = {
        action: 'set',
        ean,
        offer_uid,
        old_price: oldValue,
        new_price: formatPriceBol(promotional_price),
        period: `${start_date} → ${end_date}`,
        verified_active: isActive,
        screenshot: screenshotPath
      };
      console.log(`[price-update] Price set: €${formatPriceBol(promotional_price)} (${start_date} → ${end_date}) ${isActive ? '✅ Actief' : '⚠️ Status unknown'}`);
    }

  } catch (err) {
    console.error('[price-update] Error:', err.message);
    result.error = err.message;

    // Try to take error screenshot
    try {
      if (browser) {
        const pages = browser.contexts()[0]?.pages();
        if (pages && pages.length > 0) {
          await pages[0].screenshot({ path: path.join(__dirname, `price-update-error-${Date.now()}.png`) });
        }
      }
    } catch (_) {}

  } finally {
    if (browser) await browser.close();

    // Write result back to Browser_Tasks
    if (TASK_ID) {
      await supabase
        .from('Browser_Tasks')
        .update({
          status: result.success ? 'completed' : 'failed',
          result: result,
          error_message: result.error,
          completed_at: new Date().toISOString()
        })
        .eq('id', TASK_ID);
    }

    console.log('[price-update] Done:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  }
})();

// ─── Helper: Find and click the save button ───────────────────────────────────
async function clickSaveIfExists(page) {
  // Try various save button selectors (Bol.com uses different button styles)
  const saveSelectors = [
    'button:has-text("Opslaan")',
    'button:has-text("Wijzigingen opslaan")',
    'button:has-text("Bevestigen")',
    'button:has-text("Prijzen opslaan")',
    'button[type="submit"]',
    '[data-testid="save-button"]',
    '[data-testid="submit-button"]',
  ];

  for (const selector of saveSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible().catch(() => false)) {
      console.log(`[price-update] Found save button: ${selector}`);
      await btn.click();
      await page.waitForTimeout(3000);

      // Check for error messages after save
      const errorMsg = page.locator('.error, [role="alert"], .notification--error').first();
      if (await errorMsg.isVisible().catch(() => false)) {
        const errorText = await errorMsg.textContent().catch(() => 'Unknown error');
        console.warn(`[price-update] Warning after save: ${errorText}`);
      }
      return true;
    }
  }

  console.log('[price-update] No save button found — page may auto-save or use RSC actions');
  
  // Fallback: press Enter to submit
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  
  return false;
}
