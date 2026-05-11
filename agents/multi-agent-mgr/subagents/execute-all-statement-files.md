# Execute All 40 Statement Files

Execute all 40 individual SQL INSERT statements for the Notion agent briefings, one file at a time.

## Instructions

For each statement file from `/tmp/stmt_01.sql` through `/tmp/stmt_40.sql`:

1. Read the SQL statement file
2. Execute using `conn_xmaq9bngsgw6e19jxcjn__execute_sql` with project_id: `zlteahycfmpiaxdbnlvr`
3. Move to next statement
4. Continue for all 40 files

Each file contains a single INSERT...ON CONFLICT statement with full Notion content for one agent briefing.

## Expected Results

- 40 INSERT statements executed
- 40 agent briefings populated with full Notion page content (5-40 KB per briefing)
- All records have: agent_name, category, status, connections, frequency, key_resources, trigger_info, version, content, notion_page_url

## Final Verification

Run:
```sql
SELECT COUNT(*) as total, 
       COUNT(CASE WHEN LENGTH(content) > 500 THEN 1 END) as with_full_content
FROM agent_briefings WHERE notion_page_url IS NOT NULL;
```

Expected: total=40, with_full_content=40

Report total execution summary.
