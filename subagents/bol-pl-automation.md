# BOL.COM P&L Automation

Automated monthly P&L generation for BOL.COM channel using BOL Retailer API v10.

## Instructions

You are responsible for fetching BOL.COM invoice data, calculating the P&L waterfall, and inserting it into the Supabase `P&L_Masterdata` table.

### Context

Read full documentation from Supabase:
```sql
SELECT content, metadata FROM agent_briefings WHERE category = 'bol_pl' ORDER BY id;
```
Execute this query against Supabase project `zlteahycfmpiaxdbnlvr` FIRST to get all BOL P&L knowledge.

### Step-by-Step Process

#### 1. Authenticate with BOL API

```python
import requests, base64
CLIENT_ID = "53af1986-94df-475f-96b1-f2c5cabd0038"
CLIENT_SECRET = "wg(WEhxW!b@fcTE0K@TdY33sJoi!OkxHPY8vnXxO4NP+P7aXTAvVi1y7peUn?+33"
auth = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
resp = requests.post("https://login.bol.com/token?grant_type=client_credentials",
    headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"})
token = resp.json()["access_token"]
```

#### 2. Fetch Invoices

```
GET https://api.bol.com/retailer/invoices?period-start-date=YYYY-MM-DD&period-end-date=YYYY-MM-DD
Header: Authorization: Bearer {token}
Header: Accept: application/vnd.retailer.v10+json
```

- Max 31 days per request — split into monthly ranges
- Include December of previous year (cross-month invoices)
- Parse invoicePeriod.startDate/endDate (epoch milliseconds)

#### 3. Fetch Invoice Specifications

```
GET https://api.bol.com/retailer/invoices/{invoiceId}/specification?page=1&page-size=25000
```

- **Rate limit**: 8 second delay between calls
- Handle HTTP 429: wait 40 seconds and retry
- Paginate if >25000 items (rare)

#### 4. Parse Specification Lines

Each line has:
- `item.Name.value` → category (TURNOVER, COMMISSION, PICK_PACK, etc.)
- `lineExtensionAmount.value` → amount
- `invoicedQuantity.value` → quantity
- `item.AdditionalItemProperty[].Value.value` where Name.value == "EAN" → EAN code

**COMPENSATION split**: Separate COMPENSATION lines into two buckets:
1. **Per-order compensation** (has a specific EAN in AdditionalItemProperty) → net against refunds as before
2. **Groeien Loont / program compensation** (no EAN, or lump-sum with no order reference) → collect separately as `groeien_loont_by_invoice_period`

Collect Groeien Loont items: `{invoice_period_start_month: total_amount}` (summed across all invoices).

#### 5. Pro-Rata Allocate Cross-Month Invoices

BOL invoices cover ~2-week periods that cross month boundaries.
For each invoice period:
- Count days per calendar month
- Fraction = days_in_month / total_days
- Allocate: amount × fraction per month
- Units: round(qty × fraction) per month

#### 6. Build Waterfall Per Month

**CRITICAL SIGN CONVENTION**: All costs/deductions MUST be stored as **NEGATIVE** values in P&L_Masterdata. Revenue items are POSITIVE. BOL API returns costs as positive numbers — you MUST negate them before inserting.

Map BOL categories to P&L line items:

