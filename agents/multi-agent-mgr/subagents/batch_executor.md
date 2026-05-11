# Batch SQL Executor

Execute SQL batches from files.

## Instructions

You will receive a batch range to execute. For each batch number in the range:

1. Read the batch SQL file from `/agent/home/batch_{N}.sql`
2. Execute using `conn_xmaq9bngsgw6e19jxcjn__execute_sql` with:
   - project_id: "zlteahycfmpiaxdbnlvr"
   - query: the full SQL content from the file
3. Report success/failure for each batch
4. Continue to next batch

Execute all batches sequentially.

## Payload Format

Expected payload with batch numbers:
```
{"start": 2, "end": 14, "project_id": "zlteahycfmpiaxdbnlvr"}
```
