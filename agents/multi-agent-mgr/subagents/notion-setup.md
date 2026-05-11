# Notion Setup Subagent

Creates the Agent Onboarding Briefing page and Agent Shared Knowledge page in Notion.

## Instructions

You have access to these Notion tools:
- conn_1ykn33de2j69hkpfvg5r__notion-create-pages
- conn_1ykn33de2j69hkpfvg5r__notion-fetch
- conn_1ykn33de2j69hkpfvg5r__notion-update-page

**TASK 1: Create Agent Onboarding Briefing page**

Create a standalone Notion page (no parent) with the following:

Properties:
- title: "🚀 Agent Onboarding Briefing — Multi Agent Network"

Content (use this exact markdown):

```
# 🚀 Agent Onboarding Briefing
*For all agents joining the Multi Agent Network. Last updated: 2026-03-04.*

Welcome to the Qualico AI stack. This briefing tells you everything you need to know to integrate with the multi-agent network, share knowledge, and communicate with other agents.

---

## 🏢 The Network

You are part of a 30+ agent network organised into 8 departments:
- 💰 Finance & Accounting
- ⚖️ Legal & Compliance
- ⚙️ Operations
- 📣 Marketing & Sales
- 🛒 eCommerce & Product
- 🔧 IT & Infrastructure
- 👤 Personal
- 👥 HR & People

All agents report to the **Multi Agent Manager (Hub)** — the central orchestrator. It logs activity, routes requests between agents, and maintains the shared knowledge store.

---

## 🔗 Hub Webhook

**All communication goes through this single URL:**

```
https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1
```

POST JSON to this URL for all inter-agent messages.

---

## ✅ TASK 1 — Create or Update Your Notion Briefing

Search the Notion database "Ai Agent Briefings" (ID: 29f7e3b0f9a34a3c837d941a97f936c3) for a page matching your agent name.

**If a briefing page already exists:** Add or update the following sections:

```
## Department & Org Structure
- Department: [Finance & Accounting / Operations / Marketing & Sales / Legal & Compliance / HR & People / eCommerce & Product / IT & Infrastructure / Personal]
- Reports To: Multi Agent Mgr (hub)
- Peer agents in same department: [list agents in same dept]

## Inter-Agent Communication
What I produce for others:
- [data output name]: [format] — [frequency]

What I need from others:
- [data input name]: [which agent should provide it] — [how often]

Requests I can handle (incoming via my webhook):
- [request_type]: [what I do and what I return]

Platform-specific notes (for migration):
- [anything Tasklet-specific that would need replacing on another platform]
```

Also update the database properties:
- Add "Department" value (use Category field)
- Set "Last Updated" to today

**If NO briefing page exists yet:** Create a new page in the "Ai Agent Briefings" database and fill in ALL sections. See existing briefings for the full template format. Be thorough — every field matters for future rebuilds.

**CRITICAL SELF-UPDATE RULE:** Whenever you modify yourself — subagent files, triggers, connections, logic, bug fixes — update this Notion briefing in the same session. This is mandatory.

---

## ✅ TASK 2 — Register With the Hub

Send this registration message to the hub webhook URL **once, right now**:

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

**When to contact the hub going forward:**
1. After completing significant output (report, summary, alert, action taken)
2. When you need data from another agent
3. When you detect something another agent or Tim should know
4. When you encounter a blocker another agent might resolve

**Standard message format:**
```json
{
  "from_agent": "[YOUR EXACT AGENT NAME]",
  "department": "[YOUR DEPARTMENT]",
  "message_type": "update | request | alert",
  "subject": "One-line summary",
  "data": {
    "summary": "...",
    "details": "...",
    "relevant_ids": {}
  },
  "reply_webhook": "[YOUR WEBHOOK — only if you need a response]",
  "priority": "low | normal | high | urgent"
}
```

**Message type guide:**
- **update** — you finished something: "COGS summary for Feb is ready"
- **request** — you need something from another agent (must include `to_agent` in data)
- **alert** — something is wrong or time-sensitive
- **knowledge** — publishing findings to the shared brain (see Task 3)

**Your webhook:** If you don't have one, go to Triggers → Add → Webhook → title it "Receive inter-agent messages". Paste the URL in your Notion briefing under Inter-Agent Communication.

---

## ✅ TASK 3 — Publish Your Knowledge After Every Run

After completing your main task, publish key findings to the hub's shared knowledge store. This makes your data available to all other agents and mirrors to Notion for portability.

**Send one call per key data point:**
```json
{
  "from_agent": "[YOUR EXACT AGENT NAME]",
  "department": "[YOUR DEPARTMENT]",
  "message_type": "knowledge",
  "subject": "Knowledge update: [topic]",
  "data": {
    "topic": "[category — e.g. cap_table, cash_position, inventory_levels, brand_health, logistics_status]",
    "key": "[specific data point — e.g. total_shares_outstanding]",
    "value": "[the value]",
    "as_of_date": "[YYYY-MM-DD]"
  }
}
```

**Examples of what to publish:**
- Finance agents: cash position, runway, COGS, cap table figures
- Inventory agent: stock levels, reorder alerts, SKU counts
- Logistics agent: shipment statuses, carrier delays
- Brand agents: campaign status, content publish dates
- Legal agents: contract expiry dates, compliance deadlines
- Personal agents: health metrics, goal progress

**Rule:** If another agent might find your output useful, publish it. When in doubt, publish.

---

## 🔍 Requesting Data From Another Agent

When you need data that another agent has, send a `request` message:
```json
{
  "from_agent": "[YOUR NAME]",
  "department": "[YOUR DEPT]",
  "message_type": "request",
  "subject": "Data request: [topic]",
  "reply_webhook": "[YOUR WEBHOOK]",
  "data": {
    "to_agent": "[EXACT NAME OF TARGET AGENT]",
    "topic": "[what it's about]",
    "question": "[your specific question]"
  }
}
```

The hub will forward your request to the target agent and deliver the answer back to your webhook.

---

## 🔍 Checking If Data Is In Sync

To verify that two or more agents agree on a data point:
```json
{
  "from_agent": "[YOUR NAME]",
  "message_type": "sync_check",
  "subject": "Sync check: [topic]",
  "reply_webhook": "[YOUR WEBHOOK]",
  "data": {
    "topic": "[topic to check]",
    "key": "[specific key — optional]"
  }
}
```

The hub returns either ✅ in sync or ⚠️ with exact discrepancies.

---

## 📚 Key Resources

| Resource | ID / URL |
|---|---|
| Hub Webhook | https://webhooks.tasklet.ai/v1/public/webhook?token=36f684e5b43028dffcfa528d686769a1 |
| Ai Agent Briefings DB | 29f7e3b0-f9a3-4a3c-837d-941a97f936c3 |
| Multi Agent Mgr Briefing | 318b0893-7ab7-811b-8265-f242102e956e |
| Agent Onboarding Briefing | This page |
| Platform | Tasklet (tasklet.ai) |
| Owner | Tim Huybrechts — tim@qualico.be |

---

## 🌐 Portability Note

This network is designed to survive platform migrations:
- All agent instructions are documented in Notion briefings
- Shared knowledge is mirrored to Notion (portable) and SQL (fast cache)
- Webhook URLs will change on migration — update hub registration
- Agent logic lives in Notion briefings — rebuild on any platform using those docs

---

*This page is maintained by Multi Agent Mgr. Version 1.0 — 2026-03-04.*
```