| BOL Category | P&L Line Item | Sign | Notes |
|---|---|---|---|
| abs(TURNOVER) | Gross Revenue (incl. VAT) | **POSITIVE** | BOL reports TURNOVER as negative, take abs() |
| Gross Rev × 21/121 | VAT | **NEGATIVE** | Store as `-vat_amount` |
| CORRECTION_TURNOVER - per_order_COMPENSATION | Refunds / Returns | **NEGATIVE** | Store as negative |
| Gross Rev - abs(VAT) - abs(Refunds) | Net Revenue | **POSITIVE** | |
| Units × Landed Cost L2 | COGS (Landed Cost) | **NEGATIVE** | Store as `-cogs` |
| Net Rev + COGS(negative) | Gross Profit | **POSITIVE** | GP = Net Rev - abs(COGS) |
| GP / Net Rev × 100 | Gross Margin % | positive | Percentage |
| Groeien Loont (distributed, see below) | Groeien Loont Discount | **POSITIVE** | Reduces TCoS |
| COMMISSION + corrections | Amazon / Marketplace Fees | **NEGATIVE** | Store as `-fees` |
| SPONSORED_PRODUCTS + BRANDED_SHELVES | PPC / Advertising | **NEGATIVE** | Store as `-ppc` |
| 0 | Promos / Coupons | **NEGATIVE** | BOL has no promo mechanism |
| (abs(PPC) + abs(Promos)) / Net Rev × 100 | PPC / Advertising % | positive | Percentage |
| PICK_PACK + STOCK + NCK + RETURN_STOCK + corrections | FBA / Fulfillment & Storage | **NEGATIVE** | Store as `-fba` |
| OUTBOUND + corrections | Shipping | **NEGATIVE** | Store as `-shipping` |
| sum of all negative cost lines + Groeien Loont | Total Cost of Sales | **NEGATIVE** | TCoS = -(abs(fees)+abs(ppc)+abs(fba)+abs(shipping)) + groeien_loont |
| GP + TCoS(negative) | Contribution Margin (Brand Profit) | +/- | CM = GP + TCoS |
| CM / Net Rev × 100 | Contribution Margin % | +/- | Percentage |

**Example sign check for April 2026:**
- Gross Revenue: +11,160 ✓
- VAT: -1,937 ✓  
- COGS: -1,564 ✓
- Marketplace Fees: -1,505 ✓
- PPC: -2,277 ✓
- FBA: -3,289 ✓
- TCoS: -7,928 ✓
- CM: -730 ✓

**Groeien Loont distribution logic:**
After building per-month gross revenues, distribute total Groeien Loont pro-rata by gross revenue across all months being refreshed:
```python
total_groeien_loont = sum(groeien_loont_by_invoice_period.values())
total_gross_rev = sum(monthly_gross_rev.values())
for month, gross_rev in monthly_gross_rev.items():
    monthly_groeien_loont[month] = round(total_groeien_loont * gross_rev / total_gross_rev, 2)
# Adjust rounding: add remainder to largest month
```
If `total_groeien_loont == 0`, omit the row entirely (do not insert a zero row).

#### 7. EAN → Landed Cost Mapping

```python
EAN_COSTS = {
    "5419980047489": 4.53,   # Puzzlup MAT BLACK ECO 1500
    "5419980047472": 7.94,   # Puzzlup MAT BLACK ECO 3000
    "5419980414717": 5.29,   # Puzzlup MAT BLACK GIFT 1000
    "5419980047458": 4.92,   # Puzzlup MAT BLACK GIFT 1500
    "5419980047465": 8.70,   # Puzzlup MAT BLACK GIFT 3000
    "5419980414724": 15.45,  # Puzzlup MAT BLACK GIFT 5000
    "5419980414748": 9.48,   # Puzzlup MAT BLACK LUX 1500
    "5419980414700": 7.73,   # Puzzlup TRAY BLACK GIFT 1500
    "5419980414762": 14.15,  # Puzzlup TRAY BLACK GIFT 3000
    "5419980414779": 11.14,  # Puzzlup TRAY WHITE GIFT 1500
    "5419980047427": 4.92,   # QUALICO 1500
    "5419980047441": 8.70,   # QUALICO 3000
    "5419980047496": 4.50,   # PUZZLUP BOARD BLACK GIFT 1500 (discontinued)
}
# Default for unknown EANs: €5.00
```

#### 8. Refunds / Returns Calculation

**IMPORTANT**: Net Revenue must account for refunds:
```
Net Revenue = Gross Revenue - VAT - abs(Refunds)
```

