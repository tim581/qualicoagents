# Distribute Task 3 — Knowledge Push Protocol

Distribute the knowledge-push protocol (Task 3) to all registered agents via their webhook URLs.

## Instructions

### Step 1 — Query agent webhooks
Use run_agent_memory_sql to get all agents with webhook URLs:
```sql
SELECT agent_name, department, webhook_url FROM agents WHERE webhook_url IS NOT NULL AND webhook_url != '' ORDER BY department, agent_name
```

Also get agents WITHOUT webhook URLs:
```sql
SELECT agent_name, department FROM agents WHERE webhook_url IS NULL OR webhook_url = '' ORDER BY department, agent_name
```

### Step 2 — POST Task 3 to each agent with a webhook

For each agent that has a webhook_url, make an HTTP POST request using run_command with curl. Use this exact payload (replace AGENT_NAME and DEPARTMENT with the actual values):

```bash
curl -s -X POST "[webhook_url]" \
  -H "Content-Type: application/json" \
  -d '{
    "from_agent": "Multi Agent Mgr",
    "department": "IT & Infrastructure",
    "message_type": "task",
    "subject": "Task 3: Knowledge Push Protocol — Required Action",
    "priority": "high",
    "data": {
      "task_number": 3,
      "title": "Publish Key Learnings to Hub After Every Run",
      "instructions": "After completing your main task each run, publish your key findings to the hub. This makes your knowledge available to all other agents and ensures the system stays in sync. POST one message per key data point to: https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1",
      "message_format": {
        "from_agent": "[Your Agent Name]",
        "department": "[Your Department]",
        "message_type": "knowledge",
        "subject": "Knowledge update: [topic]",
        "data": {
          "topic": "[category e.g. cap_table, cash_position, inventory, brand_health, legal_status]",
          "key": "[specific data point name]",
          "value": "[the value or finding]",
          "as_of_date": "[YYYY-MM-DD]"
        }
      },
      "what_to_publish": "Any numbers, statuses, decisions, anomalies, risks, deadlines, or findings that another agent might find useful. When in doubt, publish it.",
      "when_to_publish": "At the end of every run, after your main task is complete.",
      "reference": "Full onboarding briefing: https://www.notion.so/319b08937ab781e5a4cad5d8c8180c1c",
      "action_required": "Add the Knowledge Publishing block to your instructions. Update your Notion briefing afterwards to reflect this change (version bump + last_updated)."
    }
  }'
```

Run all curl commands sequentially. Capture the HTTP response for each.

### Step 3 — Log each delivery to the hub messages table

After posting to each agent, log it to the database:
```sql
INSERT INTO messages (from_agent, message_type, subject, data, timestamp)
VALUES ('Multi Agent Mgr', 'task', 'Task 3 distributed to [AGENT_NAME]', '{"task": 3, "delivered": true}', datetime('now'))
```

### Step 4 — Report results

In your final response, provide:
1. ✅ List of agents successfully reached (got a 200 response or any response)
2. ⚠️ List of agents that returned errors (with the error)
3. ❌ List of agents with NO webhook URL (cannot be reached via hub)

Format clearly by department.
