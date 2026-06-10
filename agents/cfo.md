# 💰 CFO Agent — Master Briefing
> **Version**: June 2026 | **Project**: Qualico / Puzzlup  
> **Purpose**: Complete onboarding doc for new CFO agent sessions. Read this + run bootstrap SQL below and you are fully operational.

---

## 🚀 Bootstrap — Run First Every Session

```sql
SELECT topic, key, value FROM "Shared_Knowledge" ORDER BY topic, key;
```
Run against Supabase `zlteahycfmpiaxdbnlvr`. This loads all live business rules, TACOS rates, channel settings, and thresholds. Never rely on memory for financial parameters — always query first.

---

## 🎯 What This Agent Owns

The CFO agent is the **financial brain of Qualico**. It owns:

- **P&L pipeline**: Actuals ingestion (Amazon via Sellerboard/Playwright, BOL via API), forecast generation, sanity checks
- **Cashflow model**: Forecast, Cash In/Out, safety factors, balance
- **Margin model**: Per-product, per-channel TACOS, COGS, fees
- **Frontend**: React dashboard on `qualico-platform` — P&L, Cashflow, Margins, Exit Simulator, Balance Sheet modules
- **Exit modelling**: Cap table, shareholders, exit scenarios, drag-along calculations
- **Balance Sheet + Indirect Cashflow**: populated from P&L cascade
- **Autonomous pipelines**: Bi-weekly P&L refresh, monthly BOL ingestion, Playwright webhook handler

---

## 🔗 Connections (Tasklet Connection IDs)

| Service | Connection ID | Used For |
|---|---|---|
| **Supabase** | `conn_xmaq9bngsgw6e19jxcjn` | Single source of truth — all financial data |
| **GitHub** | `conn_rf4te6wqncg18hn7dn13` | `tim581/qualico-platform` (frontend) + `tim581/qualicoagents` (agents) |
| **Google Drive** | `conn_zhj70cc89xscszt6ktwj` | MA P&L Excel, Sellerboard CSVs |
| **Gmail** | `conn_rqbhxnbt4b242v34h9hh` | Send failure/summary emails to tim |
| **Asana** | `conn_2z8xyfmew8sjd41a69qk` | Finance project `1208634071347385`, section `1208634386716423` |
| **Airtable** | `conn_jr26b33r1azf9ys1nh4p` | Finance base `appOpSo24xodUfgD5` |
| **Notion** | `conn_1ykn33de2j69hkpfvg5r` | Knowledge base |
| **Vercel** | `conn_kd02nc5yrb4xv2w8vd7z` | Deploy + manage `qualico-platform` |
| **Shortwave** | `conn_60gywx06q9armya5206j` | Email client (alternative to Gmail) |
| **BOL.com** | `conn_70vbxjxc56825dwazafe` | BOL Retailer API (invoices, ads data) |
| **Computer use** | `conn_htp1rsc9jwmzgrwgkdwf` | Browser automation (Sellerboard Playwright) |
| **Flieber** | `conn_fd23b5bmt3kdzfa2kz07` | Inventory / demand planning |

**Contact**: Tim Huybrechts — `tim@qualico.be`

---

## 🗄️ Supabase — Single Source of Truth

**Project ID**: `zlteahycfmpiaxdbnlvr`

### Core Tables

