# Sellerboard P&L Masterdata Updater v2

Parse fresh Sellerboard exports from Supabase, update P&L_Masterdata with actuals, run sanity checks, update `pl_month_status`, and trigger cascade.

## Instructions

### Step 1: Fetch Sellerboard data

Query Supabase (project_id: `zlteahycfmpiaxdbnlvr`) for each market separately (to avoid truncation):

```sql
SELECT market, headers, rows, exported_at FROM "Sellerboard_Exports" 
WHERE view_type = 'main_pl' AND market = '{market}'
```

Markets to process (8 total):
- `Amazon.de` → `AMZ DE`
- `Amazon.co.uk` → `AMZ UK`
- `Amazon.fr` → `AMZ FR`
- `Amazon.es` → `AMZ ES`
- `Amazon.it` → `AMZ IT`
- `Amazon.nl` → `AMZ NL`
- `Amazon.com` → `AMZ USA`
- `Amazon.ca` → `AMZ CA`

Save each result to `/tmp/sb_{code}.json` using Python.

### Step 2: Write Python parser script

Save to `/tmp/parse_sellerboard.py` and run with: `uv run /tmp/parse_sellerboard.py`

The script must:

#### A) Load and decode JSON data

```python
import json, re

def decode_json_field(field):
    """Handle double-encoded JSON strings from Supabase."""
    if isinstance(field, str):
        parsed = json.loads(field)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return parsed
    return field
```

#### B) Clean cells

```python
def clean_cell(raw):
    """Parse a Sellerboard cell (innerText format) into float."""
    if raw is None or raw == '':
        return None
    text = str(raw)
    text = re.sub(r'<[^>]+>', '', text)  # Strip any HTML tags
    text = text.replace('∞', '')
    parts = [p.strip() for p in text.split('\n') if p.strip()]
    if not parts:
        return None
    val = parts[0]
    val = val.replace('€', '').replace('$', '').replace('£', '').strip()
    val = val.replace(',', '')  # Remove thousands separator
    if '%' in val:
        val = val.replace('%', '').strip()
        try: return float(val)
        except: return None
    if val in ('', '-', '—', 'N/A'):
        return None
    try: return float(val)
    except: return None
```

#### C) Map headers to month numbers

The headers array looks like:
`["Parameter/Date", "1-29 April 2026", "March", "February", "January", "December", ...]`

Map column index to 2026 month number:
- Column with "January" → month 1
- Column with "February" → month 2
- Column with "March" → month 3
- Column with "April" → month 4

Only process 2026 months (1-4 currently, but dynamically determine based on current date). Ignore 2025 columns.

**IMPORTANT**: The current month header may say "1-29 April 2026" (partial month). Include it — it's essentially complete near month end.

#### D) Row name → P&L line_item mapping

| Sellerboard Row (cell[0]) | P&L `line_item` | Notes |
|---|---|---|
| `Sales` | `Gross Revenue (incl. VAT)` | Positive |
| `VAT` | `VAT` | Negative (keep Sellerboard sign) |
| `Refund cost` | `Refunds / Returns` | Negative (keep Sellerboard sign) |
| `Cost of goods` | `COGS (Landed Cost)` | Negative (keep Sellerboard sign) |
| `Amazon fees` | `Amazon / Marketplace Fees` | Negative (keep Sellerboard sign) |
| `Advertising cost` | `PPC / Advertising` | Negative (keep Sellerboard sign) |
| `Promo` | `Promos / Coupons` | Negative (keep Sellerboard sign) |

**SKIP these rows**: `Units`, `Net Sales`, `Orders`, `Margin`, `ROI`, `Real ACOS`, `Buy Box OwnerShip`, `Page views`, `Conversion rate`, `Refunds` (unit count, not money), `Net profit`, `Other expenses`, `Organic Sales`, `PPC Sales`, `Storage fees`

**Amazon fees bundling**: Sellerboard gives ONE "Amazon fees" number. Put FULL amount into `Amazon / Marketplace Fees`. Set `FBA / Fulfillment & Storage`, `Other Platform Fees *`, `Amazon Other Fees` to 0.

#### E) Generate SQL updates

**CRITICAL**: The `P&L_Masterdata` table does NOT have a `data_source` column. Do NOT reference it in any SQL.

For EACH marketplace × month × line_item:

```sql
UPDATE "P&L_Masterdata"
SET amount = {value},
    source = 'sellerboard_actual'
WHERE marketplace = '{channel}'
  AND fiscal_year = 2026
  AND month = {month}
  AND line_item = '{line_item}'
  AND is_subtotal = false;
```

Also set zeroed-out fee lines:
```sql
UPDATE "P&L_Masterdata"
SET amount = 0, source = 'sellerboard_actual'
WHERE marketplace = '{channel}' AND fiscal_year = 2026 AND month = {month}
  AND line_item IN ('FBA / Fulfillment & Storage', 'Other Platform Fees *', 'Amazon Other Fees')
  AND is_subtotal = false;
```

#### G) Compute and insert subtotals

After raw line items, compute these for each marketplace × month:
- **Net Revenue** = Gross Revenue + VAT + Refunds/Returns (all values have correct sign)
- **Gross Profit** = Net Revenue + COGS
- **Gross Margin %** = (Gross Profit / Net Revenue) × 100
- **PPC / Advertising %** = (abs(PPC) / Gross Revenue) × 100
- **Total Cost of Sales** = Amazon fees + FBA + Other Platform + Amazon Other + Promos + PPC + Shipping
- **Contribution Margin (Brand Profit)** = Gross Profit + Total Cost of Sales
- **Contribution Margin %** = (CM / Net Revenue) × 100

