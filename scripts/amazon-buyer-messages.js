/**
 * amazon-buyer-messages.js v1.0.0
 * Standalone script — scrapes buyer messages from Amazon Seller Central
 * 
 * Uses:
 *   - playwright-extra + stealth plugin (headless detection bypass)
 *   - Decodo NL residential proxy (IP trust + geo)
 *   - amazon-storage-state.json (real session cookies, no 2FA)
 * 
 * Strategy:
 *   1. Intercept all XHR/fetch calls to capture Amazon's internal API responses
 *   2. Navigate to messaging inbox (React SPA — needs networkidle wait)
 *   3. DOM scrape as secondary extraction
 *   4. Debug screenshot + HTML dump always written (for selector tuning)
 *   5. Results written to amazon-messages-data.json
 * 
 * Dependencies: playwright-extra, puppeteer-extra-plugin-stealth
 * Install: npm install playwright-extra puppeteer-extra-plugin-stealth
 * 
 * Runs standalone via playwright-task-executor.js
 * Storage state expected at: __dirname/amazon-storage-state.json
 * Output written to: __dirname/amazon-messages-data.json
 */

'use strict';

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

// Stealth — blocks headless detection, WebDriver flag, plugin enumeration, etc.
chromium.use(StealthPlugin());

// ── Config ────────────────────────────────────────────────────────────────────

// Decodo NL residential proxy — same as bol.com scraper
// NL proxy works fine for Amazon EU marketplaces (same seller account)
const PROXY_CONFIG = {
    server: 'http://nl.decodo.com:10001',
    username: 'spx615l7f1',
    password: 'BHrGlyvt9mRqv2=j62'
};

// Marketplace to scrape — change to .de / .nl / .fr if needed
// Cookies must have been exported from this same marketplace session
const AMAZON_BASE = 'https://sellercentral.amazon.co.uk';
const INBOX_URL = `${AMAZON_BASE}/messaging/inbox`;

