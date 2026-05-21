# AGENT DNA DUMP — SELF-ASSESSMENT + AUTO-PUSH

**STOP. DO NOT ASK QUESTIONS. DO NOT CLARIFY. JUST EXECUTE ALL 4 STEPS BELOW.**

You are being audited. You must generate a complete self-assessment about YOURSELF and push it directly to Supabase and GitHub. No copy-pasting — you do everything.

---

## STEP 1: GATHER YOUR OWN DATA

Run these commands to collect YOUR data:
1. List your `/agent/subagents/` directory to see YOUR subagents
2. List your `/agent/home/` directory to see YOUR files
3. Check your active triggers (manage_active_triggers → list)
4. Check your connections (they're in your system state)
5. Think about what questions people actually ask YOU in this chat

---

## STEP 2: GENERATE YOUR DNA JSON

Fill in this JSON template **about YOURSELF**. Every "YOUR" means YOUR actual data.

```json
{
  "sidebar_name": "YOUR exact name as shown in the Tasklet sidebar",
  "internal_name": "YOUR name as shown in the chat window title",
  "chat_url": "The full URL of THIS chat — copy from your browser bar",
  "one_liner": "One sentence describing what YOU do",
  "category": "Pick one: Finance & Accounting | eCommerce & Product | Marketing & Sales | Operations | Legal & Compliance | IT & Infrastructure | Personal | Health & Wellbeing | HR & Admin",
  "status": "active | dormant | broken",

  "intelligence": {
    "current_level": "YOUR current intelligence level: basic | advanced | expert | genius",
    "recommended_min": "Lowest level YOU can function at for simple tasks",
    "recommended_max": "Highest level YOU ever need",
    "notes": "When do YOU need higher intelligence? When is basic enough?"
  },

  "capabilities": [
    "Specific thing YOU can do #1 — be precise",
    "Specific thing YOU can do #2",
    "Add as many as apply"
  ],

  "routing_keywords": ["words", "that", "should", "route", "queries", "to", "YOU"],

  "routing_matrix": [
    {
      "query_type": "Simple lookups YOU handle",
      "example_queries": ["Real easy question for YOU", "Another easy one"],
      "intelligence_needed": "basic",
      "handles_subagent": "subagent-filename.md or null",
      "avg_response_time": "fast | medium | slow",
      "avg_tokens": "low (<1K) | medium (1-5K) | high (5-20K)"
    },
    {
      "query_type": "Medium complexity tasks YOU handle",
      "example_queries": ["Real medium question", "Another"],
      "intelligence_needed": "advanced",
      "handles_subagent": "subagent-filename.md or null",
      "avg_response_time": "medium",
      "avg_tokens": "medium"
    },
    {
      "query_type": "Complex tasks YOU handle",
      "example_queries": ["Hardest question for YOU", "Another complex one"],
      "intelligence_needed": "expert or genius",
      "handles_subagent": "subagent-filename.md or null",
      "avg_response_time": "slow",
      "avg_tokens": "high or very_high"
    }
  ],

  "subagents": [
    {
      "filename": "exact-filename.md",
      "purpose": "What this subagent does (2-3 sentences)",
      "task_types": ["data_lookup", "analysis", "report_generation", "file_processing", "web_scraping", "api_call", "notification", "calculation", "formatting"],
      "query_patterns": ["If user asks THIS, this subagent handles it"],
      "intelligence_needed": "basic | advanced | expert | genius",
      "dependencies": {
        "connections": ["Services needed"],
        "tables": ["Supabase tables"],
        "other_subagents": [],
        "external_agents": []
      },
      "output_type": "data | file | message | action | report",
      "response_speed": "fast | medium | slow"
    }
  ],

  "connections": [
    {
      "service": "Service Name",
      "connection_id": "YOUR actual conn_xxx ID",
      "what_for": "What YOU use this for",
      "tools_activated": ["list", "of", "tools"]
    }
  ],

  "triggers": [
    {
      "type": "schedule | webhook | gmail | slack | etc",
      "description": "What YOUR trigger does",
      "frequency": "daily | weekly | on-demand | etc",
      "trigger_id": "YOUR trigger ID"
    }
  ],

  "webhook": {
    "has_webhook_trigger": true,
    "webhook_url": "YOUR webhook URL or null",
    "notes": "Auth requirements or special headers"
  },

  "key_rules": [
    "Business rule that affects how YOU work #1",
    "Business rule #2"
  ],

  "input_format": {
    "accepts": "What kind of messages/requests YOU handle best",
    "example_queries": [
      "Real question #1 a human would type for YOU",
      "Real question #2",
      "Real question #3",
      "Real question #4",
      "Real question #5"
    ]
  },

  "output_format": {
    "returns": "What YOU typically return — data, reports, files, actions, etc",
    "response_time": "fast | medium | slow",
    "typical_token_usage": "low | medium | high | very_high"
  },

  "cooperation_partners": [
    {
      "agent": "Name of OTHER Tasklet agent you work with",
      "how": "What you do together",
      "direction": "I call them | They call me | Bidirectional"
    }
  ],

  "databases_tables": [
    {
      "table": "Supabase table YOU read/write",
      "access": "read | write | read+write",
      "what_for": "What YOU use this table for"
    }
  ],

  "github_repos": [
    {"repo": "owner/repo", "what_for": "What YOU use it for"}
  ],

  "files_and_paths": [
    {"path": "/agent/home/your-file.md", "what": "What this file is for"}
  ],

  "known_issues": [
    "Any bugs or limitations YOU currently have"
  ]
}
```

If you don't have something (e.g. no subagents), use `[]`. If unsure, add `"?"` after the value.

---

## STEP 3: PUSH TO SUPABASE

You MUST have a Supabase connection. If you don't have one:
- Create one using `create_new_connections` with integration ID `supabase`
- Use the Qualico Supabase project (project ID: `zlteahycfmpiaxdbnlvr`)

Once you have Supabase connected, run this SQL using `execute_sql` (replace the placeholder values with YOUR actual data from the JSON you generated above):

```sql
INSERT INTO "Agents_Overview" (
  agent_name,
  one_liner,
  category,
  department,
  status,
  webhook_url,
  chat_url,
  min_intelligence,
  max_intelligence,
  capabilities,
  routing_keywords,
  routing_matrix,
  subagents_info,
  connections_info,
  triggers_info,
  cooperation_partners,
  input_format,
  output_format,
  subagent_count,
  dna_json,
  dna_dumped_at,
  last_seen
) VALUES (
  'YOUR_SIDEBAR_NAME',
  'YOUR_ONE_LINER',
  'YOUR_CATEGORY',
  'YOUR_CATEGORY',
  'YOUR_STATUS',
  'YOUR_WEBHOOK_URL_OR_NULL',
  'YOUR_CHAT_URL',
  'YOUR_MIN_INTELLIGENCE',
  'YOUR_MAX_INTELLIGENCE',
  'YOUR_CAPABILITIES_AS_COMMA_SEPARATED_TEXT',
  ARRAY['YOUR', 'ROUTING', 'KEYWORDS'],
  'YOUR_ROUTING_MATRIX_AS_JSON'::jsonb,
  'YOUR_SUBAGENTS_ARRAY_AS_JSON'::jsonb,
  'YOUR_CONNECTIONS_ARRAY_AS_JSON'::jsonb,
  'YOUR_TRIGGERS_ARRAY_AS_JSON'::jsonb,
  'YOUR_COOPERATION_PARTNERS_AS_JSON'::jsonb,
  'YOUR_INPUT_FORMAT_AS_JSON'::jsonb,
  'YOUR_OUTPUT_FORMAT_AS_JSON'::jsonb,
  NUMBER_OF_SUBAGENTS,
  'YOUR_COMPLETE_DNA_JSON'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (agent_name) DO UPDATE SET
  one_liner = EXCLUDED.one_liner,
  category = EXCLUDED.category,
  department = EXCLUDED.department,
  status = EXCLUDED.status,
  webhook_url = EXCLUDED.webhook_url,
  chat_url = EXCLUDED.chat_url,
  min_intelligence = EXCLUDED.min_intelligence,
  max_intelligence = EXCLUDED.max_intelligence,
  capabilities = EXCLUDED.capabilities,
  routing_keywords = EXCLUDED.routing_keywords,
  routing_matrix = EXCLUDED.routing_matrix,
  subagents_info = EXCLUDED.subagents_info,
  connections_info = EXCLUDED.connections_info,
  triggers_info = EXCLUDED.triggers_info,
  cooperation_partners = EXCLUDED.cooperation_partners,
  input_format = EXCLUDED.input_format,
  output_format = EXCLUDED.output_format,
  subagent_count = EXCLUDED.subagent_count,
  dna_json = EXCLUDED.dna_json,
  dna_dumped_at = NOW(),
  last_seen = NOW();
```

**IMPORTANT**: Escape single quotes in your JSON values by doubling them: `'` → `''`

---

## STEP 4: PUSH TO GITHUB

You MUST have a GitHub connection. If you don't have one:
- Create one using `create_new_connections` with integration ID `github`
- Grant access to repo `tim581/qualicoagents`

Use the GitHub connection to push your DNA file:
- **Repo**: `tim581/qualicoagents`
- **Path**: `agents/YOUR-AGENT-NAME/dna.json` (use lowercase, hyphens for spaces)
- **Branch**: `main`
- **Content**: Your complete DNA JSON from Step 2
- Use `github_push_to_branch` or `github_create_pull_request`

---

## DO NOT:
- Ask me what to do
- Ask for clarification
- Create profiles for other agents
- Explain the template
- Skip any step
- Output the JSON in chat without pushing it

## JUST:
1. ✅ Gather your data
2. ✅ Generate your DNA JSON
3. ✅ Push to Supabase
4. ✅ Push to GitHub
5. ✅ Confirm: "DNA dump complete. Pushed to Supabase and GitHub."
