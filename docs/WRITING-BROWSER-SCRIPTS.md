# Writing Browser Automation Scripts — Complete Guide for Agents

> **Audience**: Any Qualico agent that needs to automate browser interactions.
> **Last updated**: April 2026 | **Author**: Multi Agent Mgr

---

## Architecture Overview

```
Agent writes script
        ↓
Push to GitHub: qualicoagents/scripts/{script-name}.js
        ↓
Register task_type in executor's SCRIPT_TASKS mapping
        ↓
Register in Browser_Task_Registry (so other agents discover it)
        ↓
INSERT into Browser_Tasks with status = 'pending'
        ↓
Tim's PC polls every 30s → downloads latest script from GitHub → runs it
        ↓
Script logs steps + screenshots to Flieber_Debug_Log → writes result to Browser_Tasks
        ↓
Agent queries Browser_Tasks.result or Flieber_Debug_Log to check outcome
```

**Key principle**: Scripts run on **Tim's local PC** (home IP, not blocked by sites like Bol.com). The executor (`playwright-task-executor.js`) auto-downloads the latest version from GitHub before each run.

---

## 1. Script Template

Every script must be **self-contained** — it handles its own browser, login, execution, and logging. Copy this template:

```javascript
/**
 * {your-script-name}.js  v1.0 — {one-line description}
 *
 * Prerequisites (on Tim's machine):
 *   cd C:\Users\Tim\playwright-render-service
 *   node playwright-task-executor.js
 *
 * .env must contain:
 *   SUPABASE_URL=https://zlteahycfmpiaxdbnlvr.supabase.co
 *   SUPABASE_KEY=<service_role key>
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');

// ── CONFIG ────────────────────────────────────────────────────────────────────

// Option A: Hardcode credentials (simpler, OK for single-site scripts)
const SITE_EMAIL    = 'user@example.com';
const SITE_PASSWORD = 'password123';
const SITE_URL      = 'https://example.com';

// Option B: Load from Browser_Credentials table (better for shared credentials)
// Use fetch() to query Supabase — see "Credential Management" section below

// ── SELF-DEBUGGING: SUPABASE LOG ──────────────────────────────────────────────

const RUN_ID = `{your-prefix}_${Date.now()}`;
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
    const buf = await page.screenshot({ fullPage: false });
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

// ── LOGIN ─────────────────────────────────────────────────────────────────────

async function login(page) {
  console.log('\n🔐 Logging in...');
  await dbLog('login', 'info', 'Navigating to site...');

  // ⚠️ ALWAYS use 'domcontentloaded' — NEVER 'networkidle' (SPAs hang forever)
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000); // settle time

  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', SITE_EMAIL);
  await page.fill('input[type="password"]', SITE_PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for post-login page — use domcontentloaded + settle
  await page.waitForURL('**/dashboard**', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  await dbLog('login', 'success', 'Login complete');
  await dbShot(page, 'login', 'After login');
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

(async () => {
  let browser;
  try {
    // ⚠️ Keep headless: false until scripts are stable (Tim wants to watch)
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await login(page);

    // ── YOUR AUTOMATION LOGIC HERE ──
    await dbLog('step-1', 'info', 'Starting main automation...');

    // ... do your work ...

    await dbLog('complete', 'success', 'Script finished successfully');
    await dbShot(page, 'complete', 'Final state');

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    await dbLog('fatal', 'error', err.message);
  } finally {
    if (browser) await browser.close();
    // Give logs time to flush
    await new Promise(r => setTimeout(r, 2000));
  }
})();
```

---

## 2. Deploy to GitHub

Push your script to `qualicoagents/scripts/`:

```sql
-- Agent pushes via GitHub connection:
-- conn_rf4te6wqncg18hn7dn13__github_push_to_branch
-- owner: tim581, repo: qualicoagents, branch: main
-- repoPath: scripts/{your-script-name}.js
```

The executor **auto-downloads the latest version from GitHub** before each task run. No manual copy needed.

**⚠️ EXCEPTION**: If the executor *itself* was changed (new task_type added), Tim must manually re-download the executor:
```powershell
cd C:\Users\Tim\playwright-render-service; Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tim581/qualicoagents/main/scripts/playwright-task-executor.js" -OutFile "playwright-task-executor.js"
```

---

## 3. Register Your Task Type

### 3a. Add to Executor's SCRIPT_TASKS mapping

In `playwright-task-executor.js`, add your task_type → script mapping:

```javascript
const SCRIPT_TASKS = {
  'forecast-sync':    'flieber-forecast-updater.js',
  'po-simulation':    'flieber-replenishment-simulator.js',
  'to-simulation':    'flieber-replenishment-simulator.js',
  'forecast-verify':  'flieber-forecast-verifier.js',
  // ADD YOURS:
  'your-task-type':   'your-script-name.js',
};
```

