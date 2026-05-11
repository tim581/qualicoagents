# Execute SQL Batch

Executes individual SQL chunks for agent briefing updates.

## Instructions

For each chunk file `/agent/home/chunk_{N}.sql`:

1. Read the SQL file in full
2. For each UPDATE statement in the file (separated by double newlines):
   - Extract the complete UPDATE statement
   - Ensure proper escaping (single quotes doubled, backslashes escaped)
   - Execute via `conn_xmaq9bngsgw6e19jxcjn__execute_sql`
   - Report: "✅ Chunk N, Statement X: SUCCESS" or "❌ FAILED: [error]"
3. Continue to next chunk

## Key Details

- Project ID: `zlteahycfmpiaxdbnlvr`
- Expected: 13 chunks, 37 total UPDATEs
- Verify: All records updated with `LENGTH(content) > 100`
- Report final count after all chunks executed

## Payload

Input: `{"chunks": [1, 2, 3, ..., 13]}` from parent agent
