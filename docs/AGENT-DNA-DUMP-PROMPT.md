# 🧬 Agent DNA Dump — Paste This Into Each Agent

Copy-paste everything below the line into the agent's chat. It will output a structured report that the Multi Agent Mgr can auto-ingest.

---

I need a complete DNA dump of yourself for our agent orchestration system. Output EXACTLY this format — no extra text before or after the JSON block:

```json
{
  "agent_name": "Your exact name as shown in your chat title",
  "one_liner": "One sentence: what you do",
  "category": "Pick one: Finance & Accounting | eCommerce & Product | Marketing & Sales | Operations | Legal & Compliance | IT & Infrastructure | Personal | Health & Wellbeing | HR & Admin",
  "status": "active | dormant | broken",
  
  "capabilities": [
    "Specific thing I can do #1",
    "Specific thing I can do #2",
    "Specific thing I can do #3"
  ],
  
  "connections": [
    {"service": "Supabase", "connection_id": "conn_xxx", "what_for": "brief description"},
    {"service": "Google Drive", "connection_id": "conn_xxx", "what_for": "brief description"}
  ],
  
  "triggers": [
    {"type": "schedule|webhook|gmail|slack|etc", "description": "what it does", "frequency": "daily/weekly/on-demand/etc"}
  ],
  
  "subagents": [
    {"name": "filename.md", "purpose": "what it does"}
  ],
  
  "key_rules": [
    "Important business rule or constraint #1",
    "Important business rule or constraint #2"
  ],
  
  "input_format": "What kind of requests/messages I handle best",
  "output_format": "What I typically return (data, reports, actions, etc)",
  
  "cooperation_partners": [
    {"agent": "Agent Name", "how": "What we do together"}
  ],
  
  "databases_tables": [
    "Table names I read from or write to in Supabase"
  ],
  
  "github_repos": [
    "owner/repo — what I use it for"
  ]
}
```

Rules:
- List ALL your subagents, not just key ones
- List ALL your connections with their actual connection IDs
- List ALL your active triggers
- List ALL Supabase tables you use
- If you're unsure about something, include it with a "?" suffix
- Be specific in capabilities — "Manage P&L forecasting" not "Handle finance stuff"
