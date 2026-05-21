# Agent DNA Dump — Paste This Into Every Agent

I need a complete DNA dump of yourself for our agent orchestration system. This will be used to route requests, enable multi-agent cooperation, and track capabilities.

**Output EXACTLY this JSON format — no extra text before or after:**

```json
{
  "sidebar_name": "Exact name shown in the Tasklet sidebar",
  "internal_name": "Name shown in your chat title / how Tasklet identifies you",
  "chat_url": "The full URL of this chat (copy from browser address bar)",
  "one_liner": "One sentence: what you do",
  "category": "Pick one: Finance & Accounting | eCommerce & Product | Marketing & Sales | Operations | Legal & Compliance | IT & Infrastructure | Personal | Health & Wellbeing | HR & Admin",
  "status": "active | dormant | broken",
  
  "intelligence": {
    "current_level": "basic | advanced | expert | genius",
    "recommended_min": "basic | advanced",
    "recommended_max": "expert | genius",
    "notes": "e.g. 'Needs expert for financial modeling, basic for lookups'"
  },
  
  "capabilities": [
    "Specific thing I can do #1 — be precise",
    "Specific thing I can do #2",
    "Specific thing I can do #3"
  ],
  
  "connections": [
    {"service": "Service Name", "connection_id": "conn_xxx", "what_for": "brief description", "tools_activated": ["tool_name_1", "tool_name_2"]}
  ],
  
  "triggers": [
    {"type": "schedule|webhook|gmail|slack|etc", "description": "what it does", "frequency": "daily/weekly/on-demand/etc", "trigger_id": "if you know it"}
  ],
  
  "webhook": {
    "has_webhook_trigger": true,
    "webhook_url": "full URL if you have one, or null",
    "notes": "any auth requirements or special headers needed"
  },
  
  "subagents": [
    {"name": "filename.md", "purpose": "what it does in one line"}
  ],
  
  "key_rules": [
    "Important business rule or constraint #1",
    "Important business rule or constraint #2"
  ],
  
  "input_format": {
    "accepts": "What kind of requests/messages I handle best",
    "example_queries": [
      "Example question someone could ask me #1",
      "Example question someone could ask me #2",
      "Example question someone could ask me #3"
    ]
  },
  
  "output_format": {
    "returns": "What I typically return (data, reports, actions, files, etc)",
    "response_time": "fast (seconds) | medium (1-2 min) | slow (5+ min)",
    "typical_token_usage": "low (<1K) | medium (1-5K) | high (5-20K) | very_high (20K+)"
  },
  
  "cooperation_partners": [
    {"agent": "Agent Name", "how": "What we do together", "direction": "I call them | They call me | Bidirectional"}
  ],
  
  "databases_tables": [
    {"table": "Table_Name", "access": "read | write | read+write", "what_for": "brief description"}
  ],
  
  "github_repos": [
    {"repo": "owner/repo", "what_for": "what I use it for"}
  ],
  
  "files_and_paths": [
    {"path": "/agent/home/important-file.md", "what": "description"}
  ],
  
  "known_issues": [
    "Any current bugs, limitations, or broken features"
  ]
}
```

## Rules:
- List **ALL** your subagents, not just key ones
- List **ALL** your connections with their actual connection IDs and activated tools
- List **ALL** your active triggers with their trigger IDs
- List **ALL** Supabase tables you read from or write to
- List **ALL** files in /agent/home/ that are important
- For webhook: check your active triggers — do you have a webhook trigger? If yes, include the URL
- If you're unsure about something, include it with a "?" suffix
- Be specific in capabilities — "Generate P&L forecasts from Sellerboard data" not "Handle finance"
- For example_queries: think about what a human would type that should be routed to YOU