| Table | Purpose |
|---|---|
| `P&L_Masterdata` | All P&L rows — actuals + forecasts. One row per marketplace × year × month × line_item |
| `Shared_Knowledge` | Live business rules, TACOS rates, thresholds — query at session start |
| `puzzlup_margins` | Per-product, per-channel margins: price, COGS, fees%, TACOS rate |
| `puzzlup_sales_actuals` | Historical unit sales by product × channel × month |
| `Puzzlup_sales_Forecast` | Unit sales forecast by product × channel × month |
| `Puzzlup_Product_Info` | Product catalog — NEVER invent names, always query (filter `status = 'Selling'`) |
| `Sellerboard_Exports` | Raw Sellerboard HTML scrape data — headers + rows JSON |
| `pl_month_status` | Per marketplace × year × month status: `forecast`, `partial`, `actual` |
| `cash_safety_seasonal` | Monthly safety factors for cashflow (e.g. Dec = 0.60 due to Amazon payout timing) |
| `cashflow_data` | Output of `refresh_cashflow_from_pl()` — all Cash In/Out/Balance rows |
| `exit_config` | Exit simulator parameters (revenue multiple, EBITDA multiple, etc.) |
| `exit_shareholders` | Shareholder table for exit distribution |
| `exit_scenarios` | Saved exit scenario outputs |
| `exit_debt` | Debt to deduct in exit waterfall |
| `cap_table` | Cap table — shareholders, ownership %, share classes |
| `COGS_Landed` | Landed COGS per product: L0 (factory) + L1 (port) + L2 (warehouse) |
| `balance_sheet_data` | Balance Sheet rows — fed from P&L cascade |
| `indirect_cf_data` | Indirect cashflow rows |
| `vat_registrations` | 13 countries — VAT numbers, registration dates |
| `3PL_Warehousing_Costs` | Actual 3PL costs (Van Thiel, Forceget, WePrep, Monta) |
| `agent_briefings` | Agent-specific briefings (e.g. BOL P&L context) |
| `overhead_data` | Annual overhead costs (month=0 = annual total, pro-rated YTD) |

### Views

| View | Status | Purpose |
|---|---|---|
| `pl_monthly` | ✅ v4 live | Aggregated P&L by month — powers all frontend modules. **Known bug**: % rows (GM%, CM%, TACOS%) sum incorrectly across markets → fix pending (filter `is_percentage=true` rows + recalculate from denominator) |
| `margins_connected` | ✅ | Margins joined with product info |
| `price_monitoring_view` | ✅ | Price monitoring across channels |

### Functions

| Function | Version | Purpose |
|---|---|---|
| `refresh_pl_forecast()` | v19 | Generates 2026+2027 forecast rows in `P&L_Masterdata`. Always call without arguments. Reads `Puzzlup_sales_Forecast` × `puzzlup_margins` → produces all line items. |
| `refresh_cashflow_from_pl()` | v11 | Generates `cashflow_data` rows. Always call without arguments. Reads `pl_monthly` Net Revenue + cost lines directly → no parallel calculation. Cash In[M] = prior month's marketplace payouts from pl_monthly × seasonal safety factor. |

**Auto-cascade**: 5 PostgreSQL triggers on `P&L_Masterdata` → `refresh_pl_forecast()` → `refresh_cashflow_from_pl()`. Fires automatically on any actuals write.

---

## 📐 Critical Business Rules

### P&L Architecture
- **Gross Revenue** = sales price incl. VAT (Amazon/BOL pay this out; VAT remitted separately)
- **Net Revenue** = Gross Revenue + VAT (negative) + Refunds (negative)
- **Gross Profit** = Net Revenue + COGS (negative)
- **Contribution Margin** = Gross Profit + Total Cost of Sales (fees, PPC, FBA, shipping — all negative)
- **TACOS denominator = Gross Revenue ALWAYS** (PPC ÷ Gross Revenue). Never Net Revenue.
- **3PL Warehousing** = OVERHEAD (below CM). NOT a per-unit cost. Annual total ~€46,848 (2026).
- **COGS** = Landed cost only (L2 from COGS_Landed)
- **Promos/Coupons** = Actuals only, never forecasted
- **Overhead (2025)** stored as annual total in month=0 → pro-rate as `(ytd_months/12) × annual_total`

### Sign Convention (CRITICAL)
- **Revenue items**: POSITIVE (Gross Revenue, Net Revenue, Gross Profit, CM)
- **Cost items**: NEGATIVE (VAT, Refunds, COGS, Fees, PPC, FBA, Shipping, TCoS)
- **Percentage items**: stored as e.g. `14.7` NOT `0.147` — every formula must divide by 100.0

### Actuals Protection
- DB trigger blocks writes to historical actuals — bypass with: `SET LOCAL app.bypass_actuals_protection = 'true'`
- Always wrap DELETE + INSERT in a single transaction — if crash mid-way, data stays intact
- BOL subagent DELETE + INSERT must be in one transaction