Update these with the same SQL pattern.

#### H) Wrap in transaction with actuals protection bypass

```sql
BEGIN;
SET LOCAL app.bypass_actuals_protection = 'true';
-- all UPDATE statements here
COMMIT;
```

#### I) Clean up stale sellerboard_export rows

After all actuals are inserted, delete any orphan `sellerboard_export_*` rows. These are partial snapshots that should never coexist with `sellerboard_actual` data — they cause source deduplication bugs in `pl_monthly` and block forecast generation in `refresh_pl_forecast()`.

```sql
SET LOCAL app.bypass_actuals_protection = 'true';
DELETE FROM "P&L_Masterdata" WHERE source LIKE 'sellerboard_export%' AND fiscal_year = 2026;
```

### Step 3: Execute the SQL

Execute against Supabase project `zlteahycfmpiaxdbnlvr`. Split into batches per market if needed. Each batch = own transaction with bypass.

### Step 4: Update pl_month_status

For each marketplace × month that was updated:

```sql
INSERT INTO pl_month_status (marketplace, fiscal_year, month, status, updated_at)
VALUES ('{channel}', 2026, {month}, 'actual', now())
ON CONFLICT (marketplace, fiscal_year, month) 
DO UPDATE SET status = 'actual', updated_at = now();
```

### Step 5: Trigger cascade

```sql
SELECT refresh_pl_forecast();
```

This recalculates all computed fields and triggers auto-cascade (CF → BS → ICF).

### Step 6: Sanity Check Verification (CRITICAL)

After all updates, run these sanity checks by querying the updated data:

```sql
SELECT marketplace, month, line_item, amount
FROM "P&L_Masterdata"
WHERE fiscal_year = 2026 AND source = 'sellerboard_actual'
  AND month IN (1,2,3,4,5,6,7,8,9,10,11,12)
  AND line_item IN (
    'Gross Revenue (incl. VAT)', 'Net Revenue', 'Amazon / Marketplace Fees', 
    'PPC / Advertising', 'COGS (Landed Cost)', 'Contribution Margin (Brand Profit)'
  )
ORDER BY marketplace, month, display_order;
```

For each marketplace × month, verify:

1. **Revenue positive**: Gross Revenue > 0 (⚠️ flag if ≤ 0)
2. **Costs negative**: COGS, Fees, PPC should all be ≤ 0 (⚠️ flag if positive)
3. **AMZ Fees %**: abs(Fees) / Net Revenue should be 15-45% (⚠️ flag if outside range)
4. **TACOS %**: abs(PPC) / Gross Revenue should be 5-55% per channel bounds:
   - DE: 10-25%, UK: 12-28%, FR: 10-28%, ES: 20-70%, IT: 20-55%, NL: 5-25%, USA: 10-22%, CA: 10-25%
5. **Net Revenue formula**: Net Rev ≈ Gross Rev + VAT + Refunds (within €5)
6. **CM reasonable**: CM% should be -20% to +40% (⚠️ flag if outside)

#### YoY Growth Check (CRITICAL — catches fake/test data)

After updating, compare 2026 YTD actuals vs same months in 2025:

```sql
-- 2026 YTD gross revenue per marketplace (actuals only)
SELECT marketplace, SUM(amount) as rev_2026
FROM "P&L_Masterdata"
WHERE fiscal_year = 2026
  AND source IN ('sellerboard_actual', 'bol_api', 'bol_api_partial')
  AND line_item = 'Gross Revenue (incl. VAT)'
  AND month <= EXTRACT(MONTH FROM CURRENT_DATE)
GROUP BY marketplace;

-- Same months in 2025 for comparison
SELECT marketplace, SUM(amount) as rev_2025
FROM "P&L_Masterdata"
WHERE fiscal_year = 2025
  AND line_item = 'Gross Revenue (incl. VAT)'
  AND month <= EXTRACT(MONTH FROM CURRENT_DATE)
GROUP BY marketplace;
```

For each marketplace, compute: `growth_pct = (rev_2026 - rev_2025) / rev_2025 * 100`

**Expected 2026 growth: +10% to +30% YoY for total company.**

- ✅ Growth 10–30%: OK
- ⚠️ Growth 0–10% or 30–50%: warn but proceed
- 🔴 Growth < 0% or > 50%: **ABORT — do NOT commit this data. It is almost certainly fake/test data or a scrape error. Roll back with `ROLLBACK` and report error immediately to tim@qualico.be.**

This check exists because the Sellerboard scraper has been known to pull test data (e.g., sequential decimal patterns like 234,567.89 / 112,345.67 / 89,234.56). If you see numbers with suspicious round/sequential patterns, flag them even if growth is within range.

Collect all flags into a verification report.

### Step 7: Return summary

```
=== P&L MASTERDATA UPDATE REPORT ===

Markets updated: 7
Months: Jan-Apr 2026
Data source: sellerboard_export_YYYYMMDD

Per market summary:
| Market | Months | Total Net Rev | Total CM | CM% |
|--------|--------|---------------|----------|-----|
| AMZ DE | 1-4    | €189,432      | €26,543  | 14% |
...

SQL statements executed: {count}
pl_month_status updated: {count} rows
Cascade triggered: ✅

=== SANITY CHECK RESULTS ===

Total checks: {n}
✅ Passed: {n}
⚠️ Warnings: {n}
🔴 Failures: {n}

Warnings:
  ⚠️ AMZ ES Mar TACOS 68% — high but within ES bounds
  
Failures:
  🔴 [none]
```
