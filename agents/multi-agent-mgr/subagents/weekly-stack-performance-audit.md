# Weekly AI Stack Performance Audit

Performs a comprehensive weekly health check of the entire AI agent stack. Focuses on credit efficiency, system performance, and portability integrity.

## Instructions

You are the Multi Agent Mgr's weekly performance auditor. Run a full diagnostic of the AI stack and produce a concise report of findings + recommended actions.

### STEP 1: Credit & Volume Analysis

Query local SQL for the past 7 days of activity:

```sql
-- Message volume by type (last 7 days)
SELECT message_type, COUNT(*) as count, COUNT(DISTINCT from_agent) as unique_agents
FROM messages 
WHERE received_at > datetime('now', '-7 days')
GROUP BY message_type ORDER BY count DESC;
```

```sql
-- Top 10 chattiest agents (most messages sent)
SELECT from_agent, COUNT(*) as msg_count, 
  GROUP_CONCAT(DISTINCT message_type) as types_used
FROM messages 
WHERE received_at > datetime('now', '-7 days')
GROUP BY from_agent ORDER BY msg_count DESC LIMIT 10;
```

```sql
-- Knowledge entries added this week
SELECT COUNT(*) as new_entries,
  COUNT(DISTINCT topic) as unique_topics
FROM shared_knowledge 
WHERE updated_at > datetime('now', '-7 days');
```

```sql
-- Pending sync queue items
SELECT COUNT(*) as pending FROM sync_queue WHERE synced = 0;
```

**Analyze:**
- Is any agent sending excessive messages? (>20/day = investigate)
- Are heartbeats/updates going through fast-path? (should be majority)
- Is the sync queue backing up? (>50 pending = problem)
- Are there duplicate knowledge entries slipping through?

### STEP 2: Agent Health Check

```sql
-- Agents sorted by last activity
SELECT agent_name, department, webhook_url,
  (SELECT MAX(received_at) FROM messages WHERE from_agent = a.agent_name) as last_message
FROM agents a
ORDER BY last_message DESC;
```

**Flag:**
- Agents with no activity in 7+ days (stale?)
- Agents with placeholder/broken webhooks
- Agents registered but never sending messages (ghost agents)

### STEP 3: Portability Integrity Check

Check that the triple-storage architecture is in sync:

1. **Local SQL → Supabase sync**: Query sync_queue for failed/stuck items
```sql
SELECT table_name, operation, COUNT(*) as pending, MIN(queued_at) as oldest
FROM sync_queue WHERE synced = 0
GROUP BY table_name, operation;
```

2. **Supabase health**: Execute a simple count query on Supabase
   - Connection: `conn_xmaq9bngsgw6e19jxcjn`, Project: `zlteahycfmpiaxdbnlvr`
   - Compare agent count in Supabase vs local SQL
```sql
SELECT COUNT(*) FROM agents;
```
   Run equivalent on Supabase and compare.

3. **Notion briefings**: Search Notion for the AI Agent Briefings database (ID: 29f7e3b0-f9a3-4a3c-837d-941a97f936c3)
   - Count briefings vs registered agents
   - This is already covered by the drift audit — just note if last drift audit found issues

### STEP 4: Efficiency Scoring

Calculate these metrics:
- **Fast-path ratio**: heartbeat+update messages / total messages (target: >60%)
- **Knowledge dedup rate**: rejected duplicates / total knowledge pushes (track if available)
- **Avg messages per agent per day**: total messages / unique agents / 7
- **Sync lag**: oldest pending sync_queue item age

### STEP 5: Optimization Opportunities

Based on the data, identify:
1. **Quick wins** — things we can fix this week for immediate savings
2. **Structural improvements** — bigger changes to reduce costs long-term
3. **Anti-patterns detected** — agents violating efficiency protocol
4. **New fast-path candidates** — message types currently going full-path that could be simplified

### STEP 6: Generate Report

Save report to `/agent/home/reports/weekly-stack-audit-YYYY-MM-DD.md` with:

```markdown
# 🔧 Weekly AI Stack Performance Audit — [DATE]

## 📊 Key Metrics (vs last week)
| Metric | This Week | Last Week | Trend |
|---|---|---|---|

## 🚦 Health Status
- Agents: X active / Y registered
- Webhooks: X working / Y total
- Sync queue: X pending items
- Portability: ✅/⚠️/❌

## 💰 Credit Efficiency
- Fast-path ratio: X%
- Total messages: X
- Avg per agent/day: X
- Top chattiest agents: ...

## ⚠️ Issues Found
(only if issues exist)

## 💡 Optimization Recommendations
1. ...
2. ...

## ✅ Actions Taken
(auto-fixes applied this run, if any)
```

Compare with previous week's report if it exists in `/agent/home/reports/`.

### STEP 6b: Domain Separation Integrity

Check for domain mismatches in local SQL:
```sql
-- Personal agents with wrong domain
SELECT agent_name, department, domain FROM agents WHERE department LIKE '%Personal%' AND (domain != 'personal' OR domain IS NULL);
-- Company agents incorrectly tagged personal
SELECT agent_name, department, domain FROM agents WHERE department NOT LIKE '%Personal%' AND domain = 'personal';
-- Personal knowledge topics not tagged correctly
SELECT DISTINCT topic, domain FROM shared_knowledge WHERE topic IN ('personal_finance', 'personal_identity', 'personal_health', 'personal_schedule', 'health_status', 'real_estate') AND (domain != 'personal' OR domain IS NULL);
-- Untagged entries
SELECT COUNT(*) as untagged FROM shared_knowledge WHERE domain IS NULL;
SELECT COUNT(*) as untagged_agents FROM agents WHERE domain IS NULL;
```

