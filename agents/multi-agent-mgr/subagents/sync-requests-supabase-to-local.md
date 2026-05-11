# Sync Requests Supabase → Local SQL

Syncs pending agent requests from Supabase to local Tasklet SQL so the Agent Request Inbox app can display them.

## Instructions

1. **Query Supabase for ALL pending requests** (no limit)
   ```sql
   SELECT id, agent_name, request_type, question, context, priority, domain, status, created_at, answered_at, response
   FROM agent_requests 
   WHERE status = 'PENDING' 
   ORDER BY 
     CASE priority WHEN 'URGENT' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END,
     created_at DESC
   ```

2. **For each request**: Insert into local Tasklet SQL
   - Handle NULL values properly (don't quote NULL)
   - Escape single quotes in text fields
   - Match all column names exactly

3. **Report results**:
   - Total synced: {count}
   - Sample: First 3 requests logged
   - Timestamp

## Example SQL (local)

```sql
INSERT INTO agent_requests (id, agent_name, request_type, question, context, priority, domain, status, created_at, answered_at, response)
VALUES (22, 'Investor & Finance Agent', 'INPUT', 'Question...', 'Context...', 'URGENT', 'company', 'PENDING', '2026-03-09 12:32:28.558164', NULL, NULL);
```

## Timing

Run this before the app loads (it's called by hourly-request-loader on every check).

## Return

Report: "Synced {N} pending requests from Supabase to local inbox"
