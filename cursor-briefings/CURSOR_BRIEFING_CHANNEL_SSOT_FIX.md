# Cursor Briefing: Channel & Product SSOT Fix

**Date**: 2026-06-16
**Priority**: HIGH — Vercel margins app shows empty set points for BOL.COM + all channels can't JOIN properly
**Scope**: Database schema + View rebuild + Vercel app

---

## Problem Summary

Two systemic issues prevent the margins app from showing price targets:

### Issue 1: Channel Name Mismatch
`puzzlup_channels` is SSOT for channel names, but two tables use different names:

| Table | BOL channel value | SSOT (`puzzlup_channels`) |
|---|---|---|
| `price_targets.channel_name` | `BOL.COM NL` ❌ | `BOL.COM` |
| `product_channel_content.channel` | `BOL.COM NL` ❌ | `BOL.COM` |

All other tables JOIN via `channel_id` FK → no mismatch.

### Issue 2: No ID-based JOINs Between price_targets and margins_connected

- `margins_connected` only exposes text columns: `product_name` ("Puzzlup MAT BLACK GIFT 1000"), `channel` ("AMZ DE"), `margin_id` (row PK)
- `price_targets` uses marketplace listing titles: "1000 Puzzelmat Gift", "Sorting Trays Noir 1500", etc.
- **Product names NEVER match** → all JOINs return NULL → empty set points in app

The underlying `puzzlup_margins` table HAS `product_id` and `channel_id` FKs — the view just doesn't expose them.

---

## Fix Plan (5 Steps)

### Step 1: Expose `product_id` and `channel_id` in `margins_connected` view

Add these two columns to the view's SELECT list from the base CTE:

```sql
-- In the base CTE, these already exist:
--   m.product_id  (from puzzlup_margins)
--   m.channel_id  (from puzzlup_margins)
-- Just add them to the final SELECT:

-- Add after "margin_id," in the final SELECT:
--   product_id,
--   channel_id,
```

The view already computes from `puzzlup_margins m JOIN Puzzlup_Product_Info p ON p.id = m.product_id JOIN puzzlup_channels ch ON ch.id = m.channel_id`. Just expose them.

### Step 2: Add `channel_id` FK to `price_targets`

```sql
-- Add column
ALTER TABLE price_targets ADD COLUMN channel_id INTEGER REFERENCES puzzlup_channels(id);

-- Backfill from puzzlup_channels using channel_name
UPDATE price_targets pt
SET channel_id = ch.id
FROM puzzlup_channels ch
WHERE ch.channel_name = pt.channel_name;

-- Handle BOL.COM NL → BOL.COM mismatch
UPDATE price_targets
SET channel_id = (SELECT id FROM puzzlup_channels WHERE channel_name = 'BOL.COM'),
    channel_name = 'BOL.COM'
WHERE channel_name = 'BOL.COM NL';
```

### Step 3: Fix `product_channel_content` channel name

```sql
UPDATE product_channel_content
SET channel = 'BOL.COM'
WHERE channel = 'BOL.COM NL';

-- Also add channel_id FK if not present
ALTER TABLE product_channel_content ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES puzzlup_channels(id);

UPDATE product_channel_content pcc
SET channel_id = ch.id
FROM puzzlup_channels ch
WHERE ch.channel_name = pcc.channel;
```

### Step 4: Rebuild `price_targets_ready` view

Current view has 3 filters that exclude BOL.COM:
- `pt.asin IS NOT NULL` — BOL products have no ASIN
- `pcc.fulfillment = 'FBA'` — BOL uses LvB
- Text-based JOIN on channel name (mismatched)

New view should JOIN via `product_id` + `channel_id`:

```sql
CREATE OR REPLACE VIEW price_targets_ready AS
SELECT
    pt.id,
    pt.product_id,
    pt.channel_id,
    pt.product_name,
    pt.channel_name,
    pt.ean,
    pt.asin,
    pt.offer_ref,
    pt.currency,
    pt.target_price,
    pt.sale_start_date,
    pt.sale_end_date,
    pt.status,
    pt.target_set_at,
    pt.target_set_by,
    pcc.list_price AS regular_price,
    pcc.fulfillment,
    pi.sku AS product_sku
FROM price_targets pt
LEFT JOIN product_channel_content pcc
    ON pcc.product_id = pt.product_id
    AND pcc.channel_id = pt.channel_id
LEFT JOIN "Puzzlup_Product_Info" pi
    ON pi.id = pt.product_id
WHERE pt.status = 'pending';
-- NO asin/fulfillment filters — works for both Amazon AND BOL
```

### Step 5: Update Vercel Margins App (`MarginsModule.tsx`)

The margins page must JOIN `price_targets` to `margins_connected` via `product_id` + `channel_id` (NOT text names):

```typescript
// When fetching set points alongside margins:
// JOIN on product_id + channel_id, not product_name + channel text

// Option A: Separate query, match client-side by product_id + channel_id
const { data: targets } = await supabase
  .from('price_targets')
  .select('product_id, channel_id, target_price, status')
  .eq('status', 'pending');

// Then match: margin.product_id === target.product_id && margin.channel_id === target.channel_id

// Option B: Database view that pre-joins them (preferred)
```

---

## Verification

After applying all fixes:

```sql
-- This should return rows for ALL channels including BOL.COM:
SELECT mc.product_name, mc.channel, mc.product_id, mc.channel_id,
       pt.target_price, pt.status
FROM margins_connected mc
LEFT JOIN price_targets pt
    ON pt.product_id = mc.product_id
    AND pt.channel_id = mc.channel_id
    AND pt.status = 'pending'
WHERE mc.channel = 'BOL.COM'
LIMIT 10;

-- And for Amazon (should still work):
SELECT mc.product_name, mc.channel, pt.target_price
FROM margins_connected mc
LEFT JOIN price_targets pt
    ON pt.product_id = mc.product_id
    AND pt.channel_id = mc.channel_id
    AND pt.status = 'pending'
WHERE mc.channel = 'AMZ DE'
LIMIT 10;
```

---

## Tables Already Properly Linked (No Fix Needed)

These 9 tables use `channel_id` FK → correct:
- `puzzlup_margins` ✅
- `puzzlup_sales_actuals` ✅
- `Puzzlup_sales_Forecast` ✅
- `puzzlup_pricing_adjustments` ✅
- `flieber_product_skus` ✅
- `puzzlup_channel_products` ✅
- `amazon_monitor_*` (3 tables) ✅

---

## Key Principle Going Forward

**ALL table JOINs must use `product_id` + `channel_id` integer FKs.**
Text-based `product_name` and `channel_name` are display labels only — never JOIN on them.
`puzzlup_channels` = SSOT for channel names/IDs.
`Puzzlup_Product_Info` = SSOT for product names/IDs.
