# 📊 Sellerboard Data — Complete Briefing for CFO Agent

## What's Available

Multi Agent Mgr has scraped ALL Sellerboard P&L data across 8 Amazon markets for Jan–Apr 2026. Everything is in Supabase and Google Drive.

## Data Layers in Supabase

Table: `"Sellerboard_Exports"` (project `zlteahycfmpiaxdbnlvr` — always double-quote the table name!)

| view_type | What | Rows |
|-----------|------|------|
| `main_pl` | Full P&L summary per market (23-24 line items incl. monthly columns) | 8 |
| `per_asin` | Per-product aggregate (Apr 2026 YTD) | 8 |
| `monthly_pl` | Monthly P&L data (Jan–Apr 2026 columns) | 8 |
| `per_asin_monthly` | Per-ASIN per month breakdown (Jan–Apr 2026) | 8 |

### Quick Queries

```sql
-- Main P&L for all markets
SELECT market, headers, rows, row_count, exported_at 
FROM "Sellerboard_Exports" WHERE view_type = 'main_pl';

-- Per-ASIN aggregate data
SELECT market, headers, rows, row_count, exported_at 
FROM "Sellerboard_Exports" WHERE view_type = 'per_asin';

-- Monthly P&L (Jan-Apr 2026 columns per market)
SELECT market, headers, rows, row_count, exported_at 
FROM "Sellerboard_Exports" WHERE view_type = 'monthly_pl';

-- Per-ASIN per month (ASIN × Month breakdown)
SELECT market, headers, rows, row_count, exported_at 
FROM "Sellerboard_Exports" WHERE view_type = 'per_asin_monthly';
```

Data format: `headers` = JSON array of column names, `rows` = JSON array of arrays (each inner array = one row).

## The 8 Markets

| Account | Markets | Currency |
|---------|---------|----------|
| **Tim@qualico.be** (EU) | Amazon.co.uk, Amazon.de, Amazon.fr, Amazon.it, Amazon.es, Amazon.nl | € |
| **AMZ USA** | Amazon.com, Amazon.ca | $ |

⚠️ US/CA data starts March 2026 (account was configured in March). EU has Jan–Apr 2026.

## Google Drive CSVs

**CFO input folder**: `1_MxSUeXGE1bsJo7-cABJ3FUMFyJEHRXd`

42 CSV files total:

**Phase 1 — Aggregate (17 files):**
- `{Market}_Main_PL.csv` — full P&L summary (8 files)
- `{Market}_Per_ASIN.csv` — per-product aggregate (8 files)
- `ALL_Markets_Per_ASIN.csv` — combined master file (1 file)

**Phase 2 — Monthly P&L (16 files):**
- `{Market}_Monthly_PL_2026.csv` — 2026 columns only (8 files)
- `{Market}_Monthly_PL_Full.csv` — all columns (8 files)

**Phase 3 — Per-ASIN Monthly (9 files):**
- `{Market}_PerASIN_Monthly_2026.csv` — per ASIN per month (8 files)
- `ALL_Markets_PerASIN_Monthly_2026.csv` — combined master file (1 file)

Per-ASIN monthly columns: ASIN, Month, Units, Sales, Net Profit, Margin%, Refunds, Ad Cost

## How to Refresh Data (for future scrapes)

### Option A: Ask Multi Agent Mgr
Send a message to Multi Agent Mgr requesting a Sellerboard refresh. He has a persistent browser session logged in.

### Option B: Do It Yourself via Tasklet Browser

**Prerequisites**: Log into Sellerboard at `https://app.sellerboard.com` via your Tasklet browser.

**🔥 API Interception Method (fastest — no UI navigation needed):**

The Sellerboard app uses an internal API. After loading any dashboard page, you can call it directly:

```javascript
// Step 1: Call periods endpoint first (required)
await fetch('/en/dashboard/periods', {
  method: 'POST',
  headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
  body: JSON.stringify({periodStart: EPOCH_MS_START, periodEnd: EPOCH_MS_END, marketplaces: ['MARKET']})
});

// Step 2: Get per-ASIN entries
const resp = await fetch('/en/dashboard/entries', {
  method: 'POST', 
  headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
  body: JSON.stringify({periodStart: EPOCH_MS_START, periodEnd: EPOCH_MS_END, marketplaces: ['MARKET']})
});
const data = await resp.json();
// data.data = array of ASIN objects with sales/profit/units/etc.
```

Epoch timestamps (start of month 00:00 UTC → end of month 23:59:59 UTC):
- Jan 2026: 1735689600000 → 1738367999000
- Feb 2026: 1738368000000 → 1740787199000  
- Mar 2026: 1740787200000 → 1743465599000
- Apr 2026: 1743465600000 → 1746143999000
- May 2026: 1746144000000 → 1748822399000

Market values: `Amazon.de`, `Amazon.co.uk`, `Amazon.fr`, `Amazon.it`, `Amazon.es`, `Amazon.nl`, `Amazon.com`, `Amazon.ca`

**Account switching**: Click account name (top-right) → click target account. EU = Tim@qualico.be (default). US/CA = AMZ USA.

⚠️ **AMZ CA** in the dropdown is an EMPTY separate account — do NOT use it. Amazon.ca data lives under **AMZ USA**.

**UI Scraping Method (alternative — for main P&L table with monthly columns):**

```
1. Navigate: about:blank → wait 1s → https://app.sellerboard.com/en/dashboard/table?viewType=table&market[]=MARKET
2. Wait 10s for load
3. Table index 13 (0-based) = Main P&L (has monthly columns already)
4. Table index 14 = Per-ASIN aggregate (lazy-loads on scroll)
```

### Supabase Upsert Pattern

```sql
INSERT INTO "Sellerboard_Exports" (market, view_type, headers, rows, row_count, exported_at)
VALUES ('Amazon.de', 'per_asin_monthly', '<HEADERS>'::jsonb, '<ROWS>'::jsonb, 40, now())
ON CONFLICT (market, view_type) DO UPDATE SET 
  headers=EXCLUDED.headers, rows=EXCLUDED.rows, row_count=EXCLUDED.row_count, exported_at=now();
```

## Key Numbers (Apr 2026 snapshot)

| Market | Sales | Products |
|--------|-------|----------|
| 🇨🇦 Amazon.ca | $11,067 | 6 |
| 🇺🇸 Amazon.com | $18,924 | 8 |
| 🇬🇧 Amazon.co.uk | €10,303 | 8 |
| 🇩🇪 Amazon.de | €18,609 | 10 |
| 🇫🇷 Amazon.fr | €6,887 | 10 |
| 🇮🇹 Amazon.it | €80 | 9 |
| 🇪🇸 Amazon.es | €232 | 9 |
| 🇳🇱 Amazon.nl | €0 | 4 |

## Notes
- Sellerboard is a SPA — URL date params get overridden by cached state. Always navigate via `about:blank` first.
- The API method bypasses all SPA state issues — preferred for per-ASIN data.
- Main P&L table already contains ALL monthly columns in a single page load — no per-month navigation needed.
- Per-ASIN data requires either API calls per month or date picker interaction.
