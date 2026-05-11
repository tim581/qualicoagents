# Agent Onboarding Tasks
*Paste both tasks below into every agent's instructions.*

---

## TASK 1 — Create or Update Your Notion Briefing

Search the Notion database "Ai Agent Briefings" (ID: 29f7e3b0f9a34a3c837d941a97f936c3) for a page matching your agent name.

**If a briefing page already exists:**
Add or update the following sections on your page:

```
## 14. Department & Org Structure
- Department: [Finance & Accounting / Operations / Marketing & Sales / Legal & Compliance / HR & People / eCommerce & Product / IT & Infrastructure / Personal]
- Reports To: Multi Agent Mgr (hub)
- Peer agents in same department: [list agents in same dept]

## 15. Inter-Agent Communication
**What I produce for others:**
- [data output name]: [format, e.g. JSON / Notion row / Slack message] — [frequency]

**What I need from others:**
- [data input name]: [which agent should provide it] — [how often]

**Requests I can handle (incoming via my webhook):**
- [request_type]: [what I do and what I return]

**Platform-specific notes (for migration):**
- [anything Tasklet-specific that would need replacing on another platform]
```

Also update the database properties:
- Add "Department" value (use Category field, pick closest match)
- Set "Last Updated" to today

**If NO briefing page exists yet:**
Create a new page in the "Ai Agent Briefings" database (ID: 29f7e3b0f9a34a3c837d941a97f936c3) and fill in ALL sections below. Model it exactly on the existing briefings — be thorough and precise. Every field matters for future rebuilds.

```
## 1. Identity & Purpose
- Agent name, owner, organisation, intelligence level, timezone
- Primary responsibilities (bullet list)

## 2. Connections & Tools
Table with: Connection ID | Service | Account | Purpose | Key Tools Activated
Include any critical notes about tool limitations.

## 3. Trigger Schedule
Table with: Trigger name | Time | Timezone | Subagent file | Action
If no triggers: state "Manual only"

## 4–N. Core Logic (one section per major workflow)
For each thing this agent does:
- Data sources used
- Exact API calls (with full URLs, parameters, field IDs)
- Decision logic / rules
- Output format (exact message or data structure)

## [N+1]. Key Resources
Table of all critical IDs: Notion page IDs, Slack channel IDs, workspace IDs, folder paths, GIDs, etc.

## [N+2]. Personal / Business Context
Any owner context baked into this agent (names, addresses, preferences, language, etc.)

## [N+3]. Knowledge Gaps
What is NOT yet documented — held only in agent memory or subagent files. Be honest.

## [N+4]. Department & Org Structure
- Department: [Finance & Accounting / Operations / Marketing & Sales / Legal & Compliance / HR & People / eCommerce & Product / IT & Infrastructure / Personal]
- Reports To: Multi Agent Mgr (hub)
- Peer agents in same department: [list]

## [N+5]. Inter-Agent Communication
**What I produce for others:**
- [data output]: [format] — [frequency]

**What I need from others:**
- [data input]: [source agent] — [frequency]

**Requests I can handle:**
- [request_type]: [description and return value]

**Platform-specific notes:**
- [Tasklet-specific elements that need replacing on migration]

## [N+6]. Self-Update Protocol
CRITICAL RULE: Whenever you modify yourself — subagent files, triggers, connections, logic, bug fixes — update this Notion briefing in the same session.

## [N+7]. How to Recreate From Scratch
Step-by-step: create agent → connect services → activate tools → upload subagents → set triggers → test.
Include all connection IDs, API keys, workspace IDs, and file paths needed.
```

Set these database properties on the new page:
- Agent Name: [your agent name]
- Category: [closest match]
- Status: Active
- Trigger: [Scheduled / Webhook / Manual / Event-based]
- Frequency: [describe your schedule]
- Connections: [list connection IDs and service names]
- Key Resources: [most critical IDs]
- Last Updated: today's date
- Version: 1.0