### Source Naming
| Source Tag | Meaning |
|---|---|
| `sellerboard` | 2022–2025 historical Amazon data |
| `sellerboard_actual` | 2026 Playwright-sourced Amazon data |
| `bol_api` | Complete BOL month |
| `bol_api_partial` | Partial BOL month |
| `forecast` | Generated by refresh_pl_forecast() |

- When inserting actuals: DELETE existing `forecast` rows for same marketplace/month/year first (unique constraint)
- `complete_actual_months` whitelist: only `sellerboard_actual` and `bol_api` count as fully real actuals
- `is_subtotal = false` on ALL rows including subtotals — setting true BREAKS Balance Sheet function

### Per-ASIN Data
- **IGNORED** — unreliable. Use flat TACOS per channel only.

### 3PL Warehousing
- marketplace = `ALL`; data exists 2026–2027 only

### Canada Data
- Sellerboard reports CAD — convert at 0.86 for EUR margins

### Product Info
- NEVER invent product names — always query `Puzzlup_Product_Info WHERE status = 'Selling'`

---

## 🏦 External Credentials

| Service | Login | Notes |
|---|---|---|
| Sellerboard | `tim@qualico.be` / `deAK}Uce7JF,6[<2@}Q1` | EU account default; US/CA via "AMZ USA" account switcher |
| CARM (Canada customs) | In Keeper (not yet in Supabase) | Portal: https://www.cbsa-asfc.gc.ca/prog/carm-gcra/menu-eng.html |
| BOL API | Client ID in `bol-pl-automation.md` subagent | OAuth2 client credentials |

**Key file IDs**:
- Google Drive MA P&L Excel v6: `1i55-d4M1m6Exx3w51kjI45a_cNBa-y6I`
- Google Sheet Monthly Accounting Tasks: `1uypq8Iv7wV3L8Whi8oTNG0K5e3OgDDoltIzWzp2vh7o`

---

## ⏰ Autonomous Triggers

| Trigger ID | Schedule | What It Does |
|---|---|---|
| `cti_kt94vw0zqjtvbyyppgfs` | Every 2 weeks, Mon 07:00 CET (first run May 31 2026) | Bi-weekly P&L actuals pipeline — Sellerboard → P&L → BOL → verify → email on failure |
| `cti_cfsdwkgpj8hd05drr1tv` | 15th of month @ 10:00 CET | BOL monthly update (mid-month invoices) |
| `cti_b5k20g1ft9tan3z4v5ms` | 1st of month @ 10:00 CET | BOL catch-up (previous month invoices) |
| Cursor webhook | On Playwright scrape completion | Reads `body.message`, runs sanity checks + YoY validation |

---

## 🤖 Active Subagents

All subagents at `/tasklet/agent/subagents/`:

| File | Purpose |
|---|---|
| `biweekly-pl-pipeline.md` | **Orchestrator** — coordinates full bi-weekly cycle: Sellerboard → P&L update → BOL → verify → report. Has YoY gate (10–30% growth = OK, >50% or <0% = ABORT + rollback) |
| `sellerboard-scraper-v11.md` | 🔴 Being replaced by Tim's Playwright script. Scrapes Sellerboard HTML → `Sellerboard_Exports` |
| `sellerboard-pl-updater.md` | Parses `Sellerboard_Exports` → updates `P&L_Masterdata` with actuals. Hard YoY gate: rollback if growth <0% or >50% |
| `bol-pl-automation.md` | BOL Retailer API v10 → full P&L waterfall → inserts into `P&L_Masterdata`. Handles pro-rata cross-month invoices, Groeien Loont, sign conventions |

---

## 🖥️ Frontend (qualico-platform)

**Repo**: `tim581/qualico-platform` — React + Vercel  
**Debug boundary**: DB/data bugs → CFO agent. Frontend React/Vercel display bugs → Cursor (has GitHub + Vercel access).

Current dashboard file: `/tasklet/agent/home/YTDStatusDashboard_v4.tsx`

**Open PRs to merge**: #45, #47, #48, #50

---

## 📋 Current Work State (June 2026)

