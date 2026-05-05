# Agent Token Reduction Guide

Use this guide when an agent's conversation summary has grown too large and is wasting tokens on every run.

## The Problem

Conversation summaries accumulate everything discussed: DB schemas, product specs, bug fixes, COGS formulas, active records, lessons learned. This gets loaded as context on **every single trigger invocation**, even for trivial runs that find nothing to do.

**Rule of thumb**: If your summary is over 500 words, it's too big.

---

## The Fix: 3-Step Audit

### Step 1 — Remove anything that lives in Supabase

Supabase is the shared brain. Query it at runtime instead of hardcoding in the summary.

**Remove from summary if it's in Supabase:**
- Column names, table structures, DB schema → query `information_schema` or just use the known table when needed
- Product data, prices, specs, volumes → query `Puzzlup_Product_Info`, `COGS_Landed`
- Active records (orders, shipments, inventory) → query `TO_Transfers`, `PO_Purchases`, `Inventory_Levels`
- Business rules and dynamic state → query `"Shared_Knowledge"` (capital S, capital K — always double-quote in SQL)
- Container/pallet specs → query `Container_Standards`, `Pallet_Standards`, `Product_Pallet_Config`
- Historical bug fixes and lessons learned → write to `"Shared_Knowledge"` table under `domain='lessons'`, then remove from summary
- Long lists of field values, examples, formulas → query Supabase when actually needed

### Step 2 — Remove anything derivable at runtime

- Active TO/PO status → query `TO_Transfers`/`PO_Purchases` when needed
- Inventory levels → query `Inventory_Levels` when needed
- Trigger schedules → visible in agent state, no need in summary
- Previous run results → stored in `"Shared_Knowledge"` or `Order_Updates`

### Step 3 — Keep only what cannot be retrieved

✅ **Always keep:**
- Connection IDs and service names (not in any DB)
- Subagent file paths (not in any DB)
- ~10 critical business rules that exist NOWHERE in Supabase
- Key contact emails (or keep in `"Shared_Knowledge"`)
- Webhook trigger IDs

---

## Target: Under 500 Words

After auditing, write the new minimal summary to `/agent/home/AGENT_BRIEFING_MINIMAL.md` and show it to the user for approval.

---

## Additional Token Optimizations

Beyond the summary, apply these patterns in subagents and trigger handlers:

### 1. Guard Clause — Stop early if nothing to do

Before running any heavy logic, do a minimal check first:

```
# Example: Gmail guard clause
Do a minimal Gmail search (readMask: subject+sender only, maxResults: 5)
If 0 results → STOP immediately. Report: "0 emails found — scan skipped."
If results → continue with full processing
```

This prevents loading full email bodies, running Supabase queries, and calling multiple APIs when there's nothing actionable.

### 2. Two-Pass Data Fetching

Never fetch full data upfront. Fetch metadata first, then only get details for relevant records:

```
Pass 1: Fetch IDs + minimal fields (subject, sender, snippet)
Filter: skip already-processed IDs (local SQLite dedup)
Pass 2: Fetch full content ONLY for new, relevant records
```

Applies to: Gmail scans, Supabase queries, API calls.

### 3. SQL — Always Specific Columns

Never use `SELECT *`. Always name the columns you need:

```sql
-- Bad (wastes tokens on every unused column)
SELECT * FROM "TO_Transfers" WHERE status = 'In Transit';

-- Good
SELECT id, shipment_code, eta_fc, eta_ac, status FROM "TO_Transfers" WHERE status = 'In Transit';
```

Always add `LIMIT` unless you genuinely need all rows.

### 4. Intelligence Level — Match to Task Complexity

| Task type | Intelligence level | Relative cost |
|---|---|---|
| Routine scan (emails, inventory sync) | Basic ($) | 1x |
| Data analysis, drafting emails | Advanced ($$) | ~3x |
| Complex planning, calculations | Expert ($$$) | ~10x |
| Architecture, code review | Genius ($$$$) | ~30x |

Most trigger-based automation should run at **Basic or Advanced**.

### 5. Payload to Subagents — Minimal

Don't pass large JSON payloads to subagents. Pass only IDs or keys, let the subagent query Supabase for the full data.

```
# Bad: pass entire PO object as payload (500+ tokens)
# Good: pass po_id=42, subagent queries SELECT * FROM PO_Purchases WHERE id=42
```

### 6. Trigger Frequency — Only as Often as Needed

Audit each trigger:
- Is there actually new data to process most runs?
- What % of runs result in NO action taken?

If >50% of runs do nothing → reduce frequency.

```
Daily → 2x/week    (saves 5/7 = 71%)
2x/week → weekly   (saves 5/7 = 71%)
Weekly → monthly   (saves 3/4 = 75%)
```

### 7. Cache Within a Session

If subagent A fetches `Puzzlup_Product_Info`, write to `/tmp/products.json`.
Subagent B reads from `/tmp/products.json` instead of querying Supabase again.

```python
import json, os
cache = '/tmp/products.json'
if os.path.exists(cache):
    products = json.load(open(cache))
else:
    # query Supabase
    products = fetch_from_supabase()
    json.dump(products, open(cache, 'w'))
```

---

## Minimal Briefing Template

After applying this guide, your agent briefing should look like this:

```markdown
# [Agent Name] — Minimal Briefing

## Identity
- Company/owner
- Key contacts + CC rules
- Core business principle (1 line)

## Supabase (conn_xxx | project: yyy)
Query the DB for all data-driven knowledge.
Key tables: [list 4-5 most used tables]

## Critical Rules (not in Supabase)
[Max 10 rules. If it's in Supabase, remove it.]

## Connections
[connection ID → service name only]

## Active Triggers
[trigger → schedule → subagent path]

## Subagents
[paths only]
```

**Target: under 500 words total.**
