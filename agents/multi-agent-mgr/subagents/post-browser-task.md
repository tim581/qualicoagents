# Post Browser Task

Posts a browser automation task to Supabase `Browser_Tasks` queue. Tim's PC picks it up automatically via `playwright-task-executor.js`.

## Instructions

### Step 1: Discover available task types
Query `Browser_Task_Registry` to see what's available:
```sql
SELECT task_type, display_name, description, env_vars, example_payload 
FROM "Browser_Task_Registry" WHERE available = true
```

### Step 2: Post the task
Insert into `Browser_Tasks` using `conn_xmaq9bngsgw6e19jxcjn__execute_sql` (project: `zlteahycfmpiaxdbnlvr`):

```sql
INSERT INTO "Browser_Tasks" (agent_name, task_type, status, created_at)
VALUES ('<YOUR_AGENT_NAME>', '<TASK_TYPE>', 'pending', now())
RETURNING id
```

For generic action-based tasks (not script-routed), also include `url` and `actions` (JSONB array):
```sql
INSERT INTO "Browser_Tasks" (agent_name, task_type, url, actions, status, created_at)
VALUES ('<AGENT>', 'custom', '<URL>', '[{"type":"navigate","url":"..."},{"type":"click","selector":"..."}]', 'pending', now())
RETURNING id
```

### Step 3: Report result
Return the task ID and confirm it was posted. Example:
```
✅ Browser task posted: ID=42, type=forecast-sync, status=pending
Tim's PC will pick this up within 30 seconds (if playwright-task-executor.js is running).
```

### Input (via payload)
The payload should contain:
- `agent_name` — which agent is requesting this
- `task_type` — one of the registered types (query Browser_Task_Registry if unsure)
- `url` (optional) — only for generic action-based tasks
- `actions` (optional) — only for generic action-based tasks

### Error handling
- If `task_type` is not in `Browser_Task_Registry`, warn the caller that it may not be routed.
- If Supabase write fails, report the error clearly.