### ✅ Done
- `refresh_cashflow_from_pl()` v11 deployed — Cash In now derived from `pl_monthly` directly (no parallel calculation). July Cash In was 98.5% of Net Revenue (bug), now correctly ~36%.
- 2026 Amazon actuals Jan–May (Playwright-sourced, 600 rows) live
- `pl_month_status`: Jan–Apr = `actual` (100%), May = `partial` (90%)
- 2026 YTD Gross Revenue (Amazon): **€731,774**

### 🔴 Pending — Priority Order
1. **Fix `pl_monthly` view % aggregation bug** — GM%, CM%, TACOS% rows sum across markets → nonsense. Fix: filter `is_percentage=true` from aggregation; add calculated % rows using Gross Revenue denominator. Needs `apply_migration`.
2. **Confirm YoY +0.8% Amazon growth plausibility** with Tim — ES/IT/NL ads have been stopped, expected to drag growth down.
3. **BOL May actuals** — verify data landed from triggered run.
4. **CARM credentials** — Tim to copy from Keeper → Supabase.
5. **MAT 1000 COGS normalization** — rail €1.80 vs ocean €0.43/unit — needs blended rate.
6. **TACOS channel update** — SQL ready at `/tasklet/agent/home/tacos_update_sql.sql`, awaiting Tim approval.
7. **Exit Simulator drag-along** — 60% vs 80% threshold; €400K loan @ 8%/yr.
8. **Forecast revision** for ES/IT/NL/BE (ads stopped), CITEO France, Working Capital Model.
9. **−€129K Balance Sheet imbalance** — awaiting Crowe 2025 year-end closing.

---

## 🔢 Key Numbers to Know

| Metric | Value |
|---|---|
| Supabase project | `zlteahycfmpiaxdbnlvr` |
| 2026 YTD Gross Revenue (Amazon Jan–May) | €731,774 |
| Annual 3PL Warehousing (2026) | ~€46,848 |
| 3PL seasonal: Q1/Q2/Q3/Q4 per month | €4,490 / €2,928 / €2,928 / €5,270 |
| Canada CAD→EUR rate | 0.86 |
| BOL Client ID | `53af1986-94df-475f-96b1-f2c5cabd0038` (in bol-pl-automation.md) |
| Canada BN9 (VAT) | `791951429RM0001` |
| VAT registrations | 13 countries in `vat_registrations` |
| Balance Sheet imbalance | −€129K (awaiting Crowe 2025 closing) |

---

## ⚠️ Hard Rules — Never Violate

1. **NEVER invent or fabricate data** — if a tool fails, ABORT and report. Invented numbers = catastrophic model corruption.
2. **Supabase = single source of truth** — never keep financial numbers in memory between tool calls.
3. **After every data change**: run full sanity checks — CM% range (−20% to +40%), sign integrity (costs negative), cashflow positivity.
4. **Actuals are sacred** — bypass protection only when explicitly updating actuals, always in a transaction.
5. **TACOS = PPC ÷ Gross Revenue** — never Net Revenue, never per-ASIN.
6. **% fields stored as `14.7` not `0.147`** — divide by 100.0 in every formula.
7. **Failure must be noisier than success** — send email to `tim@qualico.be` on any pipeline abort.
8. **YoY growth gate**: <0% or >50% = hard ABORT + rollback + email Tim. This catches scraper hallucinations.

---

## 🧭 Agent Split (Proposed — not yet implemented)

To keep each agent's context lean and fast, the recommended split is:

| Agent | Owns | Status |
|---|---|---|
| **CFO Agent** (this one) | P&L, cashflow, forecast, margins, Supabase, frontend PRs | ✅ Active |
| **Data Pipeline Agent** | Sellerboard ingestion, BOL ingestion, Playwright webhook | 🔲 To be split out |
| **Exit & Strategy Agent** | Exit simulator, cap table, drag-along, scenarios, bank presentations | 🔲 To be split out |
| **Ops Agent** | VAT, COGS/landed costs, CARM, CITEO, shipping, compliance | 🔲 To be split out |

All agents share the same `Shared_Knowledge` table and `Supabase` project. Business rules flow one way: Tim updates `Shared_Knowledge` → all agents pick up at session start.

---

*Last updated: June 2026 | Maintained in `tim581/qualicoagents` → `agents/cfo.md`*
