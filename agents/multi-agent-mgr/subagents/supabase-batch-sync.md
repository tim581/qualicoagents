# Supabase Batch Sync

Syncs queued local SQL writes to Supabase in batch. Runs on schedule (every 6 hours) to minimize Supabase tool calls.

## Instructions

### Step 1: Check for unsynced items
```sql
SELECT id, target_table, operation, payload, created_at 
FROM sync_queue 
WHERE synced_at IS NULL 
ORDER BY target_table, id
```

If no results, report "✅ Nothing to sync — queue empty" and stop.

### Step 2: Deduplicate and group by target table

**CRITICAL**: Before building batch SQL, deduplicate queue rows by unique constraint keys. Agents often queue multiple updates to the same key within one sync window.

- For `agents`: keep only the latest row per `agent_name` (by `id` DESC)
- For `shared_knowledge`: keep only the latest row per `(agent_name, topic, key)` combo (by `id` DESC)
- For `agent_requests`: keep all (no unique constraint issues)

Use SQL to deduplicate:
```sql
SELECT * FROM sync_queue WHERE synced_at IS NULL 
AND id IN (
  SELECT MAX(id) FROM sync_queue WHERE synced_at IS NULL 
  GROUP BY target_table, json_extract(payload, '$.agent_name'), 
    COALESCE(json_extract(payload, '$.topic'), ''), 
    COALESCE(json_extract(payload, '$.key'), '')
)
ORDER BY target_table, id
```

Then for each table, build a single batch SQL statement.

**For `agents` table (upsert):**
Parse each payload JSON. Build ONE statement. **Include domain column** (defaults to 'company' if missing from payload):
```sql
INSERT INTO agents (agent_name, department, webhook_url, status, last_seen, domain)
VALUES 
  ('name1', 'dept1', 'url1', 'active', NOW(), 'company'),
  ('name2', 'dept2', 'url2', 'active', NOW(), 'personal')
ON CONFLICT (agent_name) DO UPDATE SET
  department = EXCLUDED.department,
  webhook_url = EXCLUDED.webhook_url,
  status = EXCLUDED.status,
  last_seen = NOW(),
  domain = EXCLUDED.domain
```

**For `shared_knowledge` table (upsert):**
Parse each payload JSON. Build ONE statement. **Include domain column** (defaults to 'company' if missing from payload):
```sql
INSERT INTO shared_knowledge (agent_name, topic, key, value, as_of_date, updated_at, domain)
VALUES 
  ('agent1', 'topic1', 'key1', 'val1', 'date1', NOW(), 'company'),
  ('agent2', 'topic2', 'key2', 'val2', 'date2', NOW(), 'personal')
ON CONFLICT (agent_name, topic, key) DO UPDATE SET
  value = EXCLUDED.value,
  as_of_date = EXCLUDED.as_of_date,
  updated_at = NOW(),
  domain = EXCLUDED.domain
```

**For `agent_requests` table (insert):**
Parse each payload JSON. Build ONE INSERT with multiple VALUES rows.

### Step 3: Execute on Supabase
Use `conn_xmaq9bngsgw6e19jxcjn__execute_sql` with project_id `zlteahycfmpiaxdbnlvr`.
Execute one SQL call per target table (not per row!).

### Step 4: Mark as synced
After successful Supabase execution, mark all processed rows:
```sql
UPDATE sync_queue SET synced_at = datetime('now') WHERE id IN (list of processed IDs)
```

### Step 5: Clean up old synced items (keep 7 days for audit)
```sql
DELETE FROM sync_queue WHERE synced_at IS NOT NULL AND created_at < datetime('now', '-7 days')
```

### Step 6: Report
```
Supabase Batch Sync Complete:
- agents: X rows synced
- shared_knowledge: X rows synced  
- agent_requests: X rows synced
- Total Supabase calls: X (target: 1 per table)
- Queue items cleaned: X
```

### Step 7: Daily Webhook Health Check

After syncing, ping every active agent webhook to verify it's reachable. This prevents the "agents can't reach each other" problem by catching dead webhooks early.

**Get all active agents:**
```sql
SELECT agent_name, department, webhook_url 
FROM agents 
WHERE status != 'stale_webhook' AND webhook_url IS NOT NULL
  AND webhook_url NOT LIKE '%PLACEHOLDER%' AND webhook_url NOT LIKE '%TOKEN%'
ORDER BY agent_name
```

**For each agent**, send a lightweight ping via curl:
```
curl -s -o /dev/null -w "%{http_code}" -X POST "{webhook_url}" \
  -H "Content-Type: application/json" \
  -d '{"from_agent":"Hub Health Check","message_type":"heartbeat","subject":"Daily ping","data":{"status":"health_check"},"priority":"low"}' \
  --max-time 5
```

**Process results:**
- HTTP 200 → agent healthy, no action needed
- HTTP 404 → mark as stale:
  ```sql
  UPDATE agents SET status = 'stale_webhook' WHERE agent_name = '{name}'
  ```
- Timeout/error → log warning, do NOT mark stale (could be temporary)

**Report format:**
```
Webhook Health Check:
- ✅ Active: X agents (HTTP 200)
- ❌ Dead: X agents (HTTP 404) → marked stale_webhook
- ⚠️ Timeout: X agents (temporary, not marked)
Dead agents: [list names]
```

Only update agents table if 404s found (skip SQL writes if all healthy).

### ⚡ Credit Rules
- Maximum 1 Supabase call per target table (batch everything)
- If queue has 0 items, use 0 Supabase calls
- Target: 3-5 total tool calls per sync run (1 SQL read, 1-3 Supabase writes, 1 SQL cleanup)
- Webhook pings: use curl (zero credit cost) — skip already-stale agents