---

## TASK 2 — Register With the Multi Agent Manager Hub

You are part of a multi-agent network. The Multi Agent Manager is the central hub that routes knowledge and requests between all agents.

**Hub Webhook URL:** https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1

### FIRST TIME ONLY — Register yourself with the hub:
Send this message to the hub webhook URL right now (once, as a one-time setup step):
```json
{
  "from_agent": "[YOUR EXACT AGENT NAME]",
  "department": "[YOUR DEPARTMENT]",
  "message_type": "register",
  "subject": "Agent registering with hub",
  "data": {
    "capabilities": ["list your main capabilities here"]
  },
  "reply_webhook": "[YOUR OWN WEBHOOK URL — if you have one]"
}
```

### When to contact the hub:
1. When you complete a significant output (report, summary, alert, action taken)
2. When you need data or action from another agent
3. When you detect something another agent or Tim should know about
4. When you encounter a blocker another agent might resolve

### Standard message format — POST to hub webhook URL:
```json
{
  "from_agent": "[YOUR EXACT AGENT NAME]",
  "department": "[YOUR DEPARTMENT]",
  "message_type": "update | request | alert",
  "subject": "One-line summary of what this is",
  "data": {
    "summary": "...",
    "details": "...",
    "relevant_ids": {}
  },
  "reply_to_webhook": "[YOUR OWN WEBHOOK URL — only if you need a response]",
  "priority": "low | normal | high | urgent"
}
```

### Message type guide:
- **update** — you finished something useful: "COGS summary for Feb is ready"
- **request** — you need something from another agent: "need current inventory levels from Inventory Value Mgr"
- **alert** — something is wrong or time-sensitive: "invoice overdue 30+ days detected"

### Your webhook (so others can reach you):
Set up a Webhook trigger on yourself if you don't have one. This is your address in the network.
Go to Triggers → Add → Webhook → title it "Receive inter-agent messages".
Once created, paste your webhook URL into your Notion briefing under Section [Inter-Agent Communication].

### After sending to hub:
Do not wait for a synchronous response. The hub will process your message and reply to your webhook URL if needed. Continue your own work.

---

## TASK 3 — Publish Your Knowledge After Every Run

After completing your main task each run, publish your key findings to the hub's shared knowledge store. This makes your data available to all other agents and is mirrored to Notion for full portability.

**Send one message per key data point** to the hub webhook URL:
```json
{
  "from_agent": "[YOUR EXACT AGENT NAME]",
  "department": "[YOUR DEPARTMENT]",
  "message_type": "knowledge",
  "subject": "Knowledge update: [topic]",
  "data": {
    "topic": "[category — e.g. cap_table, cash_position, inventory_levels, brand_health, logistics_status, compliance_deadlines]",
    "key": "[specific data point — e.g. total_shares_outstanding, runway_months, sku_count]",
    "value": "[the value as a string]",
    "as_of_date": "[YYYY-MM-DD]"
  }
}
```

### What to publish:
- **Finance agents**: cash position, runway, COGS figures, cap table data, loan balances
- **Inventory agent**: stock levels, reorder alerts, SKU counts, warehouse status
- **Logistics agent**: shipment statuses, carrier delays, delivery ETAs
- **Brand agents**: campaign status, content publish dates, ad spend
- **Legal agents**: contract expiry dates, compliance deadlines, IP filings
- **Personal agents**: health metrics, goal progress, key decisions

### Rule:
If another agent might find your output useful — publish it. When in doubt, publish.

### Why this matters:
- Other agents can read your latest data without asking you directly
- The hub checks for discrepancies between agents on the same topic
- All knowledge is mirrored to Notion (portable if the stack moves platforms)
- You avoid duplicating work that another agent has already done

### Before computing something another agent might already have:
1. First check if the data is in `shared_knowledge` by sending a `sync_check` request to the hub
2. Or send a `request` message to the specific agent to get their latest figures
```
