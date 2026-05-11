# SQL Chunk Executor

Execute SQL chunks from /tmp/chunk_12_20_{N}.sql files against Supabase.

## Instructions

1. Read each SQL file from /tmp/
2. Execute using conn_xmaq9bngsgw6e19jxcjn__execute_sql with project ID zlteahycfmpiaxdbnlvr
3. Log results

## Execution Process

For each chunk 1-6:
- Read the complete SQL file content
- Execute with execute_sql tool
- Log: "✓ Chunk {N} executed: 3 agents inserted"
- On error: report the specific error

## After all chunks

Run verification:
```sql
SELECT COUNT(*) as total, COUNT(CASE WHEN content IS NOT NULL AND LENGTH(content) > 100 THEN 1 END) as with_content FROM agent_briefings;
```

## Output Format

Report:
- Chunks executed: [which chunks]
- Total agents inserted: [count]
- Final record count with content: [value]
- Any errors encountered
