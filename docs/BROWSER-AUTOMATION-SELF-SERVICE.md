# Browser Automation — Self-Service Guide for Agents

Any Qualico agent can trigger browser automations **without** writing Playwright code or using git.

**Human overview:** https://qualico-platform.vercel.app/it-tech/browser-automation

---

## How it works

```
Agent → INSERT Browser_Tasks (pending) → Executor on Tim PC → Script runs → result in Browser_Tasks
```

- **Agents:** insert task + poll result only
- **Executor:** `scripts/playwright-task-executor.js` on Tim's PC (poll ~30s)
- **Scripts:** auto-downloaded from `tim581/qualicoagents` → `scripts/` before each run

---

## Step 1: Discover available automations

**Always use the registry** (not hardcoded lists in docs):

```sql
SELECT task_type, display_name, description, script_name
FROM "Browser_Task_Registry"
WHERE available = true
ORDER BY task_type;
```

---

## Step 2: Post a task

```sql
INSERT INTO "Browser_Tasks" (
  agent_name,
  task_type,
  url,
  actions,
  credentials_key,
  status,
  priority
)
VALUES (
  'your-agent-name',
  'bol-price-update',
  'https://partner.bol.com',
  '[{"ean":"5419980414724","offer_uid":"c61305f7-ee7b-4c76-8ec3-2305a17bd6da","promotional_price":79.95,"start_date":"2026-05-28","end_date":"2026-09-30","action":"set","script":"bol-price-update.js"}]'::jsonb,
  'bol_seller',
  'pending',
  1
)
RETURNING id;
```

**Rules:**

- `status` must be `'pending'`
- `actions` is **NOT NULL** — use `'[]'::jsonb` if no params, or JSON array with params (+ optional `"script":"…"`)
- `credentials_key` when the script needs login (see `Browser_Credentials`)

---

## Step 3: Check result

```sql
SELECT status, result, error_message, completed_at
FROM "Browser_Tasks"
WHERE id = '<task_id>';
```

| status | Meaning |
|--------|---------|
| `pending` | Not picked up yet (executor offline or waiting for poll) |
| `running` | Script executing |
| `done` | Success — read `result` |
| `failed` | Error — read `error_message` |

Typical wait: 30–120 seconds (short tasks) to 45–60 min (`price-scrape`).

---

## Registered task types (May 2026)

Snapshot from `Browser_Task_Registry`. **Re-query registry for latest.**

| task_type | display_name | script | ~duration |
|-----------|--------------|--------|-----------|
| `bol-cases-scrape` | Bol.com Cases Scraper | bol-cases-scrape.js | 1–3 min |
| `bol-price-update` | Bol.com Actieprijs Update | bol-price-update.js | 1–2 min |
| `corax-save-cookies` | Corax WMS Save Cookies | corax-wms-save-cookies.js | manual |
| `corax-stock-export` | Corax WMS Stock Export | corax-wms-stock-export.js | 2–5 min |
| `forceget-inventory-export` | Forceget Live Inventory | forceget-inventory-export.js | 2–5 min |
| `forecast-sync` | Sync Forecasts to Flieber | flieber-forecast-updater.js | ~5 min |
| `forecast-verify` | (chained after forecast-sync) | flieber-forecast-verifier.js | ~2 min |
| `inventory-forceget` | Forceget Inventory Sync | inventory-sync-forceget.js | 3–5 min |
| `inventory-sync-forceget` | Forceget CA/US Inventory Sync | inventory-sync-forceget.js | 3–5 min |
| `inventory-sync-kamps` | Kamps/Vanthiel EU Inventory Sync | inventory-sync-kamps.js | 3–10 min |
| `inventory-sync-mintsoft` | Mintsoft UK Inventory Sync | inventory-sync-mintsoft.js | 3–10 min |
| `mintsoft-product-export` | Mintsoft Product Export | mintsoft-product-export.js | 5–10 min |
| `po-simulation` | Run PO Simulation | flieber-replenishment-simulator.js | ~2 min |
| `price-scrape` | Puzzlup Price & Buy Box Monitor | price-monitor-scraper.js | 45–60 min |
| `sellerboard-pl-export` | Sellerboard P&L Export | sellerboard-pl-export.js | 5–15 min |
| `to-simulation` | Run TO Simulation | flieber-replenishment-simulator.js | ~2 min |

---

## Not browser tasks

| Need | Use instead |
|------|-------------|
| Bol LvB stock levels | Bol **API** sync (not Playwright) |
| Amazon buyer messages | **Removed** — ToS risk |

---

## Subagent

Agents with access to `/agent/subagents/post-browser-task.md` can post tasks without writing SQL.

---

## Requirements

- `node scripts/playwright-task-executor.js` running on Tim's PC
- `.env` with `SUPABASE_URL` + `SUPABASE_KEY`
- Relevant storage-state cookies (e.g. `bol-storage-state.json` for Bol partner tasks)

---

## More detail

- [playwright-task-executor-system.md](./playwright-task-executor-system.md) — full architecture
- [WRITING-BROWSER-SCRIPTS.md](./WRITING-BROWSER-SCRIPTS.md) — for script authors
