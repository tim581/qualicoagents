# Broadcast: Storage Architecture Change

Sends a notification to all registered agents informing them of the new Supabase storage layer.

## Instructions

You are broadcasting a system update to all registered agents in the Multi Agent Mgr hub.

### Step 1: Get all agents with valid webhooks

Use `run_agent_memory_sql` to query:
```sql
SELECT agent_name, webhook_url FROM agents 
WHERE webhook_url IS NOT NULL 
AND webhook_url NOT LIKE '%PENDING%'
AND webhook_url NOT LIKE '%fake%'
AND webhook_url != ''
ORDER BY agent_name
```

### Step 2: POST to each agent's webhook

For each agent with a valid webhook URL, POST this JSON payload using a shell command (curl):

```json
{
  "from_agent": "Multi Agent Mgr (Hub)",
  "message_type": "system_update",
  "subject": "Storage architecture upgrade — no action required",
  "data": {
    "update": "The hub now mirrors all shared knowledge to Supabase (portable PostgreSQL) in addition to local SQL. Notion is no longer used as a live knowledge mirror. Your knowledge push format is unchanged — continue POSTing to the hub webhook as before. Supabase is your portable backup: if the stack ever migrates from Tasklet, all agent knowledge survives.",
    "your_action_required": false,
    "knowledge_push_webhook": "https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1",
    "format_unchanged": true
  }
}
```

Use curl to POST to each webhook:
```bash
curl -s -X POST "[webhook_url]" \
  -H "Content-Type: application/json" \
  -d '{"from_agent":"Multi Agent Mgr (Hub)","message_type":"system_update","subject":"Storage architecture upgrade — no action required","data":{"update":"The hub now mirrors all shared knowledge to Supabase (portable PostgreSQL). Notion is no longer used as a live knowledge mirror. Your knowledge push format is unchanged.","your_action_required":false}}'
```

### Step 3: Report results

Report:
- ✅ How many agents notified successfully (HTTP 200)
- ⚠️ How many failed or had no webhook
- List any failures with agent names
