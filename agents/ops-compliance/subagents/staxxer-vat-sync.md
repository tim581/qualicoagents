# Staxxer VAT Compliance Sync

Monthly browser automation that scrapes Qualico's Staxxer portal and stores structured VAT data in Supabase.

**Read this briefing at session start when handling VAT filings, registrations, or Staxxer.**

---

## What it does

`staxxer-vat-scraper.js` logs into [cloud.staxxer.com/qualicobv](https://cloud.staxxer.com/qualicobv) and scrapes:

| Page | Data |
|------|------|
| VAT Filings (`/vat-filing?tab=todo\|upcoming\|done`) | Country, filing period, payment due, payment date, amount, status |
| VAT Registrations (`/vat-registrations`) | Country, VAT number, status, start/end dates |
| One Stop Shop (`/onestopshop`) | OSS registration date, linked VAT numbers |
| Dashboard (`/qualicobv`) | Country/period status cards (Q1–Q4, In progress, etc.) |

Each run creates a **snapshot** in `staxxer_vat_*` tables. Use the latest `run_id` for current state; older runs are history.

---

## Supabase tables (you own reads; scraper writes)

| Table | Purpose |
|-------|---------|
| `staxxer_vat_sync_runs` | One row per scrape — status, counts, `raw_summary` JSONB |
| `staxxer_vat_filings` | Filing rows across todo / upcoming / done tabs |
| `staxxer_vat_registrations` | Active VAT registrations per country |
| `staxxer_oss_snapshot` | OSS registration + linked VAT numbers |
| `staxxer_vat_dashboard` | Dashboard country/period status |

**Not the same as** `vat_registrations` — that table is the manual master record (Airtable-style fields: EORI, portal URLs, filing partner). Staxxer tables are **live portal snapshots**. Reconcile both when numbers or statuses diverge.

---

## Trigger a sync (monthly or on demand)

Requires `playwright-task-executor.js` running on Tim's PC.

```sql
INSERT INTO "Browser_Tasks" (
  agent_name, task_type, url, actions, credentials_key, status
)
VALUES (
  'vat-agent',
  'staxxer-vat-sync',
  'https://cloud.staxxer.com/qualicobv',
  '[]'::jsonb,
  'staxxer_login',
  'pending'
);
```

Check result:

```sql
SELECT status, result, error_message, completed_at
FROM "Browser_Tasks"
WHERE task_type = 'staxxer-vat-sync'
ORDER BY created_at DESC
LIMIT 1;
```

Manual run on Tim's PC: `node scripts/staxxer-vat-scraper.js`

---

## Key queries

**Latest sync status**

```sql
SELECT run_id, scraped_at, status, filings_count, registrations_count, error_message
FROM staxxer_vat_sync_runs
ORDER BY scraped_at DESC
LIMIT 1;
```

**Upcoming filings (action needed)**

```sql
SELECT country, filing_period, payment_due, amount_text, status
FROM staxxer_vat_filings
WHERE tab = 'upcoming'
  AND run_id = (SELECT run_id FROM staxxer_vat_sync_runs ORDER BY scraped_at DESC LIMIT 1)
ORDER BY payment_due;
```

**Overdue upcoming (due date in the past)**

```sql
SELECT country, filing_period, payment_due, status
FROM staxxer_vat_filings
WHERE tab = 'upcoming'
  AND payment_due < CURRENT_DATE
  AND run_id = (SELECT run_id FROM staxxer_vat_sync_runs ORDER BY scraped_at DESC LIMIT 1);
```

**Active registrations (latest run)**

```sql
SELECT country, vat_number, status, start_date
FROM staxxer_vat_registrations
WHERE run_id = (SELECT run_id FROM staxxer_vat_sync_runs ORDER BY scraped_at DESC LIMIT 1)
ORDER BY country;
```

**OSS snapshot**

```sql
SELECT registration_date, end_date, linked_vat_numbers
FROM staxxer_oss_snapshot
WHERE run_id = (SELECT run_id FROM staxxer_vat_sync_runs ORDER BY scraped_at DESC LIMIT 1);
```

---

## Monthly workflow (recommended)

1. **Day 1 of month** — Queue `staxxer-vat-sync` via `Browser_Tasks`.
2. **After completion** — Query upcoming + todo tabs; flag anything due within 14 days or overdue.
3. **Reconcile** — Compare `staxxer_vat_registrations` vs `vat_registrations`; update master table if Staxxer shows changes.
4. **Report** — Summarize for Tim: upcoming dues, amounts paid last month, countries with "No Action Required" vs "Paid".
5. **Debug on failure** — Query `Flieber_Debug_Log` where `run_id` matches the task's `BROWSER_TASK_ID` prefix `staxxer_vat_task_*`.

---

## Auth & credentials

| Resource | Location |
|----------|----------|
| Login email | `Browser_Credentials` key `staxxer_login` |
| Cookie session | `scripts/staxxer-storage-state.json` on Tim's PC (not in git) |
| Cookie refresh | `node scripts/import-staxxer-cookies.js <export.json>` |

Scraper tries cookies first; falls back to `staxxer_login` password login and saves fresh cookies.

---

## Registered countries (as of Jul 2026)

UK, Spain, Poland, Netherlands, Italy, Germany, France, Czechia, Belgium — plus OSS Belgium filings.

---

## Script locations (GitHub: tim581/qualicoagents)

- `scripts/staxxer-vat-scraper.js`
- `scripts/import-staxxer-cookies.js`
- `supabase/migrations/20260707160000_staxxer_vat_tracking.sql`
- Task type: `staxxer-vat-sync` in `Browser_Task_Registry`

---

## What you should NOT do

- Do not scrape Staxxer manually in chat — always queue the browser task or ask Tim to run the script.
- Do not commit `staxxer-storage-state.json` or cookie exports to git.
- Do not treat `staxxer_vat_*` as the legal master record without cross-checking `vat_registrations`.