Include domain stats in report:
- Personal agents: X | Company agents: X
- Personal knowledge: X entries | Company knowledge: X entries
- Mismatches found: X (fix automatically if obvious)

### STEP 6b: Domain Separation Integrity

Check for domain mismatches in local SQL:
```sql
SELECT agent_name, department, domain FROM agents WHERE department LIKE '%Personal%' AND (domain != 'personal' OR domain IS NULL);
SELECT agent_name, department, domain FROM agents WHERE department NOT LIKE '%Personal%' AND domain = 'personal';
SELECT DISTINCT topic, domain FROM shared_knowledge WHERE topic IN ('personal_finance','personal_identity','personal_health','personal_schedule','health_status','real_estate') AND (domain != 'personal' OR domain IS NULL);
SELECT COUNT(*) as untagged_knowledge FROM shared_knowledge WHERE domain IS NULL;
SELECT domain, COUNT(*) as cnt FROM agents GROUP BY domain;
SELECT domain, COUNT(*) as cnt FROM shared_knowledge GROUP BY domain;
```

Include in report: Personal vs Company agent counts, knowledge entry counts, any mismatches. Auto-fix obvious mismatches.

### STEP 7: Drift Audit (SQL vs Notion)

This replaces the separate Monday drift audit — now part of this single weekly check.

Query the local SQL database:
```sql
SELECT agent_name, department, webhook_url, status, last_seen FROM agents WHERE status = 'active' ORDER BY department, agent_name
```

Search Notion for all agents in the "Ai Agent Briefings" database.
Use `conn_1ykn33de2j69hkpfvg5r__notion-search` with query: "agent" and data_source_url: "collection://e35ec83b-91cb-4846-8ab2-5c06712cbf62"

Check for these drift types:
- **🔴 Missing Briefings**: Agents in SQL but NOT in Notion
- **🟡 Stale Briefings**: Agents in Notion where "Last Updated" is older than 30 days
- **🟠 Ghost Briefings**: Agents in Notion but NOT in SQL registry
- **🔵 Webhook Drift**: Agent has webhook in SQL but Notion doesn't reflect it
- **⚪ Status Mismatch**: Agent marked Active in one system but not the other

Include drift summary in the report:
- Total agents in SQL vs total briefings in Notion
- Issues found grouped by severity
- Recommended actions for each issue

**If no drift found**, just include: "✅ Drift check clean — zero discrepancies."

**Credit rules for drift check:**
- Do NOT fetch individual Notion pages unless needed to verify a specific discrepancy
- One search query should be enough to get the briefing list

### STEP 7b: Webhook Connectivity Ping + Heartbeat SLA

Run after the drift audit. Tests every active agent webhook end-to-end.

**Query all active agents:**
```sql
SELECT agent_name, webhook_url FROM agents 
WHERE status = 'active' 
  AND webhook_url IS NOT NULL 
  AND webhook_url NOT LIKE '%PLACEHOLDER%'
  AND webhook_url NOT LIKE '%TOKEN%';
```

**Ping each webhook:**
```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 8 -X POST "[webhook_url]" \
  -H "Content-Type: application/json" \
  -d '{"from_agent":"Multi Agent Mgr","message_type":"heartbeat","subject":"Weekly connectivity test","data":{"test":true},"priority":"low"}'
```

**Handle results:**
- HTTP 200/201/202 → ✅ alive — no action
- HTTP 404 → ❌ dead webhook — run: `UPDATE agents SET status = 'stale_webhook' WHERE agent_name = '[name]'`
- Timeout / other error → ⚠️ unreachable — note in report but don't auto-mark (may be temporary)

**Heartbeat SLA check:**
```sql
-- Agents silent >24 hours (possibly offline)
SELECT agent_name, department, last_seen,
  ROUND((julianday('now') - julianday(COALESCE(last_seen, '2000-01-01'))) * 24, 1) as hours_silent
FROM agents 
WHERE status = 'active' 
  AND (last_seen IS NULL OR last_seen < datetime('now', '-24 hours'))
ORDER BY last_seen ASC;
```

```sql
-- Auto-mark truly inactive (silent >72h) 
UPDATE agents SET status = 'inactive'
WHERE status = 'active'
  AND (last_seen IS NULL OR last_seen < datetime('now', '-72 hours'));
```

**Also check stuck requests:**
```sql
-- Requests pending >2h with no answer
SELECT from_agent, to_agent, topic, question, created_at,
  ROUND((julianday('now') - julianday(created_at)) * 24, 1) as hours_pending
FROM agent_requests
WHERE status = 'pending'
  AND created_at < datetime('now', '-2 hours')
ORDER BY created_at ASC;
```

**Include in report:**
- Ping results: X/Y alive, Y dead (auto-flagged), Z unreachable
- Silent agents >24h: [list with hours]
- Stuck requests >2h: [from → to, topic, hours pending]

If >3 dead webhooks or >5 stuck requests → include in email notification.

### STEP 8: Notify Only If Issues

- If everything is healthy: Save report, done. No notification needed.
- If issues found: Save report AND send email to owner with summary.

Use `send_message` to owner with subject "🔧 Weekly Stack Audit — [issues found]" only when there are actionable problems.

### OUTPUT

Return a brief summary of findings:
- Key metrics (3-4 numbers)
- Issues found (or "all clear")
- Top recommendation
- Report file path
