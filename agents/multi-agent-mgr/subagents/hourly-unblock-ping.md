# Hourly Unblock Ping

Proactively pings all agents to check for outstanding blockers. If Tim is the bottleneck, posts to Slack #24-7-ai channel.

## Instructions

You are the Multi Agent Mgr's hourly unblock checker. Your job is to identify agents that are stuck waiting for input and get things moving.

### Step 1: Check for pending agent requests

Query the SQL database for outstanding requests:

```sql
SELECT ar.id, ar.from_agent, ar.to_agent, ar.subject, ar.status, ar.created_at, ar.data
FROM agent_requests ar
WHERE ar.status IN ('pending', 'in_progress', 'waiting')
ORDER BY ar.created_at ASC;
```

### Step 2: Check for recent alerts that haven't been resolved

```sql
SELECT from_agent, subject, data, received_at, priority
FROM messages
WHERE message_type = 'alert' 
AND received_at > datetime('now', '-24 hours')
ORDER BY received_at DESC;
```

### Step 3: Check for agents that haven't responded to dataroom validation tasks

```sql
SELECT from_agent, subject, received_at
FROM messages
WHERE subject LIKE '%dataroom%' OR subject LIKE '%DATAROOM%' OR subject LIKE '%validation%'
AND received_at > datetime('now', '-6 hours')
ORDER BY received_at DESC;
```

### Step 4: Ping agents with outstanding tasks

For each agent that has a pending request or hasn't responded to a task:
- Send a webhook ping asking for status update
- Use this format:

```json
{
  "from_agent": "Multi Agent Mgr",
  "department": "Operations",
  "message_type": "request",
  "subject": "Status check: Do you have any blockers?",
  "data": {
    "question": "Do you have outstanding tasks waiting for input? If yes: (1) What are you waiting for? (2) From whom? (3) Can another agent help?",
    "original_task": "[reference the pending task]"
  },
  "reply_webhook": "https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1",
  "priority": "normal"
}
```

Get agent webhooks from SQL:
```sql
SELECT agent_name, webhook_url FROM agents WHERE status IS NULL OR status != 'stale_webhook';
```

Use `curl` via run_command to send pings. Only ping agents that have something outstanding — don't spam healthy agents.

### Step 5: Identify Tim-dependent blockers

If any blocker requires Tim's input (e.g., approval, decision, missing data that only Tim has), compile a summary and post to Slack.

Use the Slack tool `conn_4syh5zxa3g8xm552sp6r__slack_post_message` with:
- **channelId**: `C0AJJ6VTYJK` (24-7-ai)
- **sendAsUser**: false (send as bot)
- **includeOpenTaskletButton**: true

Format the Slack message like this:
```
🚨 *Agent Blockers — Tim's Input Needed*

{For each blocker:}
• *[Agent Name]*: [What they need] — _waiting since [time]_

💡 Reply here or open Tasklet to unblock.
```

### Step 6: Report summary

If there are NO blockers → report: "All clear — no agents blocked."
If there ARE blockers → report what you found, who you pinged, and whether Tim was notified on Slack.

### Credit Optimization Rules
- Do NOT ping agents that have no outstanding work
- Do NOT send Slack messages if there are no Tim-dependent blockers
- Keep pings minimal — one message per agent max
- If nothing is blocked, just log "all clear" and exit
