/**
 * amazon-buyer-messages.js  v3.2.0
 * READ-ONLY scraper — Amazon Seller Central UK buyer messaging inbox
 *
 * ⚠️ RISK: Automated Seller Central access may violate Amazon ToS and risk
 * account suspension. Run manually first; validate selectors on a live session
 * before scheduling.
 *
 * SP-API: Inbound buyer message read is NOT available via SP-API for this
 * account — browser scrape is the only path for new CS messages.
 *
 * Marketplace: Seller Central UK (sellercentral.amazon.co.uk) — EU buyer messages consolidated in one inbox when logged in via UK portal (stck: EU).
 *
 * Registered task_type: `amazon-buyer-messages` in playwright-task-executor.js
 * and Browser_Task_Registry. Trigger via Browser_Tasks or:
 *   node scripts/amazon-buyer-messages.js
 *
 * Cookie setup (EU Seller Central — amazon.de or amazon.co.uk):
 *   1. Log into Seller Central (e.g. sellercentral.amazon.de), open Messages inbox
 *   2. Export cookies via Cookie-Editor → amazon-cookies-raw.json (repo root)
 *   3. node scripts/convert-amazon-cookies.js → scripts/amazon-storage-state.json
 *
 * Prerequisites:
 *   - scripts/amazon-storage-state.json (from UK Seller Central session above)
 *   - .env with SUPABASE_URL + SUPABASE_KEY (optional, for dbLog/dbShot)
 *
 * Dependencies: playwright-extra, puppeteer-extra-plugin-stealth, dotenv
 */

'use strict';

require('dotenv').config();
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

chromium.use(StealthPlugin());

// ── Config ────────────────────────────────────────────────────────────────────

const PROXY_CONFIG = {
    server: process.env.DECODO_PROXY_SERVER || 'http://nl.decodo.com:10001',
    username: process.env.DECODO_PROXY_USER || 'spx615l7f1',
    password: process.env.DECODO_PROXY_PASS || 'BHrGlyvt9mRqv2=j62'
};

// EU Seller Central — inbox is EU-consolidated (stck: EU). Default DE portal; override with AMAZON_SELLER_CENTRAL_BASE.
const AMAZON_BASE = process.env.AMAZON_SELLER_CENTRAL_BASE || 'https://sellercentral.amazon.de';
const INBOX_URL = `${AMAZON_BASE}/messaging/inbox`; // may redirect to /messaging/inbox-v3
const MARKETPLACE = 'EU'; // inbox is EU-consolidated; session is sellercentral.amazon.co.uk

const STORAGE_STATE_PATH = path.join(__dirname, 'amazon-storage-state.json');
const SEEN_PATH = path.join(__dirname, 'amazon-buyer-messages-seen.json');
const OUTPUT_PATH = path.join(__dirname, 'amazon-buyer-messages-data.json');

const DEFAULT_WEBHOOK_URL =
    'https://webhooks.tasklet.ai/v1/public/webhook/a_dtx9f7xch0bdbrz6ft6m?token=8f58536227c15966d8bc325c9898879d';
const WEBHOOK_URL = process.env.AMAZON_CS_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

const SESSION_CAP_MS = 8 * 60 * 1000; // ~8 min session cap
const ORDER_ID_RE = /\b\d{3}-\d{7}-\d{7}\b/;
const ASIN_RE = /\bB0[A-Z0-9]{8}\b/i;

const RUN_ID = `amz_msg_${Date.now()}`;
console.log(`🔍 Debug run ID: ${RUN_ID}`);
console.log(`   → Query: SELECT * FROM "Flieber_Debug_Log" WHERE run_id = '${RUN_ID}'\n`);

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomDelayMs() {
    return 3000 + Math.floor(Math.random() * 5000); // 3–8s
}

async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function extractOrderId(text) {
    if (!text) return '';
    const m = String(text).match(ORDER_ID_RE);
    return m ? m[0] : '';
}

function extractAsin(text) {
    if (!text) return '';
    const m = String(text).match(ASIN_RE);
    return m ? m[0].toUpperCase() : '';
}

