# Supabase Sellerboard Upsert

## Instructions

You must upsert Sellerboard export data into Supabase.

1. Read the file `/agent/home/all_clean_data.json` — this contains cleaned P&L data for 8 Amazon markets
2. For each market, execute TWO upserts into the `"Sellerboard_Exports"` table (ALWAYS double-quote the table name):
   - One for `view_type = 'main_pl'` (the main P&L data)
   - One for `view_type = 'per_asin'` (per-ASIN data)

Use `conn_xmaq9bngsgw6e19jxcjn__execute_sql` with `project_id = "zlteahycfmpiaxdbnlvr"`.

**SQL template for each upsert:**
```sql
INSERT INTO "Sellerboard_Exports" (market, view_type, headers, rows, row_count, exported_at)
VALUES ('<MARKET>', '<VIEW_TYPE>', '<HEADERS_JSON>'::jsonb, '<ROWS_JSON>'::jsonb, <ROW_COUNT>, now())
ON CONFLICT (market, view_type) DO UPDATE SET 
  headers=EXCLUDED.headers, rows=EXCLUDED.rows, row_count=EXCLUDED.row_count, exported_at=now();
```

Where:
- `<MARKET>` = the market name (e.g., 'Amazon.ca')
- `<VIEW_TYPE>` = 'main_pl' or 'per_asin'
- `<HEADERS_JSON>` = JSON array of headers (first row of mainPL or perAsin)
- `<ROWS_JSON>` = JSON array of data rows (all rows except first)
- `<ROW_COUNT>` = number of data rows

**CRITICAL**: Escape single quotes in the JSON data by doubling them (`'` → `''`).

**Markets**: Amazon.ca, Amazon.com, Amazon.co.uk, Amazon.de, Amazon.fr, Amazon.it, Amazon.es, Amazon.nl

Execute all 16 upserts (8 main_pl + 8 per_asin). Report how many succeeded and failed.

Do NOT write SQL to files — execute directly. Process one market at a time (both main_pl and per_asin together).
