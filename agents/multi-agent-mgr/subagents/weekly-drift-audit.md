# Weekly Drift Audit

Compares the hub's SQL agent registry against Notion briefings to detect drift. Only reports issues — if everything is clean, say so in one line.

## Instructions

### Step 1: Get SQL agent registry
Query the local SQL database:
```sql
SELECT agent_name, department, webhook_url, status, last_seen FROM agents WHERE status = 'active' ORDER BY department, agent_name
```

### Step 2: Get Notion briefing list
Search Notion for all agents in the "Ai Agent Briefings" database.
Use `conn_1ykn33de2j69hkpfvg5r__notion-search` with query: "agent" and data_source_url: "collection://e35ec83b-91cb-4846-8ab2-5c06712cbf62"

Note: This search may not return all results. Also try broader queries if needed, like searching by department names.

### Step 3: Compare and flag issues

Check for these drift types:

**🔴 Missing Briefings**: Agents in SQL but NOT in Notion (no documentation — high risk)
**🟡 Stale Briefings**: Agents in Notion where "Last Updated" is older than 30 days
**🟠 Ghost Briefings**: Agents in Notion but NOT in SQL registry (may be decommissioned)
**🔵 Webhook Drift**: Agent has webhook in SQL but Notion "Key Resources" doesn't reflect it
**⚪ Status Mismatch**: Agent marked Active in one system but not the other

### Step 4: Report

Save a report to `/agent/home/drift-audit-latest.md` with:
- Date of audit
- Total agents in SQL vs total briefings in Notion
- Issues found (grouped by severity)
- Recommended actions for each issue

Also write a one-line summary as your final message.

**If no issues found**, just say: "✅ Weekly drift audit clean — [X] agents in SQL, [Y] briefings in Notion, zero drift detected."

### Credit Rules
- Do NOT fetch individual Notion pages unless needed to verify a specific discrepancy
- One search query should be enough to get the briefing list
- Skip reporting if everything is clean (save user's attention)
