# Execute SQL Batches

Executes SQL chunks sequentially for agent briefing updates.

## Instructions

Execute each chunk from `/agent/home/chunk_{N}.sql` for N = 1 to 13.

For each chunk:
1. Read the SQL file
2. Execute using `conn_xmaq9bngsgw6e19jxcjn__execute_sql`
3. Report result
4. Continue to next chunk

## Payload

Expects: `{"project_id": "zlteahycfmpiaxdbnlvr", "chunks": [1, 2, 3, ... 13]}`

## Expected Results

- 13 chunks executed
- 37 UPDATE statements total
- All 40 agent briefings updated with full content
- Final verification shows all records with LENGTH(content) > 100
