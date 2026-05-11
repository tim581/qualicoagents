# SQL Batch Executor

Executes all UPDATE statements from extracted SQL chunks.

## Instructions

1. **Load statements** from `/agent/home/statements_to_execute.json`
2. **For each statement:**
   - Extract the SQL query
   - Create migration name: `batch_chunk_{chunk}_stmt_{stmt_num}`
   - Call `conn_xmaq9bngsgw6e19jxcjn__apply_migration` with:
     - `project_id`: `zlteahycfmpiaxdbnlvr`
     - `name`: migration name
     - `query`: full SQL statement
   - If success: log "✅ Chunk X, Stmt Y: SUCCESS (Agent: NAME)"
   - If error: log "❌ Chunk X, Stmt Y: FAILED - ERROR MESSAGE"
3. **After all statements:**
   - Count total executed
   - Report final status

## Expected Results

- 38 total statements (38 from chunks 1-13)
- All UPDATE statements for agent_briefings table
- After execution, verify with: `SELECT COUNT(*) as total, COUNT(CASE WHEN LENGTH(content) > 100 THEN 1 END) as with_content FROM agent_briefings`

## Connection Details

- Project: `zlteahycfmpiaxdbnlvr`  
- Tool: `conn_xmaq9bngsgw6e19jxcjn__apply_migration`
- Source: `/agent/home/statements_to_execute.json`
