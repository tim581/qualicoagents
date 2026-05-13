/**
 * bol-cases-scrape.js — Bol.com Partner Portal Cases Scraper
 * Version: 1.1.0 — standalone mode (no module.exports)
 * 
 * Scrapes open/new customer cases from bol.com partner portal
 * Uses stealth mode + Decodo residential proxy (NL) for anti-detection
 * 
 * Dependencies: playwright-extra, puppeteer-extra-plugin-stealth
 * Install: npm install playwright-extra puppeteer-extra-plugin-stealth
 * 
 * Runs as standalone script via playwright-task-executor.js
 * Writes result JSON to bol-cases-scrape-data.json for executor pickup
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

// Add stealth plugin — blocks headless detection, WebDriver flag, etc.
chromium.use(StealthPlugin());

// Decodo NL residential proxy
const PROXY_CONFIG = {
    server: 'http://nl.decodo.com:10001',
    username: 'spx615l7f1',
    password: 'BHrGlyvt9mRqv2=j62'
};

// Bol.com internal API endpoints (discovered via partner portal)
const BOL_API_BASE = 'https://partner.bol.com/sdd/cases/api';
const ENDPOINTS = {
    counts: `${BOL_API_BASE}/cases/counts`,
    openCases: `${BOL_API_BASE}/cases?case-category=OPEN&page=1&page-size=50`,
    newCases: `${BOL_API_BASE}/cases?case-category=NEW&page=1&page-size=50`,
    caseDetail: (id) => `${BOL_API_BASE}/cases/${id}`,
    caseEmail: (caseId, mailerId) => `${BOL_API_BASE}/cases/${caseId}/emails/${mailerId}`,
    templates: `${BOL_API_BASE}/templates`
};

// Storage state path (cookies + localStorage from bol-partner-save-cookies.js)
const STORAGE_STATE_PATH = path.join(__dirname, '..', 'bol-storage-state.json');
// Output file — executor picks this up automatically
const OUTPUT_PATH = path.join(__dirname, 'bol-cases-scrape-data.json');

async function run() {
    const results = {
        success: false,
        scraped_at: new Date().toISOString(),
        counts: null,
        open_cases: [],
        new_cases: [],
        case_details: [],
        errors: []
    };

    let browser;
    try {
        // Verify storage state exists
        if (!fs.existsSync(STORAGE_STATE_PATH)) {
            throw new Error(`Storage state not found at ${STORAGE_STATE_PATH}. Run bol-partner-save-cookies.js first.`);
        }

        console.log('[bol-cases] Launching stealth browser with Decodo NL proxy...');
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
                '--lang=nl-NL,nl'
            ],
            proxy: {
                server: PROXY_CONFIG.server,
                username: PROXY_CONFIG.username,
                password: PROXY_CONFIG.password
            }
        });

        // Load saved cookies/session
        console.log('[bol-cases] Loading storage state (cookies)...');
        const context = await browser.newContext({
            storageState: STORAGE_STATE_PATH,
            viewport: { width: 1920, height: 1080 },
            locale: 'nl-NL',
            timezoneId: 'Europe/Amsterdam',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            extraHTTPHeaders: {
                'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
                'Accept': 'application/json, text/plain, */*',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin'
            }
        });

        const page = await context.newPage();

        // Navigate to partner portal first (activates cookies in browser context)
        console.log('[bol-cases] Navigating to partner portal...');
        await page.goto('https://partner.bol.com/sdd/cases', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        
        // Wait for page to settle
        await page.waitForTimeout(3000);

        // Check if we're still logged in (not redirected to login)
        const currentUrl = page.url();
        if (currentUrl.includes('login') || currentUrl.includes('inloggen')) {
            throw new Error('Session expired — redirected to login page. Run bol-partner-save-cookies.js to refresh cookies.');
        }

        console.log(`[bol-cases] On page: ${currentUrl}`);

        // 1. Get case counts
        console.log('[bol-cases] Fetching case counts...');
        try {
            const countsResponse = await page.request.get(ENDPOINTS.counts, { timeout: 15000 });
            if (countsResponse.ok()) {
                results.counts = await countsResponse.json();
                console.log(`[bol-cases] Counts: ${JSON.stringify(results.counts)}`);
            } else {
                results.errors.push(`Counts API returned ${countsResponse.status()}`);
            }
        } catch (e) {
            results.errors.push(`Counts fetch failed: ${e.message}`);
        }

        // 2. Get OPEN cases
        console.log('[bol-cases] Fetching OPEN cases...');
        try {
            const openResponse = await page.request.get(ENDPOINTS.openCases, { timeout: 15000 });
            if (openResponse.ok()) {
                const openData = await openResponse.json();
                results.open_cases = openData.cases || openData || [];
                console.log(`[bol-cases] Open cases: ${results.open_cases.length}`);
            } else {
                results.errors.push(`Open cases API returned ${openResponse.status()}`);
            }
        } catch (e) {
            results.errors.push(`Open cases fetch failed: ${e.message}`);
        }

        // 3. Get NEW cases (unread/unhandled)
        console.log('[bol-cases] Fetching NEW cases...');
        try {
            const newResponse = await page.request.get(ENDPOINTS.newCases, { timeout: 15000 });
            if (newResponse.ok()) {
                const newData = await newResponse.json();
                results.new_cases = newData.cases || newData || [];
                console.log(`[bol-cases] New cases: ${results.new_cases.length}`);
            } else {
                // NEW category might not exist — not an error
                console.log(`[bol-cases] New cases returned ${newResponse.status()} — may not have NEW category`);
            }
        } catch (e) {
            console.log(`[bol-cases] New cases fetch skipped: ${e.message}`);
        }

        // 4. Fetch details + emails for each case (open + new combined, deduplicated)
        const allCases = [...results.open_cases, ...results.new_cases];
        const seenIds = new Set();
        const uniqueCases = allCases.filter(c => {
            const id = c.caseId || c.id;
            if (seenIds.has(id)) return false;
            seenIds.add(id);
            return true;
        });

        console.log(`[bol-cases] Fetching details for ${uniqueCases.length} unique cases...`);
        
        for (const cs of uniqueCases) {
            const caseId = cs.caseId || cs.id;
            try {
                // Get case detail
                const detailResponse = await page.request.get(ENDPOINTS.caseDetail(caseId), { timeout: 15000 });
                if (!detailResponse.ok()) {
                    results.errors.push(`Case ${caseId} detail returned ${detailResponse.status()}`);
                    continue;
                }
                const detail = await detailResponse.json();

                // Get email bodies for each event with a conversationMailerId
                const events = detail.events || [];
                const emails = [];
                for (const evt of events) {
                    if (evt.conversationMailerId) {
                        try {
                            const emailResponse = await page.request.get(
                                ENDPOINTS.caseEmail(caseId, evt.conversationMailerId),
                                { timeout: 15000 }
                            );
                            if (emailResponse.ok()) {
                                const emailData = await emailResponse.json();
                                emails.push({
                                    conversationMailerId: evt.conversationMailerId,
                                    direction: evt.direction || evt.type,
                                    date: evt.date || evt.createdAt,
                                    body: emailData.body || emailData.htmlBody || emailData
                                });
                            }
                        } catch (emailErr) {
                            // Non-critical — continue
                            console.log(`[bol-cases] Email fetch failed for case ${caseId}, mailer ${evt.conversationMailerId}`);
                        }
                    }
                }

                results.case_details.push({
                    caseId,
                    status: detail.status,
                    category: detail.category,
                    customerName: detail.customerName || detail.customer?.name,
                    customerLanguage: detail.customerLanguage || detail.customer?.language,
                    productTitle: detail.productTitle || detail.product?.title,
                    productEan: detail.productEan || detail.product?.ean,
                    orderId: detail.orderId || detail.order?.id,
                    trackingCode: detail.trackingCode,
                    createdAt: detail.createdAt || detail.created,
                    lastUpdatedAt: detail.lastUpdatedAt || detail.lastUpdated,
                    events: events.length,
                    emails
                });

                // Small delay between requests to avoid rate limiting
                await page.waitForTimeout(500);

            } catch (e) {
                results.errors.push(`Case ${caseId} processing failed: ${e.message}`);
            }
        }

        results.success = true;
        console.log(`[bol-cases] Done! ${results.case_details.length} cases scraped with full details.`);

    } catch (error) {
        results.errors.push(`Fatal error: ${error.message}`);
        console.error(`[bol-cases] Fatal: ${error.message}`);
    } finally {
        if (browser) await browser.close();
    }

    return results;
}

// ── STANDALONE EXECUTION ──────────────────────────────────────────────
// No module.exports — executor detects this and runs with `node`
run().then(results => {
    // Write JSON output file for executor pickup
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
    console.log(`[bol-cases] Results written to ${OUTPUT_PATH}`);
    
    // Also log summary to stdout
    console.log(`\n=== SUMMARY ===`);
    console.log(`Success: ${results.success}`);
    console.log(`Counts: ${JSON.stringify(results.counts)}`);
    console.log(`Open cases: ${results.open_cases.length}`);
    console.log(`New cases: ${results.new_cases.length}`);
    console.log(`Details scraped: ${results.case_details.length}`);
    console.log(`Errors: ${results.errors.length}`);
    if (results.errors.length > 0) {
        console.log(`Error details: ${results.errors.join('; ')}`);
    }
    
    process.exit(results.success ? 0 : 1);
}).catch(err => {
    console.error(`[bol-cases] Unhandled error: ${err.message}`);
    process.exit(1);
});
