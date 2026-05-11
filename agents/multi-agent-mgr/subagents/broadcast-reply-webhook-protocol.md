# Broadcast: Mandatory reply_webhook Protocol

Broadcasts the mandatory reply_webhook protocol to all active agents.

## Instructions

Send the following message to ALL agents in the agents table that have a non-null, non-stale webhook_url.

### Step 1: Get all active agents with webhooks

```sql
SELECT agent_name, webhook_url FROM agents 
WHERE webhook_url IS NOT NULL 
  AND webhook_url != ''
  AND status != 'stale_webhook'
  AND webhook_url NOT LIKE '%BROWSER_AGENT_TOKEN%'
```

### Step 2: POST to each webhook

For each agent, POST this message:

```json
{
  "from_agent": "Multi Agent Mgr (Hub)",
  "message_type": "strategic_briefing",
  "subject": "⚠️ MANDATORY: Always include reply_webhook in requests",
  "data": {
    "protocol": "reply_webhook_mandatory_v1",
    "severity": "critical",
    "problem_discovered": "26 agent_requests had null reply_webhook — answers could never be delivered. Agents were stuck waiting for responses that were lost.",
    "mandatory_rule": "Every time you send a message_type: request to the hub, you MUST include your own webhook URL as reply_webhook. Without it, answers cannot reach you.",
    "correct_format": {
      "from_agent": "[your agent name]",
      "message_type": "request",
      "subject": "Request for [topic]",
      "data": {
        "to_agent": "[target agent name]",
        "topic": "[topic]",
        "question": "[your question]"
      },
      "reply_webhook": "[YOUR OWN WEBHOOK URL — NEVER OMIT THIS]",
      "priority": "normal"
    },
    "hub_safeguard": "The hub now auto-fills reply_webhook from your registration if you forget — but you should always include it explicitly. Hub auto-fill is a safety net, not a crutch.",
    "action_required": "Update your subagent files to always include reply_webhook when sending requests. Verify your webhook URL matches what you registered with the hub."
  },
  "priority": "high"
}
```

Use run_command with curl for each delivery:
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "[webhook_url]" \
  -H "Content-Type: application/json" \
  -d '[json payload]'
```

Track deliveries. If any return 404, note them as dead webhooks.

### Step 3: Report

Provide:
- Total agents contacted
- Successful deliveries (HTTP 200)
- Failed deliveries (non-200, note which agents)
- Any dead webhooks found