**⚠️ After changing the executor itself**, Tim must re-download it (see above). The executor is NOT auto-downloaded — only the task scripts are.

Push the updated executor to GitHub and tell Tim to re-download.

### 3b. Register in Browser_Task_Registry

So other agents can discover your automation:

```sql
INSERT INTO "Browser_Task_Registry" (task_type, display_name, description, script_name, available, requires_running)
VALUES (
  'your-task-type',
  'Human-Readable Name',
  'What this automation does, how long it takes, what it produces.',
  'your-script-name.js',
  true,
  'playwright-task-executor.js on Tim PC'
);
```

### 3c. Add to Shared_Knowledge (optional but recommended)

```sql
INSERT INTO "Shared_Knowledge" (topic, key, value, domain, created_by)
VALUES (
  'browser-automation',
  'your-task-type-docs',
  'Description of what your-task-type does. Triggered via Browser_Tasks table. See Browser_Task_Registry for details.',
  'company',
  'your-agent-name'
);
```

---

## 4. Trigger Your Script

### From your own agent:

```sql
INSERT INTO "Browser_Tasks" (agent_name, task_type, url, actions, credentials_key, status)
VALUES ('your-agent-name', 'your-task-type', 'https://target-site.com', '[]'::jsonb, 'credential_key', 'pending');
```

**⚠️ CRITICAL**: The `actions` column is NOT NULL. For script-based tasks, always pass `'[]'::jsonb`.

### Using the post-browser-task subagent:

Agents with access to `/agent/subagents/post-browser-task.md` can trigger tasks without writing SQL.

### Check result:

```sql
SELECT status, result, error_message, completed_at
FROM "Browser_Tasks"
WHERE task_type = 'your-task-type'
ORDER BY created_at DESC LIMIT 1;
```

---

## 5. Debugging — The Self-Diagnosis Protocol

### How it works

Your script writes **every step + screenshots** to the `Flieber_Debug_Log` table. After a run, you (or any agent) can query the logs to diagnose issues without Tim copy-pasting anything.

### Debug Log Table Schema

```
Flieber_Debug_Log:
  id              (auto)
  run_id          text     — unique per execution, e.g. 'myscript_1713180000000'
  step            text     — e.g. 'login', 'navigate', 'click-button', 'complete'
  status          text     — 'info', 'success', 'error', 'warning', 'screenshot'
  message         text     — description or data (max ~3000 chars per entry)
  screenshot      text     — base64-encoded PNG (for screenshot entries)
  screenshot_label text    — human-readable label
  created_at      timestamptz (auto)
```

### Query after a run:

```sql
-- Get all steps from the latest run
SELECT step, status, LEFT(message, 500) as msg, created_at
FROM "Flieber_Debug_Log"
WHERE run_id = '{your_run_id}'
ORDER BY created_at;

-- Or find the latest run for your task type
SELECT DISTINCT run_id, MIN(created_at) as started
FROM "Flieber_Debug_Log"
WHERE run_id LIKE 'your-prefix%'
GROUP BY run_id
ORDER BY started DESC LIMIT 5;
```

### Best practices:

1. **Log every step** — `await dbLog('step-name', 'info', 'What happened')` before and after key actions
2. **Screenshot key moments** — `await dbShot(page, 'step-name', 'After clicking X')` at login, before/after main actions, and on errors
3. **Log data values** — When reading or writing data, log the values for verification
4. **Use chunked logging** for long data — SQL tool truncates at ~600 chars. Split large messages:
   ```javascript
   const headers = columns.join(', ');
   for (let i = 0; i < headers.length; i += 2500) {
     await dbLog('csv-headers', 'info', `chunk ${i}: ${headers.substring(i, i + 2500)}`);
   }
   ```
5. **⚠️ Screenshot extraction**: Base64 strings are huge and get truncated in SQL queries. To view screenshots, use Python to decode them — don't try to read them via SQL.

---

## 6. Credential Management

### Option A: Browser_Credentials table (recommended)

Store credentials centrally so multiple scripts can share them:

```sql
-- Query existing credentials
SELECT key, username, base_url FROM "Browser_Credentials";

-- Currently available:
-- flieber_login: Tim@qualico.be / {password} / https://app.flieber.com
```

Load in your script:

