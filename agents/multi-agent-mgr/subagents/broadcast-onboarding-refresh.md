# Broadcast Onboarding Refresh

Sends an onboarding briefing refresh to all agents that have webhooks, reminding them to re-read the updated briefing with DARE, Credit, Quality Gates, and File Organization protocols.

## Instructions

1. Query the SQL database for all agents with webhooks:
```sql
SELECT agent_name, webhook_url FROM agents WHERE webhook_url IS NOT NULL AND webhook_url != '' ORDER BY agent_name
```

2. For each agent with a webhook, POST this JSON to their webhook_url using the web_scrape_website tool (you don't have curl — use run_command with curl instead):

```json
{
  "from_agent": "Multi Agent Mgr (Hub)",
  "message_type": "onboarding",
  "subject": "UPDATED: Re-read onboarding briefing — new protocols added",
  "data": {
    "onboarding_briefing_url": "https://www.notion.so/319b08937ab781e5a4cad5d8c8180c1c",
    "onboarding_briefing_id": "319b08937ab781e5a4cad5d8c8180c1c",
    "instructions": "REQUIRED: The onboarding briefing has been updated with new mandatory protocols. Fetch Notion page 319b08937ab781e5a4cad5d8c8180c1c and read it fully. New sections added: DARE Protocol (task accountability), Credit Optimization (7 commandments), Quality Gates (knowledge filtering), File Organization (Google Drive department folders). Review and confirm you understand all protocols. This is a no-ack broadcast — do NOT reply unless you have questions.",
    "key_protocols": {
      "DARE": "Every task must end in DONE or ESCALATED. Use alert (not update) for failures. Never silently abandon tasks.",
      "Credit": "Batch knowledge, no ack on broadcasts, right-size intelligence, skip unchanged data.",
      "Quality Gates": "Hub rejects garbage values, duplicates, and unknown topics.",
      "File Organization": "Save all files to department-specific Google Drive folders."
    }
  },
  "priority": "normal"
}
```

3. Use run_command with curl to POST to each webhook. Batch 5 curl commands into a single shell script for efficiency:
```bash
#!/bin/bash
PAYLOAD='<the json above>'
curl -s -o /dev/null -w "%{http_code}" -X POST "<webhook_url>" -H "Content-Type: application/json" -d "$PAYLOAD"
```

4. Track successes and failures. Report a summary at the end:
- Total agents attempted
- Successful deliveries (HTTP 200-299)
- Failed deliveries (with agent name and error)
- Agents without webhooks (list names)

IMPORTANT: This is a no-ack broadcast. Do NOT expect or wait for replies.