**TASK 2: Create Agent Shared Knowledge page**

Create a standalone Notion page with:

Properties:
- title: "🧠 Agent Shared Knowledge Store"

Content:
```
# 🧠 Agent Shared Knowledge Store

This page is the **portable mirror** of the hub's shared knowledge database. Every time an agent publishes a `knowledge` message to the hub, it is written here as well as to the SQL cache.

**Purpose:** If the stack ever migrates away from Tasklet, this Notion page preserves all agent-published knowledge.

---

## How It Works

1. Agent runs and produces key outputs
2. Agent POSTs `message_type: knowledge` to hub webhook
3. Hub writes to SQL `shared_knowledge` table (fast, local cache)
4. Hub also updates this Notion page (permanent, portable)

---

## Knowledge by Department

### 💰 Finance & Accounting
*Updated automatically by CFO Agent, Investor Agent, COGS Agent, Loans Agent*

| Agent | Topic | Key | Value | As Of |
|---|---|---|---|---|
| — | — | — | — | — |

### ⚙️ Operations
*Updated automatically by Logistics, Inventory, Operations agents*

| Agent | Topic | Key | Value | As Of |
|---|---|---|---|---|
| — | — | — | — | — |

### 📣 Marketing & Sales
*Updated automatically by Brand and Outreach agents*

| Agent | Topic | Key | Value | As Of |
|---|---|---|---|---|
| — | — | — | — | — |

### 🛒 eCommerce & Product
*Updated automatically by Price Monitor, Customer Service agents*

| Agent | Topic | Key | Value | As Of |
|---|---|---|---|---|
| — | — | — | — | — |

### ⚖️ Legal & Compliance
*Updated automatically by IP, Insurance, Legal agents*

| Agent | Topic | Key | Value | As Of |
|---|---|---|---|---|
| — | — | — | — | — |

### 👤 Personal
*Updated automatically by Personal Assistant, Health, Finance agents*

| Agent | Topic | Key | Value | As Of |
|---|---|---|---|---|
| — | — | — | — | — |

---

## Notes

- This page is auto-updated by the hub router when agents publish knowledge
- For live querying, use the SQL `shared_knowledge` table via Multi Agent Mgr
- Tables above will be populated as agents begin publishing knowledge messages
- Page ID should be stored in Multi Agent Mgr briefing for hub-router reference

---

*Maintained by: Multi Agent Mgr (Hub) — Version 1.0 — 2026-03-04*
```

After creating both pages, report back with:
1. The page ID of the "Agent Onboarding Briefing" page
2. The page ID of the "Agent Shared Knowledge Store" page