function toIsoTimestamp(raw, fallback) {
    if (!raw) return fallback;
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    return fallback;
}

function stableMessageId(msg) {
    if (msg.threadId) return String(msg.threadId);
    if (msg.href) return String(msg.href);
    const basis = [
        msg.orderId || '',
        msg.sender || '',
        msg.date || '',
        (msg.message || msg.preview || '').substring(0, 120)
    ].join('|');
    return crypto.createHash('sha256').update(basis).digest('hex').substring(0, 32);
}

function loadSeenIds() {
    if (!fs.existsSync(SEEN_PATH)) return new Set();
    try {
        const data = JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8'));
        return new Set(Array.isArray(data.seenIds) ? data.seenIds : []);
    } catch {
        return new Set();
    }
}

function saveSeenIds(seenIds) {
    fs.writeFileSync(
        SEEN_PATH,
        JSON.stringify(
            { seenIds: [...seenIds], lastUpdated: new Date().toISOString() },
            null,
            2
        )
    );
}

async function postToWebhook(payload) {
    const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Webhook HTTP ${res.status}: ${body.substring(0, 300)}`);
    }
}

function buildWebhookPayload(msg, scrapedAt) {
    return {
        platform: 'amazon',
        order_id: msg.orderId || msg.threadId || '',
        sender: msg.sender || '',
        message: msg.message || msg.preview || '',
        asin: msg.asin || '',
        timestamp: toIsoTimestamp(msg.receivedAt || msg.date, scrapedAt)
    };
}

// ── Self-debugging (Supabase) ─────────────────────────────────────────────────

async function dbLog(step, status, message) {
    const short = (message || '').toString().substring(0, 3000);
    console.log(`  [DB:${status}] ${step}: ${short.substring(0, 120)}`);
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return;
    try {
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
            method: 'POST',
            headers: {
                apikey: process.env.SUPABASE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal'
            },
            body: JSON.stringify({ run_id: RUN_ID, step, status, message: short })
        });
    } catch {
        /* never break main flow */
    }
}

async function dbShot(page, step, label) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return;
    try {
        const buf = await page.screenshot({ fullPage: true });
        const b64 = buf.toString('base64').substring(0, 400000);
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
            method: 'POST',
            headers: {
                apikey: process.env.SUPABASE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal'
            },
            body: JSON.stringify({
                run_id: RUN_ID,
                step,
                status: 'screenshot',
                message: label,
                screenshot: b64
            })
        });
        console.log(`  📸 Screenshot → ${step} (${label})`);
    } catch {
        /* never break main flow */
    }
}

async function assertNotBlocked(page) {
    const url = page.url();
    const lowerUrl = url.toLowerCase();

    if (
        lowerUrl.includes('/ap/signin') ||
        lowerUrl.includes('/signin') ||
        lowerUrl.includes('auth-page') ||
        lowerUrl.includes('/ap/mfa') ||
        lowerUrl.includes('approval/request')
    ) {
        await dbShot(page, 'kill-switch', `Blocked URL: ${url}`);
        throw new Error(`Kill-switch: auth/MFA screen detected (${url})`);
    }

    const signals = await page.evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        const title = (document.title || '').toLowerCase();
        return {
            captcha:
                !!document.querySelector('[id*="captcha"], [class*="captcha"], iframe[src*="captcha"]') ||
                text.includes('enter the characters you see') ||
                text.includes('type the characters'),
            mfa:
                text.includes('two-step verification') ||
                text.includes('multi-factor authentication') ||
                text.includes('enter otp') ||
                text.includes('approve the notification') ||
                title.includes('two-step')
        };
    });

    if (signals.captcha || signals.mfa) {
        await dbShot(page, 'kill-switch', 'Captcha or MFA detected on page');
        throw new Error('Kill-switch: captcha or MFA screen detected — manual login required');
    }
}

function parseMessagesFromApi(apiDataRaw) {
    const parsed = [];

    for (const entry of apiDataRaw) {
        const { data } = entry;
        if (!data || typeof data !== 'object') continue;

        const candidates = [];
        if (Array.isArray(data.messages)) candidates.push(...data.messages);
        if (Array.isArray(data.threads)) candidates.push(...data.threads);
        if (Array.isArray(data.conversations)) candidates.push(...data.conversations);
        if (Array.isArray(data.items)) candidates.push(...data.items);
        if (Array.isArray(data.cases)) candidates.push(...data.cases);
        if (Array.isArray(data.globalCases)) candidates.push(...data.globalCases);
        if (Array.isArray(data)) candidates.push(...data);

        for (const item of candidates) {
            if (!item || typeof item !== 'object') continue;
            const subject = item.subject || item.title || item.topic || item.caseTopic || item.topicName || '';
            const preview = item.preview || item.body || item.message || item.text || item.lastMessage || item.snippet || item.summary || '';
            const sender = item.sender || item.buyerName || item.customerName || item.from || item.buyerPseudoName || item.contactName || '';
            const date = item.date || item.receivedAt || item.timestamp || item.createdAt || item.lastUpdatedDate || item.lastMessageDate || '';
            const caseId = item.caseId || item.id || item.conversationId || '';
            const href =
                item.href ||
                item.threadUrl ||
                item.url ||
                (caseId ? `${AMAZON_BASE}/messaging/inbox?cc=${caseId}` : null) ||
                (item.threadId ? `${AMAZON_BASE}/messaging/inbox/${item.threadId}` : null);
            const blob = JSON.stringify(item);
            const orderId =
                item.orderId ||
                item.amazonOrderId ||
                extractOrderId(blob) ||
                extractOrderId(href || '');
            const asin = item.asin || extractAsin(blob) || extractAsin(preview);
            const threadId = item.threadId || caseId || item.conversationId || '';

            if (!subject && !preview && !sender && !href) continue;

            parsed.push({
                threadId: threadId ? String(threadId) : '',
                orderId,
                sender: String(sender || ''),
                subject: String(subject || ''),
                preview: String(preview || ''),
                message: String(preview || subject || ''),
                date: String(date || ''),
                receivedAt: String(date || ''),
                href: href || '',
                asin,
                isUnread: item.isUnread === true || item.unread === true || item.read === false || item.actionNeeded === true,
                source: 'api'
            });
        }
    }

    return parsed;
}

async function scrapeInboxDom(messagingFrame) {
    return messagingFrame.evaluate(({ orderReSource, asinReSource }) => {
        const ORDER_RE = new RegExp(orderReSource);
        const ASIN_RE = new RegExp(asinReSource, 'i');

        const candidateSelectors = [
            '[class*="message-row"]',
            '[class*="inbox-row"]',
            '[class*="thread-item"]',
            '[class*="conversation-row"]',
            '[data-testid*="message-row"]',
            '[data-testid*="inbox-item"]',
            'tr[class*="message"]',
            'li[class*="message"]',
            'table tbody tr',
            '[class*="thread"] [class*="item"]'
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

        const getText = (row, selectors) => {
            for (const s of selectors) {
                const el = row.querySelector(s);
                if (el) return el.textContent?.trim() || null;
            }
            return null;
        };

        const messages = [];
        rows.forEach((row, i) => {
            if (i >= 50) return;

            const href =
                row.querySelector('a[href*="messaging"], a[href*="communication"]')?.href ||
                row.querySelector('a')?.href ||
                null;
            const subject = getText(row, ['[class*="subject"]', '[class*="title"]', 'h3', 'h4', 'strong']);
            const sender = getText(row, ['[class*="sender"]', '[class*="buyer"]', '[class*="from"]', '[class*="name"]']);
            const date = getText(row, ['[class*="date"]', '[class*="time"]', 'time', '[class*="received"]']);
            const orderHint = getText(row, ['[class*="order"]', '[class*="asin"]']);
            const preview = getText(row, ['[class*="preview"]', '[class*="excerpt"]', '[class*="body"]', 'p']);
            const rawText = row.textContent?.substring(0, 500) || '';
            const orderFromText = (rawText.match(ORDER_RE) || [])[0] || '';
            const orderFromHref = (href?.match(ORDER_RE) || [])[0] || '';
            const asinFromText = (rawText.match(ASIN_RE) || [])[0] || '';
            const isUnread =
                row.getAttribute('data-read') === 'false' ||
                row.classList.toString().includes('unread') ||
                !!row.querySelector('[class*="unread"]');

            messages.push({
                threadId: href || `row-${i}`,
                orderId: orderFromText || orderFromHref || extractFromText(orderHint, ORDER_RE),
                sender: sender || '',
                subject: subject || '',
                preview: preview || rawText.substring(0, 300),
                message: preview || subject || rawText.substring(0, 300),
                date: date || '',
                receivedAt: date || '',
                href: href || '',
                asin: asinFromText || extractFromText(orderHint, ASIN_RE),
                isUnread,
                source: 'dom'
            });
        });

        function extractFromText(text, re) {
            if (!text) return '';
            const m = String(text).match(re);
            return m ? m[0] : '';
        }

        return { matchedSelector, rowCount: rows.length, messages };
    }, {
        orderReSource: ORDER_ID_RE.source,
        asinReSource: ASIN_RE.source
    });
}

async function fetchThreadBody(page, href) {
    if (!href) return '';
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(randomDelayMs());
    await assertNotBlocked(page);

    return page.evaluate(() => {
        const selectors = [
            '[class*="message-body"]',
            '[class*="message-content"]',
            '[class*="thread-message"]',
            '[data-testid*="message-body"]',
            'article',
            'main'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el?.textContent?.trim()) return el.textContent.trim().substring(0, 5000);
        }
        return (document.body?.innerText || '').substring(0, 3000);
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
    const startedAt = Date.now();
    const scrapedAt = new Date().toISOString();
    const seenIds = loadSeenIds();

    const results = {
        success: false,
        run_id: RUN_ID,
        browser_task_id: process.env.BROWSER_TASK_ID || null,
        scraped_at: scrapedAt,
        marketplace: MARKETPLACE,
        messages_scraped: 0,
        new_messages: 0,
        webhooks_sent: 0,
        webhooks_failed: 0,
        messages: [],
        webhook_results: [],
        api_endpoints_captured: [],
        errors: []
    };

    let browser;

    try {
        if (!fs.existsSync(STORAGE_STATE_PATH)) {
            throw new Error(
                `Cookie file not found: ${STORAGE_STATE_PATH}. Run: node scripts/convert-amazon-cookies.js`
            );
        }

        await dbLog('init', 'info', 'Launching stealth headed browser with Decodo NL proxy');

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
                '--lang=en-GB,en'
            ],
            proxy: {
                server: PROXY_CONFIG.server,
                username: PROXY_CONFIG.username,
                password: PROXY_CONFIG.password
            }
        });

        const context = await browser.newContext({
            storageState: STORAGE_STATE_PATH,
            viewport: { width: 1920, height: 1080 },
            locale: 'en-GB',
            timezoneId: 'Europe/Berlin',
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            extraHTTPHeaders: {
                'Accept-Language': 'en-GB,en;q=0.9',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
            }
        });

        const apiDataRaw = [];

        context.on('response', async (response) => {
            const url = response.url();
            const contentType = response.headers()['content-type'] || '';
            const isRelevant =
                (url.includes('/messaging/') ||
                    url.includes('/buyer-seller-messaging/') ||
                    url.includes('/myi/communications/') ||
                    url.includes('/gc/messaging/') ||
                    url.includes('/communication')) &&
                contentType.includes('json');

            if (!isRelevant) return;
            try {
                const json = await response.json();
                results.api_endpoints_captured.push(url);
                apiDataRaw.push({ url, status: response.status(), data: json });
            } catch {
                /* not JSON */
            }
        });

        const page = await context.newPage();

        await dbLog('navigate', 'info', `Going to ${INBOX_URL}`);
        await page.goto(INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(randomDelayMs());
        await assertNotBlocked(page);

        await dbShot(page, 'inbox-loaded', 'Inbox after initial load');

        let messagingFrame = page;
        for (const frame of page.frames()) {
            const frameUrl = frame.url();
            if (frameUrl.includes('messaging') || frameUrl.includes('communication')) {
                messagingFrame = frame;
                await dbLog('iframe-found', 'info', `Messaging iframe: ${frameUrl}`);
                await sleep(3000);
                break;
            }
        }

        const domResult = await scrapeInboxDom(messagingFrame);
        await dbLog(
            'dom-result',
            'info',
            `Selector "${domResult.matchedSelector}", rows: ${domResult.rowCount}`
        );

        const apiMessages = parseMessagesFromApi(apiDataRaw);
        const merged = new Map();

        for (const msg of [...domResult.messages, ...apiMessages]) {
            const id = stableMessageId(msg);
            if (!merged.has(id)) merged.set(id, { ...msg, dedupId: id });
        }

        results.messages_scraped = merged.size;
        results.messages = [...merged.values()];

        const newMessages = results.messages.filter((m) => !seenIds.has(m.dedupId));
        results.new_messages = newMessages.length;
        await dbLog('dedup', 'info', `${newMessages.length} new of ${results.messages_scraped} scraped`);

        for (const msg of newMessages) {
            if (Date.now() - startedAt > SESSION_CAP_MS) {
                results.errors.push('Session cap reached — remaining new messages skipped');
                break;
            }

            let fullMessage = msg.message || msg.preview || '';
            if (msg.href && fullMessage.length < 40) {
                try {
                    fullMessage = await fetchThreadBody(page, msg.href);
                    msg.message = fullMessage;
                    await page.goto(INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await sleep(randomDelayMs());
                } catch (err) {
                    results.errors.push(`Thread fetch failed (${msg.href}): ${err.message}`);
                }
            }

            if (!msg.orderId) {
                msg.orderId =
                    extractOrderId(msg.href) ||
                    extractOrderId(fullMessage) ||
                    extractOrderId(msg.subject) ||
                    '';
            }
            if (!msg.asin) {
                msg.asin =
                    extractAsin(fullMessage) ||
                    extractAsin(msg.subject) ||
                    extractAsin(msg.preview) ||
                    '';
            }

            const payload = buildWebhookPayload(msg, scrapedAt);

            try {
                await postToWebhook(payload);
                seenIds.add(msg.dedupId);
                results.webhooks_sent += 1;
                results.webhook_results.push({ dedupId: msg.dedupId, ok: true, payload });
                await dbLog('webhook', 'success', `Sent for ${payload.order_id || msg.dedupId}`);
            } catch (err) {
                results.webhooks_failed += 1;
                results.errors.push(`Webhook failed (${msg.dedupId}): ${err.message}`);
                results.webhook_results.push({
                    dedupId: msg.dedupId,
                    ok: false,
                    error: err.message,
                    payload
                });
                await dbLog('webhook', 'error', err.message);
            }

            await sleep(randomDelayMs());
        }

        saveSeenIds(seenIds);
        await dbShot(page, 'final', 'Final inbox state');
        results.success = results.webhooks_failed === 0;
        await dbLog(
            'complete',
            'success',
            `Done — scraped ${results.messages_scraped}, new ${results.new_messages}, webhooks ${results.webhooks_sent}`
        );
    } catch (err) {
        results.errors.push(err.message);
        results.success = false;
        await dbLog('fatal', 'error', err.message);
        console.error(`[amazon-messages] FATAL: ${err.message}`);
    } finally {
        if (browser) await browser.close();
        await sleep(2000);
    }

    return results;
}

run()
    .then((results) => {
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
        console.log(`[amazon-messages] Results written to ${OUTPUT_PATH}`);
        console.log(JSON.stringify(results));
        process.exit(results.success ? 0 : 1);
    })
    .catch((err) => {
        console.error(`[amazon-messages] Unhandled: ${err.message}`);
        process.exit(1);
    });
