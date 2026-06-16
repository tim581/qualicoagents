# Cursor Briefing: Channel Name SSOT Fix

**Date**: 2026-06-16  
**Priority**: HIGH — blocks BOL.COM pricing visibility in Vercel margins app  
**Impact**: `price_targets_ready` view returns empty for BOL.COM; Vercel margins page shows no BOL set points

---

## Problem

`puzzlup_channels` is the SSOT for channel names and IDs. Most tables correctly link via `channel_id` FK. However, two tables use **text-only** channel names with **no FK** — and their BOL channel name doesn't match the SSOT.

### Channel Name Mismatch

| Source | BOL channel name | Links via |
|---|---|---|
| `puzzlup_channels` (SSOT) | `BOL.COM` (id=33) | — |
| `puzzlup_margins` | `BOL.COM` ✅ | `channel_id` FK + redundant `channel` text |
| `price_targets` | `BOL.COM NL` ❌ | text only (`channel_name`), no FK |
| `product_channel_content` | `BOL.COM NL` ❌ | text only (`channel`), no FK |

### Additional Issue: `price_targets_ready` View

This view has 3 filters that **exclude all BOL.COM products**:
1. `pt.asin IS NOT NULL` — BOL products have no ASIN
2. `pcc.fulfillment = 'FBA'` — BOL uses LvB, not FBA
3. Text JOIN `pcc.channel = pt.channel_name` — fails due to name mismatch

---

## Tables Correctly Linked (no changes needed)

These all use `channel_id` FK → `puzzlup_channels.id`:
- `puzzlup_margins` ✅
- `puzzlup_sales_actuals` ✅
- `Puzzlup_sales_Forecast` ✅
- `puzzlup_pricing_adjustments` ✅
- `flieber_product_skus` ✅
- `puzzlup_channel_products` ✅
- `amazon_monitor_puzzlup` ✅
- `amazon_monitor_fba_puzzlup` ✅
- `amazon_monitor_fbm_puzzlup` ✅

---

## Fix Required

### Step 1: Add `channel_id` FK to broken tables

**`price_targets`** — add `channel_id` integer column with FK to `puzzlup_channels.id`:
```sql
ALTER TABLE price_targets ADD COLUMN channel_id integer REFERENCES puzzlup_channels(id);

-- Populate from puzzlup_channels using best-effort text match
UPDATE price_targets pt
SET channel_id = c.id
FROM puzzlup_channels c
WHERE c.channel_name = pt.channel_name;

-- Handle BOL.COM NL → BOL.COM mismatch
UPDATE price_targets
SET channel_id = 33, channel_name = 'BOL.COM'
WHERE channel_name = 'BOL.COM NL';
```

**`product_channel_content`** — add `channel_id` integer column with FK to `puzzlup_channels.id`:
```sql
ALTER TABLE product_channel_content ADD COLUMN channel_id integer REFERENCES puzzlup_channels(id);

-- Populate from puzzlup_channels
UPDATE product_channel_content pcc
SET channel_id = c.id
FROM puzzlup_channels c
WHERE c.channel_name = pcc.channel;

-- Handle BOL.COM NL → BOL.COM mismatch
UPDATE product_channel_content
SET channel_id = 33, channel = 'BOL.COM'
WHERE channel = 'BOL.COM NL';
```

### Step 2: Update text values to match SSOT

After populating `channel_id`, ensure all text `channel` / `channel_name` fields match `puzzlup_channels.channel_name`. The only known mismatch is `BOL.COM NL` → `BOL.COM` (handled above).

### Step 3: Rebuild `price_targets_ready` view

The view must:
1. JOIN via `channel_id` instead of text matching
2. **Remove** the `asin IS NOT NULL` filter (BOL products have no ASIN)
3. **Remove** the `fulfillment = 'FBA'` filter (BOL uses LvB)
4. Use `COALESCE(pt.asin, pt.offer_ref)` as the product identifier

```sql
CREATE OR REPLACE VIEW price_targets_ready AS
SELECT
    pt.id,
    pt.product_id,
    pt.product_name,
    pt.channel_name,
    pt.channel_id,
    pt.asin,
    pt.offer_ref,
    pt.ean,
    pt.currency,
    pt.target_price AS sale_price_target,
    pt.regular_price,
    pcc.list_price,
    pt.sale_start_date,
    pt.sale_end_date,
    pt.status,
    pt.target_set_at,
    pt.target_set_by
FROM price_targets pt
LEFT JOIN product_channel_content pcc
    ON pcc.product_id = pt.product_id
    AND pcc.channel_id = pt.channel_id
WHERE pt.status IN ('pending', 'synced', 'failed');
```

### Step 4: Update Vercel app `MarginsModule.tsx`

If the margins page JOINs `margins_connected` to `price_targets` via text channel name, update to JOIN via `channel_id` instead:

```typescript
// Before (text match — breaks on BOL.COM vs BOL.COM NL):
// .eq('channel_name', row.channel)

// After (proper FK join):
// .eq('channel_id', row.channel_id)
```

### Step 5: Remove redundant `channel` text from `puzzlup_margins` (optional, low priority)

`puzzlup_margins` has both `channel_id` (FK) and `channel` (text). The text column is redundant. Consider:
- Removing it from the table
- Or at minimum, keeping it in sync via a trigger

---

## Verification

After applying, verify:
```sql
-- Should return BOL.COM rows now
SELECT * FROM price_targets_ready WHERE channel_name = 'BOL.COM' LIMIT 5;

-- Should show no orphaned channel names
SELECT DISTINCT pt.channel_name 
FROM price_targets pt 
LEFT JOIN puzzlup_channels c ON pt.channel_id = c.id 
WHERE c.id IS NULL;

-- Same for product_channel_content
SELECT DISTINCT pcc.channel 
FROM product_channel_content pcc 
LEFT JOIN puzzlup_channels c ON pcc.channel_id = c.id 
WHERE c.id IS NULL;
```