// Files — executor downloads scripts to its own __dirname
const STORAGE_STATE_PATH = path.join(__dirname, 'amazon-storage-state.json');
const OUTPUT_PATH = path.join(__dirname, 'amazon-messages-data.json');
const DEBUG_SCREENSHOT_PATH = path.join(__dirname, 'amazon-messages-debug.png');
const DEBUG_HTML_PATH = path.join(__dirname, 'amazon-inbox-debug.html');

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
    const results = {
        success: false,
        scraped_at: new Date().toISOString(),
        marketplace: 'amazon.co.uk',
        messages: [],
        unread_count: 0,
        api_endpoints_captured: [],
        api_data_raw: [],
        errors: []
    };

    let browser;
    try {
        // Verify cookies exist
        if (!fs.existsSync(STORAGE_STATE_PATH)) {
            throw new Error(`Cookie file not found: ${STORAGE_STATE_PATH}. Run convert-amazon-cookies.js first.`);
        }

        console.log('[amazon-messages] Launching stealth browser with Decodo NL proxy...');
        browser = await chromium.launch({
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--lang=en-GB,en',
                // Prevent automation detection via navigator.webdriver
                '--disable-automation',
            ]
        });

        console.log('[amazon-messages] Loading amazon-storage-state.json...');
        const context = await browser.newContext({
            storageState: STORAGE_STATE_PATH,
            // Match the real browser profile from when cookies were exported
            viewport: { width: 1920, height: 1080 },
            locale: 'en-GB',
            timezoneId: 'Europe/London',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            extraHTTPHeaders: {
                'Accept-Language': 'en-GB,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            },
            proxy: {
                server: PROXY_CONFIG.server,
                username: PROXY_CONFIG.username,
                password: PROXY_CONFIG.password
            }
        });

        // ── Network Interception ─────────────────────────────────────────────
        // Amazon SC messaging is a React SPA — real data comes via XHR/fetch
        // Capture all JSON API responses for analysis (even if DOM selectors fail)
        context.on('response', async (response) => {
            const url = response.url();
            const contentType = response.headers()['content-type'] || '';
            
            // Capture messaging-related API calls
            const isRelevant = (
                url.includes('/messaging/') ||
                url.includes('/voicemail/') ||
                url.includes('/buyer-seller-messaging/') ||
                url.includes('/myi/communications/') ||
                url.includes('/gc/messaging/')
            ) && contentType.includes('application/json');

            if (isRelevant) {
                try {
                    const json = await response.json();
                    results.api_endpoints_captured.push(url);
                    results.api_data_raw.push({ url, status: response.status(), data: json });
                    console.log(`[amazon-messages] ✓ API captured: ${url} (${response.status()})`);
                } catch (e) {
                    // Not parseable JSON — ignore
                }
            }
        });

        const page = await context.newPage();

        // ── Navigate to Inbox ────────────────────────────────────────────────
        console.log(`[amazon-messages] Navigating to ${INBOX_URL}...`);
        await page.goto(INBOX_URL, {
            waitUntil: 'networkidle',  // Wait for React SPA + XHR to settle
            timeout: 60000
        });

        // Extra wait for dynamic content
        await page.waitForTimeout(5000);

        // Check login status
        const currentUrl = page.url();
        console.log(`[amazon-messages] Current URL: ${currentUrl}`);

        if (
            currentUrl.includes('/ap/signin') ||
            currentUrl.includes('/signin') ||
            currentUrl.includes('login') ||
            currentUrl.includes('auth-page')
        ) {
            throw new Error('Session expired — redirected to login. Re-export cookies via Cookie-Editor from amazon seller central.');
        }

        // Detect marketplace switch prompt (Amazon sometimes asks when switching)
        const hasSwitchPrompt = await page.$('[id*="switch"], [class*="switch-account"], [data-testid*="switch"]');
        if (hasSwitchPrompt) {
            console.log('[amazon-messages] ⚠️ Marketplace switch prompt detected — staying on current marketplace');
        }

        // ── Debug Artifacts ──────────────────────────────────────────────────
        // Always save screenshot + HTML — essential for tuning selectors
        console.log('[amazon-messages] Saving debug screenshot + HTML...');
        await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
        const pageHtml = await page.content();
        fs.writeFileSync(DEBUG_HTML_PATH, pageHtml);
        console.log(`[amazon-messages] Debug files saved: ${DEBUG_SCREENSHOT_PATH}`);

        // ── DOM Extraction ───────────────────────────────────────────────────
        // Amazon messaging inbox selectors — may need tuning after first run
        // If messages = 0, check amazon-inbox-debug.html for real class names
        console.log('[amazon-messages] Extracting messages from DOM...');
        const messages = await page.evaluate(() => {
            const msgs = [];

            // Broad selector net — Amazon changes class names frequently
            const candidateSelectors = [
                '[class*="message-row"]',
                '[class*="inbox-row"]',
                '[class*="thread-item"]',
                '[class*="conversation-row"]',
                '[class*="MessageList"] > *',
                '[data-testid*="message-row"]',
                '[data-testid*="inbox-item"]',
                'tr[class*="message"]',
                'li[class*="message"]',
                'div[class*="Message"][class*="item"]'
            ];

            let rows = [];
            for (const sel of candidateSelectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) {
                    rows = Array.from(found);
                    console.log(`Found ${rows.length} rows with selector: ${sel}`);
                    break;
                }
            }

            rows.forEach((row, i) => {
                // Try to find key data points — broad attribute matching
                const getText = (selectors) => {
                    for (const s of selectors) {
                        const el = row.querySelector(s);
                        if (el) return el.textContent?.trim() || null;
                    }
                    return null;
                };

                const getHref = () => {
                    const link = row.querySelector('a[href*="messaging"], a[href*="communication"]');
                    return link?.href || row.querySelector('a')?.href || null;
                };

                const subject = getText(['[class*="subject"]', '[class*="title"]', 'h3', 'h4', 'strong']);
                const sender = getText(['[class*="sender"]', '[class*="buyer"]', '[class*="from"]', '[class*="name"]']);
                const date = getText(['[class*="date"]', '[class*="time"]', 'time', '[class*="received"]']);
                const orderId = getText(['[class*="order"]', '[class*="asin"]']);
                const preview = getText(['[class*="preview"]', '[class*="excerpt"]', '[class*="body"]', 'p']);
                const isUnread = row.getAttribute('data-read') === 'false' 
                    || row.classList.toString().includes('unread')
                    || !!row.querySelector('[class*="unread"]');
                const href = getHref();

                // Extract order ID from URL if not found in DOM
                const orderFromHref = href?.match(/[A-Z0-9]{3}-[0-9]{7}-[0-9]{7}/)?.[0] || null;

                msgs.push({
                    index: i,
                    subject,
                    sender,
                    date,
                    orderId: orderId || orderFromHref,
                    preview,
                    isUnread,
                    href
                });
            });

            return msgs;
        });

        results.messages = messages.filter(m => m.subject || m.sender || m.href);
        results.unread_count = results.messages.filter(m => m.isUnread).length;

        console.log(`[amazon-messages] DOM extraction: ${results.messages.length} messages (${results.unread_count} unread)`);

        if (results.messages.length === 0 && results.api_data_raw.length === 0) {
            results.errors.push(
                'No messages found via DOM or API interception. ' +
                'Check amazon-messages-debug.png + amazon-inbox-debug.html for real selectors. ' +
                'Possible causes: wrong marketplace URL, page loaded differently, or inbox is empty.'
            );
        }

        results.success = true;

    } catch (err) {
        console.error(`[amazon-messages] FATAL: ${err.message}`);
        results.errors.push(err.message);
        results.success = false;
    } finally {
        if (browser) await browser.close();
    }

    // Write results JSON
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
    console.log(`[amazon-messages] Results → ${OUTPUT_PATH}`);
    console.log(`[amazon-messages] Summary: success=${results.success}, messages=${results.messages.length}, apis_captured=${results.api_endpoints_captured.length}`);

    return results;
}

run().catch(err => {
    console.error('[amazon-messages] Unhandled error:', err);
    process.exit(1);
});
