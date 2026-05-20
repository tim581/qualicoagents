/**
 * amazon-buyer-messages.js  v2.0.0
 * Standalone script — scrapes buyer messages from Amazon Seller Central
 *
 * Uses:
 *   - playwright-extra + stealth plugin (headless detection bypass)
 *   - Decodo NL residential proxy (IP trust + geo)
 *   - amazon-storage-state.json (real session cookies, no 2FA)
 *   - dbLog + dbShot → Flieber_Debug_Log in Supabase (remote debugging)
 *
 * Strategy:
 *   1. Intercept all XHR/fetch calls to capture Amazon's internal API responses
 *   2. Navigate to messaging inbox (React SPA — domcontentloaded + settle)
 *   3. DOM scrape as secondary extraction
 *   4. Debug screenshots + logs always pushed to Supabase
 *   5. Results written to Browser_Tasks.result
 *
 * Dependencies: playwright-extra, puppeteer-extra-plugin-stealth
 * Install: npm install playwright-extra puppeteer-extra-plugin-stealth
 *
 * Runs standalone via playwright-task-executor.js
 * Storage state expected at: __dirname/amazon-storage-state.json
 */

'use strict';

require('dotenv').config();
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

// Stealth — blocks headless detection, WebDriver flag, plugin enumeration
chromium.use(StealthPlugin());

// ── Config ────────────────────────────────────────────────────────────────────

const PROXY_CONFIG = {
    server: 'http://nl.decodo.com:10001',
    username: 'spx615l7f1',
    password: 'BHrGlyvt9mRqv2=j62'
};

const AMAZON_BASE = 'https://sellercentral.amazon.co.uk';
const INBOX_URL = `${AMAZON_BASE}/messaging/inbox`;

const STORAGE_STATE_PATH = path.join(__dirname, 'amazon-storage-state.json');

// ── SELF-DEBUGGING: SUPABASE LOG ──────────────────────────────────────────────

const RUN_ID = `amz_msg_${Date.now()}`;
console.log(`🔍 Debug run ID: ${RUN_ID}`);
console.log(`   → Query: SELECT * FROM "Flieber_Debug_Log" WHERE run_id = '${RUN_ID}'\n`);

async function dbLog(step, status, message) {
    const short = (message || '').toString().substring(0, 3000);
    console.log(`  [DB:${status}] ${step}: ${short.substring(0, 120)}`);
    try {
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ run_id: RUN_ID, step, status, message: short }),
        });
    } catch (e) { /* never break the main flow */ }
}

