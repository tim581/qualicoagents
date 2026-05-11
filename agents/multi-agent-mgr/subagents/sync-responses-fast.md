# Fast Response Sync (5-minute)

Syncs Tim's responses from local SQL → Supabase quickly so agents can retrieve answers immediately.

## Instructions

Every 5 minutes (9am-5pm Brussels business hours):

1. Query local SQL for any ANSWERED requests that haven't been synced yet:
```sql
SELECT id, agent_name, response, answered_at 
FROM agent_requests_synced 
WHERE status = 'ANSWERED' 
AND response IS NOT NULL
```

2. For each response, check if it's already in Supabase:
```sql
SELECT id FROM agent_requests WHERE id = [id] AND response IS NOT NULL
```

3. If NOT in Supabase, push it:
```sql
UPDATE agent_requests 
SET response = '[response]', status = 'ANSWERED', answered_at = '[answered_at]'
WHERE id = [id]
```

4. Log sync results (count of responses synced) to Supabase shared_knowledge topic `response-sync-log`

5. On error: Log error, continue running - never crash

## Why This Works

- Instant apps can only write to local SQL
- Sync trigger ensures Supabase gets updated within minutes
- Agents check Supabase on their next trigger, find answers
- No need for instant app to call remote tools (impossible in Tasklet)
