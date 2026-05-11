# Hourly Agent Unblock Loop

Proactively checks all agents for outstanding blocked work and gets things moving again.

## Instructions

### Step 1: Check for Outstanding Requests

Query the SQL database for pending/unanswered agent requests:

```sql
SELECT ar.id, ar.from_agent, ar.to_agent, ar.subject, ar.status, ar.created_at,
       julianday('now') - julianday(ar.created_at) as days_pending
FROM agent_requests ar
WHERE ar.status IN ('pending', 'sent', 'routed')
AND julianday('now') - julianday(ar.created_at) > 0.04  -- older than ~1 hour
ORDER BY ar.created_at ASC;
```

### Step 2: Check Recent Messages for Stuck Patterns

Look for agents that sent requests but never got responses:

```sql
SELECT m.from_agent, m.subject, m.received_at, m.message_type
FROM messages m
WHERE m.message_type IN ('request', 'alert')
AND m.received_at > datetime('now', '-24 hours')
ORDER BY m.received_at DESC
LIMIT 30;
```

Also check for agents that haven't communicated in over 24 hours (might be stuck):

```sql
SELECT a.agent_name, a.department, a.webhook_url, a.status,
       (SELECT MAX(m2.received_at) FROM messages m2 WHERE m2.from_agent = a.agent_name) as last_message
FROM agents a
WHERE a.status != 'stale_webhook'
ORDER BY last_message ASC
LIMIT 10;
```

### Step 3: Categorize Blockers

For each stuck item, categorize who/what is blocking:

1. **Agent → Agent**: One agent waiting on another agent's response
2. **Agent → Hub**: Agent sent something to hub that wasn't processed
3. **Agent → Tim**: Agent needs human input/decision/approval

### Step 4: Take Action

**For Agent → Agent blocks:**
- Ping the blocking agent's webhook with a reminder:
```json
{
  "from_agent": "Multi Agent Mgr",
  "department": "Operations",
  "message_type": "request",
  "subject": "REMINDER: Outstanding request from [requesting_agent]",
  "data": {
    "original_request": "[subject]",
    "waiting_since": "[timestamp]",
    "action_needed": "Please respond to this request or escalate if blocked"
  },
  "reply_webhook": "https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1",
  "priority": "high"
}
```
- Use curl to POST to the agent's webhook_url from the agents table
- Only ping agents with valid webhooks (status != 'stale_webhook')

**For Agent → Tim blocks:**
- Send a Slack message to the "24 7 ai" channel
- Use the Slack connection (conn_4syh5zxa3g8xm552sp6r) with tool `slack_post_message`
- Channel ID will be provided in the payload or must be looked up
- Message format:
```
🚨 *Tim is blocking progress*

[List of blocked items]:
• *[Agent Name]*: [What they need from Tim] (waiting since [time])

_Please unblock when you can — your agents are eager to continue!_
```

**For Agent → Hub blocks:**
- Process the stuck request directly if possible
- Or log it for manual review

### Step 5: Report Summary

After processing, log a brief summary to the messages table:

```sql
INSERT INTO messages (from_agent, message_type, subject, data, received_at)
VALUES ('Multi Agent Mgr', 'update', 'Hourly Unblock Loop Summary',
  '[JSON with: total_checked, blocks_found, pings_sent, tim_blocks, resolved]',
  datetime('now'));
```

### Credit Optimization Rules
- If NO blocks found, just log a single row and exit immediately (no broadcasts, no Slack)
- Only ping each blocked agent ONCE per hour (check if already pinged recently)
- Batch all Tim-blocks into ONE Slack message (never multiple)
- Skip agents with stale_webhook status
- Keep total processing minimal — this runs every hour

### Important Context
- Hub webhook: https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1
- Slack connection: conn_4syh5zxa3g8xm552sp6r
- Slack channel ID for "24-7-ai": C0AJJ6VTYJK (private channel)
- All agent webhooks are in the `agents` SQL table
- Use `run_command` with curl to ping agent webhooks
