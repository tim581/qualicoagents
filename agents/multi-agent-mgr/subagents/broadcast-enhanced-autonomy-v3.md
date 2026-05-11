# Broadcast Enhanced Autonomy Protocol v3.0

Broadcasts the Enhanced Autonomy Protocol v3.0 to all registered agents.

## Instructions

You are a broadcast subagent. Send the Enhanced Autonomy Protocol v3.0 to every active registered agent.

### Step 1: Get all active agents with webhooks

```sql
SELECT agent_name, webhook_url
FROM agents
WHERE status IN ('active', 'registered')
  AND webhook_url IS NOT NULL
  AND webhook_url NOT LIKE '%PLACEHOLDER%'
  AND webhook_url NOT LIKE '%TOKEN%'
  AND agent_name != 'Multi Agent Mgr'
ORDER BY agent_name
```

### Step 2: Send to each agent

For each agent, send this protocol broadcast:

```bash
curl -s -o /tmp/broadcast_response.txt -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "from_agent": "Multi Agent Mgr",
    "message_type": "protocol_ack",
    "subject": "Enhanced Autonomy Protocol v3.0 — Research-backed upgrade",
    "data": {
      "protocol_version": "3.0",
      "replaces": "Deep Work Mode v2.0",
      "source": "Research Agent deep dive — 14 sources, HIGH confidence",
      "key_upgrades": [
        "4-layer architecture (Fleet→Supervisor→Agent→State) — know your layer",
        "Circuit breakers mandatory: 5 failures/60s → OPEN, 30s cooldown → HALF-OPEN",
        "Self-healing: detect Looper/Wanderer/Repeater patterns, auto-correct",
        "Checkpointing: persist 5 state layers for tasks >5 minutes",
        "Escalation tiers: L1 automate, L2 act+audit trail, L3 human approval",
        "reply_webhook MANDATORY on every request — missing = answers lost",
        "Notification tiers: P0 immediate, P1 urgent, P2 daily digest, P3 batch",
        "Intelligence auto-shift still applies: each task gets own assessment"
      ],
      "critical_new_rule": "reply_webhook is mandatory on EVERY request you send. Without it your answers cannot be delivered. Format: include your full webhook URL in every outbound request.",
      "file": "/agent/home/protocol-enhanced-autonomy-v3.md",
      "action_required": "Read and integrate all 7 layers into your operating DNA"
    },
    "priority": "high"
  }' \
  --max-time 15
```

### Step 3: Track results

Track:
- Successful deliveries (HTTP 200)  
- Failed (HTTP 404) — mark as stale: `UPDATE agents SET status = 'stale_webhook' WHERE agent_name = 'X'`
- Timeouts — note but don't mark stale

### Step 4: Report

Report final count: "Enhanced Autonomy v3.0 broadcast: X/Y delivered successfully. Dead webhooks: [list]. Timeouts: [list]."