async function dbShot(page, step, label) {
    try {
        const buf = await page.screenshot({ fullPage: true });
        const b64 = buf.toString('base64').substring(0, 400000);
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ run_id: RUN_ID, step, status: 'screenshot', message: label, screenshot: b64 }),
        });
        console.log(`  📸 Screenshot → ${step} (${label})`);
    } catch (e) { /* never break the main flow */ }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
    const results = {
        success: false,
        run_id: RUN_ID,
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
        // ── Verify cookies exist ────────────────────────────────────────────
        if (!fs.existsSync(STORAGE_STATE_PATH)) {
            throw new Error(`Cookie file not found: ${STORAGE_STATE_PATH}. Run convert-amazon-cookies.js first.`);
        }
        await dbLog('init', 'info', `Cookie file found. Starting stealth browser with Decodo NL proxy...`);

        // ── Launch stealth browser ──────────────────────────────────────────
        // headless: false — Tim wants to watch during debugging
        browser = await chromium.launch({
            headless: false,
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
                '--disable-automation',
            ]
        });

        await dbLog('browser', 'success', 'Stealth browser launched');

        // ── Create context with cookies + proxy ─────────────────────────────
        const storageState = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf-8'));

        const context = await browser.newContext({
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

        // Add cookies from storage state
        if (storageState.cookies && storageState.cookies.length > 0) {
            await context.addCookies(storageState.cookies);
            await dbLog('cookies', 'success', `Loaded ${storageState.cookies.length} cookies from storage state`);
        } else {
            throw new Error('No cookies found in amazon-storage-state.json');
        }

        // ── Network Interception ────────────────────────────────────────────
        // Capture ALL JSON responses — Amazon might load data via internal APIs
        context.on('response', async (response) => {
            const url = response.url();
            const contentType = response.headers()['content-type'] || '';

            const isRelevant = (
                url.includes('/messaging/') ||
                url.includes('/buyer-seller-messaging/') ||
                url.includes('/myi/communications/') ||
                url.includes('/gc/messaging/') ||
                url.includes('/communication')
            ) && contentType.includes('json');

            if (isRelevant) {
                try {
                    const json = await response.json();
                    results.api_endpoints_captured.push(url);
                    results.api_data_raw.push({ url, status: response.status(), data: json });
                    await dbLog('api-intercept', 'info', `Captured: ${url} (${response.status()})`);
                } catch (e) { /* not JSON */ }
            }
        });

        const page = await context.newPage();

        // ── Navigate to Inbox ───────────────────────────────────────────────
        await dbLog('navigate', 'info', `Going to ${INBOX_URL}...`);

        // ⚠️ CRITICAL: domcontentloaded, NOT networkidle — SPA will hang forever with networkidle
        await page.goto(INBOX_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // Settle wait for React SPA to render
        await page.waitForTimeout(8000);

        // ── Check login status ──────────────────────────────────────────────
        const currentUrl = page.url();
        await dbLog('url-check', 'info', `Current URL: ${currentUrl}`);

        if (
            currentUrl.includes('/ap/signin') ||
            currentUrl.includes('/signin') ||
            currentUrl.includes('login') ||
            currentUrl.includes('auth-page')
        ) {
            await dbShot(page, 'login-redirect', 'Redirected to login — cookies expired');
            throw new Error('Session expired — redirected to login. Re-export cookies via Cookie-Editor from Amazon Seller Central.');
        }

        await dbLog('login-check', 'success', 'Still logged in — no redirect to login page');

        // ── First screenshot: what does the page look like? ─────────────────
        await dbShot(page, 'inbox-loaded', 'Page after initial load + 8s settle');

        // ── Log page title and key elements ─────────────────────────────────
        const pageTitle = await page.title();
        await dbLog('page-info', 'info', `Title: "${pageTitle}"`);

        // Log what major elements exist on the page (helps identify real selectors)
        const pageStructure = await page.evaluate(() => {
            const info = {
                title: document.title,
                bodyClasses: document.body.className,
                iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({ src: f.src, id: f.id })),
                mainContainers: [],
                allIds: [],
                interestingClasses: []
            };

            // Find main structural elements
            const mainEls = document.querySelectorAll('main, [role="main"], #main, .main, [id*="content"], [id*="messaging"], [id*="inbox"], [class*="messaging"], [class*="inbox"], [class*="message"]');
            mainEls.forEach(el => {
                info.mainContainers.push({
                    tag: el.tagName,
                    id: el.id,
                    class: el.className?.toString().substring(0, 200),
                    childCount: el.children.length,
                    text: el.textContent?.substring(0, 100)
                });
            });

            // All IDs on the page (useful for discovering Amazon's structure)
            document.querySelectorAll('[id]').forEach(el => {
                if (el.id) info.allIds.push(el.id);
            });

            // Classes containing message/inbox/thread keywords
            document.querySelectorAll('*').forEach(el => {
                const cls = el.className?.toString() || '';
                if (cls.match(/messag|inbox|thread|conversation|communi/i)) {
                    info.interestingClasses.push({
                        tag: el.tagName,
                        class: cls.substring(0, 200),
                        childCount: el.children.length
                    });
                }
            });

            return info;
        });

        // Log structure in chunks (SQL truncates at ~600 chars)
        await dbLog('structure-ids', 'info', `IDs on page: ${JSON.stringify(pageStructure.allIds).substring(0, 2500)}`);
        await dbLog('structure-containers', 'info', `Main containers: ${JSON.stringify(pageStructure.mainContainers).substring(0, 2500)}`);
        await dbLog('structure-classes', 'info', `Message-related classes: ${JSON.stringify(pageStructure.interestingClasses).substring(0, 2500)}`);
        await dbLog('structure-iframes', 'info', `Iframes: ${JSON.stringify(pageStructure.iframes).substring(0, 2500)}`);

        // ── Check if messaging is inside an iframe ──────────────────────────
        // Amazon SC sometimes loads modules in iframes
        const iframes = page.frames();
        await dbLog('frames', 'info', `Page has ${iframes.length} frames: ${iframes.map(f => f.url()).join(', ').substring(0, 2500)}`);

        // Try to find messaging content in any frame
        let messagingFrame = page;
        for (const frame of iframes) {
            const frameUrl = frame.url();
            if (frameUrl.includes('messaging') || frameUrl.includes('communication')) {
                messagingFrame = frame;
                await dbLog('iframe-found', 'info', `Found messaging iframe: ${frameUrl}`);
                await page.waitForTimeout(3000); // let iframe content settle
                break;
            }
        }

        // ── DOM Extraction ──────────────────────────────────────────────────
        await dbLog('dom-extract', 'info', 'Starting DOM extraction with broad selectors...');

        const messages = await messagingFrame.evaluate(() => {
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
                'div[class*="Message"][class*="item"]',
                // Table-based layouts
                'table tbody tr',
                // Generic list items that might contain messages
                '[class*="list"] [class*="item"]',
                '[class*="thread"] [class*="item"]',
            ];

            let rows = [];
            let matchedSelector = 'none';
            for (const sel of candidateSelectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) {
                    rows = Array.from(found);
                    matchedSelector = sel;
                    break;
                }
            }

            // If no specific selector matched, try getting all visible text blocks
            if (rows.length === 0) {
                // Fallback: get the main content area text
                const mainContent = document.querySelector('main, [role="main"], #main-content, [id*="content"]');
                if (mainContent) {
                    return {
                        matchedSelector: 'fallback-main-text',
                        rowCount: 0,
                        messages: [],
                        fallbackText: mainContent.textContent?.substring(0, 3000) || 'empty'
                    };
                }
                return {
                    matchedSelector: 'none',
                    rowCount: 0,
                    messages: [],
                    fallbackText: document.body.textContent?.substring(0, 3000) || 'empty'
                };
            }

            rows.forEach((row, i) => {
                if (i >= 50) return; // cap at 50 messages

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
                const orderFromHref = href?.match(/[A-Z0-9]{3}-[0-9]{7}-[0-9]{7}/)?.[0] || null;

                msgs.push({
                    index: i,
                    subject,
                    sender,
                    date,
                    orderId: orderId || orderFromHref,
                    preview,
                    isUnread,
                    href,
                    rawText: row.textContent?.substring(0, 300) || null
                });
            });

            return {
                matchedSelector,
                rowCount: rows.length,
                messages: msgs
            };
        });

        await dbLog('dom-result', 'info', `Selector: "${messages.matchedSelector}", rows: ${messages.rowCount}`);

        if (messages.fallbackText) {
            // Log fallback text in chunks
            const text = messages.fallbackText;
            for (let i = 0; i < text.length; i += 2500) {
                await dbLog('fallback-text', 'info', `chunk ${Math.floor(i/2500)}: ${text.substring(i, i + 2500)}`);
            }
        }

        if (messages.messages) {
            results.messages = messages.messages.filter(m => m.subject || m.sender || m.href || m.rawText);
            results.unread_count = results.messages.filter(m => m.isUnread).length;
            await dbLog('messages-found', 'info', `${results.messages.length} messages extracted (${results.unread_count} unread)`);

            // Log first few messages for debugging
            for (let i = 0; i < Math.min(results.messages.length, 5); i++) {
                await dbLog(`message-${i}`, 'info', JSON.stringify(results.messages[i]).substring(0, 2500));
            }
        }

        // ── Log captured API data ───────────────────────────────────────────
        if (results.api_endpoints_captured.length > 0) {
            await dbLog('api-summary', 'info', `Captured ${results.api_endpoints_captured.length} API endpoints: ${results.api_endpoints_captured.join(', ').substring(0, 2500)}`);
        } else {
            await dbLog('api-summary', 'warning', 'No messaging API endpoints captured via network interception');
        }

        // ── Final screenshot ────────────────────────────────────────────────
        await dbShot(page, 'final', 'Final page state before close');

        results.success = true;
        await dbLog('complete', 'success', `Done! ${results.messages.length} messages, ${results.api_endpoints_captured.length} APIs captured`);

    } catch (err) {
        console.error(`[amazon-messages] FATAL: ${err.message}`);
        results.errors.push(err.message);
        results.success = false;
        await dbLog('fatal', 'error', err.message);
    } finally {
        if (browser) await browser.close();
        // Give logs time to flush
        await new Promise(r => setTimeout(r, 3000));
    }

    // Return results (executor writes this to Browser_Tasks.result)
    return results;
})();
