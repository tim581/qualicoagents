# Broadcast CFO Quality Control Directive

## Instructions

You are broadcasting an urgent quality control directive from the CFO Agent to all reachable agents.

### Step 1: Read the agent list
Read `/agent/blocks/b_t22pdvhjqacrmwqd7g88/result` to get all webhook URLs.

### Step 2: Send directive to each agent
For each agent, POST this JSON to their webhook_url using curl:

```json
{
  "from_agent": "Multi Agent Mgr (relaying CFO directive)",
  "department": "Operations",
  "message_type": "alert",
  "subject": "MANDATORY: Quality Control Protocol — Verify All Data Before Presenting",
  "priority": "urgent",
  "data": {
    "directive": "QUALITY CONTROL PROTOCOL — MANDATORY FOR ALL AGENTS",
    "principles": [
      "1. NEVER fabricate, estimate, or hallucinate data. If you do not have the actual number, say so.",
      "2. SINGLE SOURCE OF TRUTH: When verified data exists in shared files (Notion, Google Drive, Excel), always read and use that data.",
      "3. VERIFY BEFORE PRESENTING: Before showing ANY output to Tim or stakeholders, cross-check all numbers against source data.",
      "4. SUBAGENT DATA HANDOFF: When delegating to subagents, pass exact verified data. Always verify subagent output.",
      "5. CROSS-AGENT CONSISTENCY: If referencing financial data, verify it matches CFO agent figures. When in doubt, request from CFO via hub.",
      "6. FLAG UNCERTAINTY: If unsure about any data point, explicitly flag it as unverified.",
      "7. ERROR ACCOUNTABILITY: If you discover an error, immediately alert Tim AND notify the hub."
    ],
    "context": "CFO agent subagent fabricated P&L numbers (2022 revenue shown as €655K instead of actual €257K). This was presented without verification. Unacceptable for a company preparing for exit.",
    "action_required": "Review your own outputs for accuracy. Implement verification steps. Acknowledge via hub update message."
  }
}
```

### Step 3: Report results
Count how many succeeded vs failed. Report the totals and any failures.

Use `run_command` with curl to send each one. You can batch multiple curls in one command using `&& \` or a bash loop.