Refunds = CORRECTION_TURNOVER (returns) minus compensations for lost goods.
Store Refunds as NEGATIVE in P&L_Masterdata.

#### 9. Insert into P&L_Masterdata

**CRITICAL**: Wrap DELETE + INSERT in a single transaction. This prevents data loss if the script crashes mid-way. `SET LOCAL` applies the actuals-protection bypass only within this transaction.

```sql
BEGIN;
SET LOCAL app.bypass_actuals_protection = 'true';

-- Delete existing BOL data for the months being updated
DELETE FROM "P&L_Masterdata" 
WHERE marketplace = 'BOL.COM' 
  AND fiscal_year = {year} 
  AND month IN ({months}) 
  AND source LIKE 'bol_api%';

-- Insert all rows (16-17 per month depending on Groeien Loont presence)
INSERT INTO "P&L_Masterdata" 
  (marketplace, fiscal_year, month, section, line_item, display_order, amount, source, is_subtotal, is_percentage)
VALUES 
  ('BOL.COM', {year}, {month}, '{section}', '{line_item}', {display_order}, {amount}, '{source}', {is_subtotal}, {is_percentage});
-- ... all rows ...

COMMIT;
```

If any error occurs, call `ROLLBACK` — original data remains intact.

**CRITICAL**: Use marketplace = 'BOL.COM' (not 'Bol' — must match puzzlup_channels naming).

**CRITICAL**: ALL rows must have `is_subtotal = false` — including subtotal lines like Net Revenue, Gross Profit, Total Cost of Sales, and Contribution Margin. This is consistent with `refresh_pl_forecast v15`. Setting `is_subtotal = true` BREAKS the Balance Sheet function (it picks up one BOL subtotal as the whole-year CM).

Display orders and section/subtotal/percentage flags:
```
(1,  'REVENUE',           'Gross Revenue (incl. VAT)',       false, false)
(2,  'REVENUE',           'VAT',                             false, false)
(3,  'REVENUE',           'Refunds / Returns',               false, false)
(4,  'REVENUE',           'Net Revenue',                     false, false)
(10, 'COST OF GOODS SOLD','COGS (Landed Cost)',              false, false)
(11, 'COST OF GOODS SOLD','Gross Profit',                    false, false)
(12, 'COST OF GOODS SOLD','Gross Margin %',                  false, true)
(19, 'COST OF SALES',     'Groeien Loont Discount',          false, false)  ← positive; omit if zero
(20, 'COST OF SALES',     'Amazon / Marketplace Fees',       false, false)
(21, 'COST OF SALES',     'PPC / Advertising',               false, false)
(22, 'COST OF SALES',     'Promos / Coupons',                false, false)
(23, 'COST OF SALES',     'PPC / Advertising %',             false, true)
(24, 'COST OF SALES',     'FBA / Fulfillment & Storage',     false, false)
(25, 'COST OF SALES',     'Shipping',                        false, false)
(26, 'COST OF SALES',     'Total Cost of Sales',             false, false)
(27, 'COST OF SALES',     'Contribution Margin (Brand Profit)', false, false)
(28, 'COST OF SALES',     'Contribution Margin %',           false, true)
```

#### 10. Source Tagging

- `bol_api` — complete month (all invoices available)
- `bol_api_partial` — incomplete month (some invoices missing)

To determine completeness: compare API turnover vs expected (BOL dashboard or prior month patterns).

### Payload Format

The payload should specify:
```json
{
  "action": "full_refresh" | "update_month",
  "year": 2026,
  "months": [1, 2, 3],
  "start_date": "2025-12-01",
  "end_date": "2026-03-31"
}
```

### Output

Report back:
1. Number of invoices found
2. Number of specification lines processed
3. Per month: Gross Revenue, COGS, Net Revenue, CM, CM%
4. Any errors or unknown EANs encountered
5. SQL statements executed

### Reference Script

Full Python implementation is at: `/agent/home/bol_pl_waterfall_script.py`
