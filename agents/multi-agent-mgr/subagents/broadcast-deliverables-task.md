# Broadcast: Deliverables App Task

Send a `task_request` to every registered active agent asking them to build their own deliverables dashboard app — modeled on the Qualico CFO Dashboard's Deliverables tab.

## Instructions

1. Query SQL for all active agents:
```sql
SELECT agent_name, agent_tag, department, webhook_url 
FROM agents 
WHERE status != 'stale_webhook' 
  AND agent_name != 'Multi Agent Mgr'
ORDER BY agent_name
```

2. For each agent, POST to their `webhook_url` with this JSON payload:

```json
{
  "from_agent": "Multi Agent Mgr",
  "department": "Operations",
  "message_type": "task_request",
  "subject": "Build your Deliverables App — like the CFO did",
  "priority": "normal",
  "data": {
    "task": "build_deliverables_app",
    "instructions": "Build an instant app showing all YOUR deliverables — documents, reports, Notion pages, Supabase tables, scheduled outputs. Model it on the Qualico CFO Dashboard Deliverables tab format: Type icon | Document name + description | Location | Status badge (Up to date/Stale/Draft) | Last updated | Open link. STEPS: 1) Read the template at /agent/home/templates/agent-deliverables-template.tsx 2) Copy it to /agent/home/apps/[your-agent-name]-deliverables/ 3) Replace MY_AGENT_NAME, MY_AGENT_TAG, MY_DEPARTMENT with your values 4) Fill in AGENT_OWNED_DELIVERABLES with every document/report/resource YOU own — be specific with descriptions 5) Also query SELECT * FROM agent_output_files WHERE department = '[your-department]' to pull files from the shared drive inventory 6) Create the app with create_instant_app tool 7) Show it with show_user_preview 8) Pin it to sidebar with toggle_pin_app. IMPORTANT: The value is in the AGENT_OWNED_DELIVERABLES list — add everything you know about: every report you've written, every Notion page you maintain, every Google Drive file in your department, every Supabase table you own, every Asana project you track. Make it a real inventory of YOUR work.",
    "template_path": "/agent/home/templates/agent-deliverables-template.tsx",
    "reference": "CFO app has: Type, Document name + description, Google Drive location, Status (Up to date/Stale/Draft/Archived), Last updated date, Open link button. Filter tabs by file type. Match this exact format.",
    "department_sql": "SELECT file_name, file_type, drive_link, last_modified FROM agent_output_files WHERE department = '[YOUR_DEPARTMENT]'"
  }
}
```

3. Send to EVERY agent in the list. Use fetch/HTTP POST with Content-Type: application/json.

4. Track results: count successes (HTTP 200) and failures.

5. Report back with:
   - Total agents messaged
   - Success count
   - Any failed webhooks (HTTP != 200)
   - List of agent names that received the task

## Tools available
- run_agent_memory_sql — to get agent list
- web_scrape_website or run_command — to POST to each webhook URL

Use run_command with curl for the HTTP POSTs. Example:
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "[webhook_url]" \
  -H "Content-Type: application/json" \
  -d '[json_payload]'
```

Do NOT skip any agents. Send to all of them.
