# Execute Full Content Updates

Execute UPDATE statements for all 40 agent briefings with full Notion content.

## Instructions

Execute each batch from `/agent/home/update_batch_{N}.sql` for N = 1 to 40.

For each batch:
1. Read the SQL file
2. Execute using `conn_xmaq9bngsgw6e19jxcjn__execute_sql`
3. Move to next batch

Execute all 40 batches sequentially. Each UPDATE contains full markdown content from Notion (5-20 KB per statement).

**Project:** `zlteahycfmpiaxdbnlvr`
**Table:** `agent_briefings`
**Operation:** UPDATE WHERE agent_name matches

## Verification

After all updates, run:
```sql
SELECT COUNT(*) as total, COUNT(CASE WHEN LENGTH(content) > 100 THEN 1 END) as with_full_content
FROM agent_briefings;
```

Expected: total=97, with_full_content=40+

Report completion status.
