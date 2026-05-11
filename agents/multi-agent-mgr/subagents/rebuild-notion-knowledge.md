# Rebuild Notion Shared Knowledge Store

Rebuild the entire Notion Agent Shared Knowledge Store page from SQL — guaranteed perfect mirror.

## Instructions

### Step 1 — Query all shared knowledge from SQL

```sql
SELECT sk.agent_name, a.department, sk.topic, sk.key, sk.value, sk.as_of_date, sk.updated_at
FROM shared_knowledge sk
LEFT JOIN agents a ON sk.agent_name = a.agent_name
ORDER BY a.department, sk.agent_name, sk.topic, sk.key
```

### Step 2 — Map departments

Use these canonical department mappings. If an agent's department from SQL doesn't match exactly, use the best match:

- Finance & Accounting → 💰 Finance & Accounting
- Finance & Operations → 💰 Finance & Accounting  
- M&A / Finance → 💰 Finance & Accounting
- Legal & Compliance → ⚖️ Legal & Compliance
- Legal / Insurance → ⚖️ Legal & Compliance
- Personal / Legal & Insurance → ⚖️ Legal & Compliance
- Operations → ⚙️ Operations
- Personal / Operations → 👤 Personal
- Marketing & Sales → 📣 Marketing & Sales
- Brand / Product → 📣 Marketing & Sales
- Marketing & Content → 📣 Marketing & Sales
- eCommerce & Product → 🛒 eCommerce & Product
- IT & Infrastructure → 🔧 IT & Infrastructure
- Personal → 👤 Personal
- Personal Admin → 👤 Personal
- HR & People → 👥 HR & People
- NULL or unknown → 🔧 IT & Infrastructure

### Step 3 — Build the full page content

Build a markdown string with ALL entries grouped by canonical department. Use this exact structure:

```
This page is the **portable mirror** of the hub's shared knowledge database. Every time an agent publishes a `knowledge` message to the hub, it is written here as well as to the SQL cache.

**Purpose:** If the stack ever migrates away from Tasklet, this Notion page preserves all agent-published knowledge.

---

## How It Works
1. Agent runs and produces key outputs
2. Agent POSTs `message_type: knowledge` to hub webhook
3. Hub writes to SQL `shared_knowledge` table (fast, local cache)
4. Hub also rebuilds this Notion page (permanent, portable mirror)

---

## Knowledge by Department

### 💰 Finance & Accounting
*Updated automatically by CFO Agent, Investor Agent, COGS Agent, Loans Agent, Overhead Manager*

[TABLE WITH ALL FINANCE ENTRIES]

### ⚙️ Operations
*Updated automatically by Logistics, Inventory, Operations agents*

[TABLE WITH ALL OPERATIONS ENTRIES OR EMPTY ROW]

### 📣 Marketing & Sales
*Updated automatically by Brand and Outreach agents*

[TABLE WITH ALL MARKETING ENTRIES OR EMPTY ROW]

### 🛒 eCommerce & Product
*Updated automatically by Price Monitor, Customer Service agents*

[TABLE WITH ALL ECOMMERCE ENTRIES OR EMPTY ROW]

### ⚖️ Legal & Compliance
*Updated automatically by IP, Insurance, Legal agents*

[TABLE WITH ALL LEGAL ENTRIES OR EMPTY ROW]

### 👤 Personal
*Updated automatically by Personal Assistant, Health, Finance agents*

[TABLE WITH ALL PERSONAL ENTRIES OR EMPTY ROW]

### 👥 HR & People
*Updated automatically by HR agents*

[TABLE WITH ALL HR ENTRIES OR EMPTY ROW]

### 🔧 IT & Infrastructure
*Updated automatically by IT and hub agents*

[TABLE WITH ALL IT ENTRIES OR EMPTY ROW]

---

## Notes
- This page is auto-rebuilt by the hub router on every knowledge update
- SQL `shared_knowledge` table is the source of truth; this page is the portable mirror
- For live querying, use Multi Agent Mgr

---

*Maintained by: Multi Agent Mgr (Hub) — Last rebuilt: [CURRENT DATETIME]*
```

For each department table, use this format (Notion markdown table):

```
| Agent | Topic | Key | Value | As Of | Updated |
|---|---|---|---|---|---|
| [agent_name] | [topic] | [key] | [value] | [as_of_date] | [updated_at] |
```

If a department has no entries, show:
```
| — | — | — | — | — | — |
```

### Step 4 — Replace the Notion page content

Use conn_1ykn33de2j69hkpfvg5r__notion-update-page with:
- page_id: `319b08937ab7811f9357f779d4b71127`
- command: `replace_content`
- new_str: [the full rebuilt content]

### Step 5 — Report result

In your final response, report:
- Total entries written to Notion
- Entries per department
- Any errors
