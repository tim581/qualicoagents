# Playwright Task Executor System — Complete Documentation

**Version:** v3.4  
**Location:** `C:\Users\Tim\playwright-render-service\` (Tim's PC)  
**GitHub:** `tim581/qualicoagents` → `scripts/playwright-task-executor.js`  
**Human overview:** https://qualico-platform.vercel.app/it-tech/browser-automation  
**Status:** Must run continuously on Tim's PC for production tasks

---

## Overview

A Node.js process polls every **30 seconds** the `Browser_Tasks` table in Supabase for `status = 'pending'`. When it finds a task:

1. Marks the task `running`
2. Resolves the script (3-layer system)
3. Downloads the latest script from GitHub (`scripts/` on `main`) if needed
4. Runs the script (standalone or module.exports)
5. Writes `done` / `failed` + `result` / `error_message`

---

## Directory on Tim's PC

```
C:\Users\Tim\playwright-render-service\
├── scripts/
│   ├── playwright-task-executor.js   ← run this (canonical)
│   ├── bol-price-update.js
│   ├── price-monitor-scraper.js
│   └── …
├── .env                              ← SUPABASE_URL + SUPABASE_KEY
├── bol-storage-state.json            ← Bol partner cookies
├── package.json
└── node_modules/
```

**Run:**

```powershell
cd C:\Users\Tim\playwright-render-service
node scripts/playwright-task-executor.js
```

Scripts download from:

```
https://raw.githubusercontent.com/tim581/qualicoagents/main/scripts/{scriptName}
```

Push to GitHub `main` → available on next task (no agent git access needed).

---

## How agents trigger a task

```sql
INSERT INTO "Browser_Tasks" (agent_name, task_type, url, actions, credentials_key, status, priority)
VALUES (
  'customer-service',
  'bol-cases-scrape',
  'https://partner.bol.com',
  '[]'::jsonb,
  'bol_seller',
  'pending',
  1
)
RETURNING id;
```

With parameters (e.g. Bol price update):

```sql
INSERT INTO "Browser_Tasks" (agent_name, task_type, url, actions, credentials_key, status)
VALUES (
  'pricing-agent',
  'bol-price-update',
  'https://partner.bol.com',
  '[{"ean":"5419980414724","offer_uid":"c61305f7-ee7b-4c76-8ec3-2305a17bd6da","promotional_price":79.95,"start_date":"2026-05-28","end_date":"2026-09-30","action":"set","script":"bol-price-update.js"}]'::jsonb,
  'bol_seller',
  'pending'
)
RETURNING id;
```

---

## 3-layer script resolution

First match wins:

### Layer 1: `SCRIPT_TASKS` (in executor code)

Hardcoded map for common task types — see `scripts/playwright-task-executor.js`.

### Layer 2: `actions[].script`

If any object in `actions` has `"script": "filename.js"`, use that file.

### Layer 3: `Browser_Task_Registry`

```sql
SELECT script_name FROM "Browser_Task_Registry" WHERE task_type = 'bol-price-update';
```

**Source of truth for agents:** query registry with `available = true`.

---

## Script modes

### Standalone (no `module.exports`)

- Executor runs `node scriptPath` with `BROWSER_TASK_ID` env
- Script launches its **own** browser (stealth, proxy, cookies)
- Examples: `bol-cases-scrape.js`, `bol-price-update.js`, `price-monitor-scraper.js`

### module.exports (executor injects browser)

- Executor creates browser context and calls exported function
- Examples: `inventory-sync-forceget.js`, `sellerboard-pl-export.js`, `mintsoft-product-export.js`

---

## Browser_Tasks schema (key columns)

| Column | Description |
|--------|-------------|
| `task_type` | Drives script resolution |
| `actions` | JSON params; NOT NULL — use `[]` if empty |
| `credentials_key` | Lookup in `Browser_Credentials` |
| `status` | `pending` → `running` → `done` / `failed` |
| `result` | JSON result on success |
| `error_message` | Error text on failure |

---

## Registered production scripts (May 2026)

Query live list:

```sql
SELECT task_type, script_name, description FROM "Browser_Task_Registry" WHERE available = true;
```

Includes: `bol-cases-scrape`, `bol-price-update`, `forecast-sync`, `forecast-verify`, `po-simulation`, `to-simulation`, `price-scrape`, inventory syncs (Kamps, Mintsoft, Forceget), exports (Sellerboard, Mintsoft, Corax, Forceget), cookie-save helpers.

---

## Removed (do not register or call)

| task_type / script | Reason |
|--------------------|--------|
| `inventory-sync-bol` | Bol inventory via **API** — Playwright scraper removed May 2026 |
| `amazon-buyer-messages.js` | Removed — Amazon Seller Central ToS risk |

---

## Dev & deploy workflow (May 2026)

1. Develop in `scripts/` with Cursor on Tim's PC
2. Test locally (`node scripts/….js` or via `Browser_Tasks`)
3. **Push to GitHub only after successful run + verify** (e.g. scrape confirms live price)
4. Executor picks up new script on next download

See also: `.cursor/rules/playwright-automation-workflow.mdc` in this repo.

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Task stays `pending` | Executor not running | `node scripts/playwright-task-executor.js` |
| `Session expired` (Bol) | Cookies stale | Run `scripts/bol-partner-save-cookies.js` |
| Bol SSO fails behind proxy | Decodo blocks login | Set `BOL_NO_PROXY=1` for bol-price-update |
| Script not found | Missing registry / wrong task_type | Check `Browser_Task_Registry` |
| Old script behaviour | Cached local file | Delete local copy or push fix to GitHub |

---

## Flow diagram

```
Agent INSERT Browser_Tasks (pending)
        ↓
Executor poll (~30s)
        ↓
3-layer script resolution
        ↓
Download script from GitHub scripts/
        ↓
Standalone OR module.exports execution
        ↓
UPDATE Browser_Tasks (done/failed)
        ↓
Agent reads result
```

---

## See also

- [BROWSER-AUTOMATION-SELF-SERVICE.md](./BROWSER-AUTOMATION-SELF-SERVICE.md) — agent quick start
- [WRITING-BROWSER-SCRIPTS.md](./WRITING-BROWSER-SCRIPTS.md) — authoring scripts
- [README.md](./README.md) — doc index
