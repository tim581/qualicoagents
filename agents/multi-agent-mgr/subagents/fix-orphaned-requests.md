# Fix Orphaned Agent Requests

Fixes all pending agent_requests with missing reply_webhook and re-delivers recent high-priority ones.

## Instructions

You are fixing a systemic bug: many agent_requests were stored with `reply_webhook = null`, meaning answers can never be delivered. Your job is to:

1. Auto-fill reply_webhook from agents table for all null cases
2. Fix wrong reply_webhook on request #60
3. Re-deliver recent high-priority requests to their target agents
4. Mark stale requests to UNSPECIFIED/UNKNOWN targets as failed
5. Ping Personal Assistant to check if it's alive

### Step 1: Get all pending requests with null reply_webhook

```sql
SELECT ar.id, ar.from_agent, ar.to_agent, ar.topic, ar.question, ar.reply_webhook, ar.created_at,
       a.webhook_url as sender_webhook
FROM agent_requests ar
LEFT JOIN agents a ON a.agent_name = ar.from_agent
WHERE ar.status = 'pending' AND (ar.reply_webhook IS NULL OR ar.reply_webhook = '')
ORDER BY ar.created_at DESC
```

### Step 2: Fix reply_webhook for all records where sender has a known webhook

For each record where `sender_webhook` is not null, update the agent_request:
```sql
UPDATE agent_requests SET reply_webhook = '[sender_webhook]' WHERE id = [id]
```

Run one UPDATE per record. Report: "🔧 Fixed reply_webhook for request #[id]: [from_agent] → [to_agent] re: [topic]"

### Step 3: Fix wrong reply_webhook on request #60

Request #60 has from_agent "Qualico Investor & Finance Agent" but wrong reply_webhook (points to Email Assistant).
The correct webhook for Qualico Investor & Finance Agent is in the agents table.

```sql
SELECT webhook_url FROM agents WHERE agent_name = 'Qualico Investor & Finance Agent'
```

Then fix it:
```sql
UPDATE agent_requests SET reply_webhook = '[correct_webhook]' WHERE id = 60
```

### Step 4: Mark stale unroutable requests as failed

Mark old requests (created before 2026-03-06) with to_agent IN ('UNSPECIFIED', 'UNKNOWN', 'UNASSIGNED') as failed:
```sql
UPDATE agent_requests 
SET status = 'failed', answer = 'Auto-failed: no valid target agent specified. Please re-submit with correct to_agent.'
WHERE status = 'pending' 
  AND to_agent IN ('UNSPECIFIED', 'UNKNOWN', 'UNASSIGNED', 'CFO', 'Asana Manager', 'Research Assistant', 'Qualico Research Agent')
  AND created_at < '2026-03-06 00:00:00'
```

Report how many were marked failed.

### Step 5: Re-deliver recent high-priority pending requests (created 2026-03-06)

Get recent pending requests to agents that have working webhooks:
```sql
SELECT ar.id, ar.from_agent, ar.to_agent, ar.topic, ar.question, ar.reply_webhook,
       a.webhook_url as target_webhook
FROM agent_requests ar
LEFT JOIN agents a ON (a.agent_name = ar.to_agent 
   OR a.agent_name LIKE '%' || CASE 
     WHEN ar.to_agent LIKE '%CFO%' THEN 'CFO' 
     WHEN ar.to_agent LIKE '%Research%' THEN 'Research'
     WHEN ar.to_agent LIKE '%Personal Assistant%' THEN 'Personal Assistant'
     WHEN ar.to_agent LIKE '%Asana%' THEN 'Asana'
     ELSE ar.to_agent 
   END || '%')
WHERE ar.status = 'pending' 
  AND ar.created_at >= '2026-03-06 00:00:00'
  AND ar.to_agent NOT IN ('UNSPECIFIED', 'UNKNOWN', 'UNASSIGNED')
ORDER BY ar.id DESC
LIMIT 20
```

For each result that has a target_webhook, POST to that webhook:
```json
{
  "from_agent": "Multi Agent Mgr (Hub)",
  "message_type": "incoming_request",
  "request_id": "[id]",
  "from": "[from_agent]",
  "topic": "[topic]",
  "question": "[question]",
  "reply_webhook": "https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1",
  "instructions": "Please answer this request and POST back to the reply_webhook with message_type: answer, including the request_id in your data."
}
```

Use web_scrape_website or run_command with curl to POST. Use the run_command tool with curl:
```bash
curl -s -X POST "[target_webhook]" \
  -H "Content-Type: application/json" \
  -d '{"from_agent":"Multi Agent Mgr (Hub)","message_type":"incoming_request","request_id":[id],"from":"[from_agent]","topic":"[topic]","question":"[escaped_question]","reply_webhook":"https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1","instructions":"Please answer this request and POST back to the reply_webhook with message_type: answer, including the request_id in your data."}'
```

Report success/failure for each delivery. If a 404 is returned, note the webhook is dead.

### Step 6: Ping Personal Assistant

Check if Personal Assistant webhook is alive:
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "https://webhooks.tasklet.ai/v1/public/webhook?token=1b7b02f6558a9022272856efbb99caa2" \
  -H "Content-Type: application/json" \
  -d '{"from_agent":"Multi Agent Mgr (Hub)","message_type":"update","subject":"Connectivity check","data":{"message":"Hub checking if you are online. Please send a heartbeat or update back."}}'
```

Report the HTTP status code. If 200 = alive, if 404 = dead webhook.

### Final Report

Provide a summary:
- How many reply_webhooks were auto-filled
- How many stale requests were failed
- How many requests were re-delivered (success/fail)
- Personal Assistant webhook status (alive/dead)
- Any webhooks that returned 404 (dead agents)
