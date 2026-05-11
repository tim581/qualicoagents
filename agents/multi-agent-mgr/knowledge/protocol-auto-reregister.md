# Auto Re-Registration Protocol

## Why This Exists

When an agent's webhook trigger is deleted and recreated in Tasklet, the webhook token changes. 
The hub still has the OLD token → messages return 404 → agent is unreachable.

## Rule: Re-Register on Every First Trigger Fire

**Every agent MUST include this in their webhook trigger handler:**

Before doing ANY other work, send a registration message to the hub:

```json
POST https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1

{
  "from_agent": "[Your Agent Name]",
  "department": "[Your Department]", 
  "message_type": "register",
  "subject": "Auto re-registration — webhook keepalive",
  "data": {
    "capabilities": "[your capabilities]",
    "webhook_url": "[YOUR CURRENT WEBHOOK URL]"
  },
  "reply_webhook": "[YOUR CURRENT WEBHOOK URL]",
  "priority": "low"
}
```

This ensures the hub always has your latest webhook URL.

## Cost: Minimal
- One extra HTTP call per trigger fire
- Hub fast-path handles registrations in ~500 tokens
- Prevents expensive debugging + manual re-registration cycles

## How Hub Handles It
- Hub upserts: if webhook unchanged, it's a no-op
- If webhook changed, hub updates SQL + queues Supabase sync + updates Notion
- Agent gets onboarding briefing back (can ignore if already onboarded)