```javascript
async function getCredentials(key) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.${key}&select=*`,
    {
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      },
    }
  );
  const data = await res.json();
  if (!data || data.length === 0) throw new Error(`No credentials for key: ${key}`);
  return data[0]; // { key, username, password, base_url }
}
```

### Option B: Hardcode (OK for prototyping, not ideal for shared scripts)

Only use this when you're the only consumer and the credentials rarely change.

---

## 7. Environment Variables for Mode Switching

If your script has multiple modes (like PO/TO simulation), use environment variables:

```javascript
const RUN_MODE = process.env.RUN_MODE || 'default';
```

The executor sets env vars before running your script:

```javascript
// In playwright-task-executor.js:
const env = { ...process.env };
if (task.task_type === 'po-simulation') env.RUN_MODE = 'po';
if (task.task_type === 'to-simulation') env.RUN_MODE = 'to';
```

---

## 8. Auto-Chaining Tasks

The executor supports auto-chaining: when one task completes, it can automatically queue the next. Example:

```javascript
// In playwright-task-executor.js, after task completion:
if (task.task_type === 'forecast-sync' && result.success) {
  await supabase.from('Browser_Tasks').insert({
    agent_name: task.agent_name,
    task_type: 'forecast-verify',
    url: 'https://app.flieber.com/app/sales-forecast',
    actions: [],
    credentials_key: 'flieber_login',
    status: 'pending'
  });
}
```

If you need auto-chaining for your task, add the logic to the executor and document it.

---

## 9. Critical Gotchas (Hard-Learned Lessons)

### 🚨 NEVER use `waitUntil: 'networkidle'` on SPAs
SPAs (Flieber, most modern apps) **never stop making network requests**. `networkidle` = timeout/hang every time.

✅ **Always use**: `waitUntil: 'domcontentloaded'` + `page.waitForTimeout(3000-5000)` for settle

### 🚨 NEVER use `Ctrl+A` in data grids (Handsontable, AG Grid, etc.)
`Ctrl+A` in Handsontable selects **ALL CELLS** (not just text in one cell). `Delete` after that = wipe entire grid.

✅ **To clear a cell**: `dblclick()` → wait for editor → `el.value = ''` → type new value → `Tab` to confirm

### 🚨 Generic button locators hang silently
`page.locator('button').filter({ hasText: 'some text' })` can match hidden/disabled elements and hang.

✅ **Use**: `page.getByText('Exact Text')` or `page.getByText(/pattern/i).first()` — proven to work

### 🚨 Comma in Playwright text locator = regex flag
`page.locator('text=/Export data/i, button:has-text("Export")')` — the comma after `/i` is interpreted as a regex flag.

✅ **Use**: `page.getByText('Export table data').first()` — simple, works, no regex gotchas

### 🚨 Executor caches scripts per session
If you push a new version while the executor is running, it **may** use the cached old version.

✅ **After pushing updates**: Tell Tim to `Ctrl+C` and restart the executor

### 🚨 `headless: false` until stable
Tim wants to **watch** scripts run during debugging. Only switch to `headless: true` when the script is proven stable.

### 🚨 `actions` column is NOT NULL
When inserting into `Browser_Tasks`, always include `actions: '[]'::jsonb` for script-based tasks.

### 🚨 Re-query locators after scroll
After scrolling in a data grid, cell locators become stale. Always re-query the cell after scroll operations.

### 🚨 Use Tab not Enter after cell edit
In Handsontable, `Enter` moves the cursor **down** (risky — might edit wrong cell). `Tab` moves **right** (safer).

---

## 10. Complete Deployment Checklist

- [ ] Script written and tested locally (if possible)
- [ ] Script pushed to `qualicoagents/scripts/{name}.js` on GitHub
- [ ] `SCRIPT_TASKS` mapping added to `playwright-task-executor.js` on GitHub
- [ ] Tim notified to re-download executor (only if executor mapping changed)
- [ ] Task type registered in `Browser_Task_Registry`
- [ ] `Shared_Knowledge` entry added (optional)
- [ ] Documentation updated if needed
- [ ] Test task created in `Browser_Tasks` with status `pending`
- [ ] Result verified via `Flieber_Debug_Log` or `Browser_Tasks.result`

---

## Quick Reference — Existing Scripts

| Script | task_type(s) | What it does |
|---|---|---|
| `flieber-forecast-updater.js` v8.9 | `forecast-sync` | Pushes Puzzlup forecasts → Flieber (5 stores, 13 months) |
| `flieber-forecast-verifier.js` v2.4 | `forecast-verify` | Exports Flieber CSV, compares to Supabase (±10 tolerance) |
| `flieber-replenishment-simulator.js` v3.0 | `po-simulation`, `to-simulation` | Runs PO/TO simulation in Flieber, fetches results via GraphQL |

---

## Need Help?

- Query `"Shared_Knowledge"` WHERE topic = `'browser-automation'`
- Check `"Browser_Task_Registry"` for available task types
- Read existing scripts on GitHub for working patterns
- Post in Slack or create an Agent Request if stuck
