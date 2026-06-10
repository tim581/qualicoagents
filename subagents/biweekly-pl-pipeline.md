# Bi-Weekly P&L Actuals Pipeline

Master orchestrator for the bi-weekly P&L update cycle. Runs Amazon Sellerboard scraping + BOL invoice processing + verification.

## Instructions

You are the master orchestrator for the P&L actuals pipeline. You coordinate the full update cycle.

### Overview

1. **Scrape** Sellerboard for all 8 Amazon markets → `Sellerboard_Exports`
2. **Parse & Update** P&L_Masterdata with fresh actuals
3. **BOL** invoice processing (if new invoices available)
4. **Verify** the complete P&L with cross-checks and sanity checks
5. **Report** results + email summary if issues found

### Step 1: Run Sellerboard Scraper

Run the subagent at `/agent/subagents/sellerboard-scraper-v11.md`.

This will:
- Login to Sellerboard
- Scrape all 8 markets (DE, UK, FR, ES, IT, NL via EU account; USA, CA via US account)
- Upsert to `Sellerboard_Exports` in Supabase
- Run cross-check verification against existing data

If the scraper reports any 🔴 significant changes in closed months, log them but continue — these will be investigated later.

If the scraper fails completely (login failure, etc.), send a notification email and stop:
```
To: tim@qualico.be
Subject: ⚠️ Sellerboard scraping failed
Body: The bi-weekly P&L update failed at the scraping step. Error: {error details}
```

### Step 2: Run P&L Updater

Run the subagent at `/agent/subagents/sellerboard-pl-updater.md`.

This will:
- Parse Sellerboard_Exports into P&L line items
- Update P&L_Masterdata with actuals
- Update pl_month_status
- Trigger refresh_pl_forecast() cascade
- Run sanity checks

### Step 3: BOL Invoice Processing

Run the subagent at `/agent/subagents/bol-pl-automation.md` with payload:

```json
{
  "action": "full_refresh",
  "year": 2026,
  "months": [1, 2, 3, 4, 5],
  "start_date": "2025-12-15",
  "end_date": "2026-05-31"
}
```

Adjust the months and end_date based on current date:
- Always include months up to current month
- Start date: always Dec 15 of previous year (catches cross-month invoices)
- End date: last day of current month

⚠️ BOL invoices arrive ~2× per month (half-monthly billing). The current month may be partial — that's fine, it will be tagged as `bol_api_partial`.

### Step 4: Final Verification

After both Amazon and BOL updates, run a final comprehensive check:

Query Supabase (project_id: `zlteahycfmpiaxdbnlvr`):

```sql
-- Check total Net Revenue per channel for all actuals months
SELECT marketplace, month, 
  SUM(CASE WHEN line_item = 'Net Revenue' THEN amount END) as net_rev,
  SUM(CASE WHEN line_item = 'Contribution Margin (Brand Profit)' THEN amount END) as cm,
  SUM(CASE WHEN line_item = 'PPC / Advertising' THEN amount END) as ppc
FROM "P&L_Masterdata"
WHERE fiscal_year = 2026 
  AND source IN ('sellerboard_actual', 'bol_api', 'bol_api_partial')
ORDER BY marketplace, month;
```

Verify:
1. **Completeness**: All expected marketplace × month combos have data
2. **No duplicates**: Each line_item appears exactly once per marketplace × month
3. **Totals reasonable**: Total Net Revenue for a month should be €50K-€300K (flag if outside)
4. **YoY growth check (CRITICAL)**: Compare total 2026 YTD Gross Revenue vs same months in 2025. Expected: **+10% to +30% growth**. If growth is < 0% or > 50%, **ABORT — rollback all changes, do NOT write data to P&L_Masterdata, email tim@qualico.be immediately** — this almost certainly means the scraper pulled fake/test data (e.g., sequential decimal patterns like 234,567.89 / 112,345.67). Include the actual 2025 vs 2026 YTD numbers in the abort email.

### Step 5: Report

Return a comprehensive report:

```
=== BI-WEEKLY P&L UPDATE COMPLETE ===
Date: {today}

📊 AMAZON (Sellerboard)
- Markets scraped: {n}/8
- Months updated: Jan-{current_month} 2026
- Cross-check: {n} checks, {n} flags

📦 BOL.COM
- Invoices processed: {n}
- Months updated: {list}
- Status: {complete/partial}

✅ VERIFICATION
- Sanity checks: {passed}/{total}
- Flags: {list or "none"}

💰 KEY METRICS (updated)
| Channel | YTD Net Rev | YTD CM | CM% |
|---------|-------------|--------|-----|
...
Total: €{xxx}K Net Rev, €{xxx}K CM ({x}%)
```

### Error Handling

- If Sellerboard scraping fails → email tim@qualico.be, stop pipeline
- If P&L update fails → email, but scrape data is saved for retry
- If BOL fails → log error, continue (Amazon data is independent)
- If verification finds 🔴 failures → include in report, email tim@qualico.be with details

### Important Notes

- Supabase project_id: `zlteahycfmpiaxdbnlvr`
- NEVER invent product names — always query `Puzzlup_Product_Info`
- Canada data is in USD — stored as-is, converted at 0.86 in the margin model
- BOL data is separate from Amazon — different source tags, same P&L_Masterdata table
- After this pipeline runs, the full model cascade fires automatically (P&L → CF → BS → ICF)
