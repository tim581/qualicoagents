# Agent Efficiency Protocol v2.0
## Goal: Maximum credit savings, zero performance loss
### Updated with Research Agent deep-dive findings (March 2026)

**Target: $450/wk → $135-175/wk (65-70% reduction)**

---

## PART 1: INTERNAL AGENT BEHAVIOR

### 1.1 — Right-Size Your Intelligence
- **Standard ($)**: Routine tasks, file moves, simple lookups, heartbeats, status updates
- **Advanced ($$)**: Data analysis, report generation, multi-step workflows
- **Expert ($$$)**: Complex reasoning, strategic decisions, creative work
- **Rule**: Start at Standard. Only escalate intelligence when the task ACTUALLY requires it.
- **Never use Expert for**: Reading files, sending messages, simple SQL queries, formatting output

### 1.2 — Minimize Tool Calls Per Run
- **Combine SQL queries** where possible (batch INSERTs, use CTEs)
- **Never read back data you just wrote** — trust the write succeeded
- **Never fetch data you already have** — if it's in the trigger payload, use it directly
- **Target**: 3-5 tool calls for simple tasks, 8-12 for complex workflows
- **Anti-pattern**: Making 3 separate search calls when 1 broader search covers it

### 1.3 — Context Compaction (NEW — Critical Gap #1)
- **Maintain running summaries**, not full conversation history
- At the start of each run, your context should be: current task + minimal relevant state
- **Don't load entire files** when you only need a section — use start_line/end_line
- **Don't fetch full web pages** when a search snippet answers the question
- **Don't load full database schemas** every run — cache what you need in your subagent instructions
- **Subagents over inline work** — subagents have clean context, parent agent's context grows expensive
- **Summary pattern**: After processing a batch of data, summarize findings into 1-2 sentences before continuing. Don't carry raw data forward.

### 1.4 — Batch Your Output
- **One file per run**, not one file per finding
- **One message per run**, not one message per item
- **Aggregate results** before writing — don't write partial results multiple times

### 1.5 — Cache Locally (KV-Cache Pattern — Critical Gap #5)
- Store frequently-used data in your SQL database or local files
- Only query external APIs when local data is stale or missing
- **TTL guidelines**:
  - Agent directory info: 1 hour
  - Reference data (exchange rates, config): 24 hours  
  - Static config (folder IDs, project IDs): 1 week
  - Webhook URLs: 24 hours (re-verify on failure)
- **Pattern**: Check local cache → if miss or stale → fetch external → update cache → use data
- **Never re-fetch** what you fetched earlier in the same run

### 1.6 — Lazy Evaluation (Skip Unnecessary Work)
- Before starting a task, check if the output already exists and is current
- If nothing changed since last run, report "no changes" and stop — don't regenerate
- Never re-process data that hasn't been updated
- **Downstream check**: If nobody consumes your output, don't produce it
- **Stale check**: Compare last_updated timestamp before regenerating any report or file

---

## PART 2: HUB COMMUNICATION

### 2.1 — Message Type Selection (Critical for Fast-Path Routing)
The hub now uses FAST-PATH routing. Simple messages skip expensive processing entirely.

| Message Type | Hub Processing | When to Use |
|---|---|---|
| `heartbeat` | ⚡ FAST (SQL only) | Periodic alive ping — max 1x per run |
| `update` | ⚡ FAST (SQL only) | Report completed work — batch all updates into ONE message |
| `strategic_briefing` | ⚡ FAST (SQL only) | Share strategic context — no response expected |
| `knowledge` | 🔄 FULL (quality gates) | Publish learnings — only when value ACTUALLY changed |
| `register` | 🔄 FULL (SQL + Notion) | First connection or config change only |
| `request` | 🔄 FULL (routing) | Ask another agent for data — check local cache first |
| `directory` | 🔄 FULL (lookup) | Find agent webhook — cache result for 24 hours |
| `alert` | 🔄 FULL (notification) | Blocking issues only — DARE escalations |

### 2.2 — When NOT to Message the Hub
- ❌ Don't send heartbeat if you're already sending an update or knowledge message (your activity is logged)
- ❌ Don't send knowledge if the value hasn't changed since last push
- ❌ Don't send an update just to say "run completed, nothing to report"
- ❌ Don't acknowledge broadcasts — no-ack policy (Credit Commandment #1)
- ❌ Don't request data from another agent if you can look it up yourself
- ❌ Don't re-register unless your webhook URL or department actually changed
- ❌ Don't send directory lookups if you have a cached webhook that's <24 hours old

### 2.3 — When TO Message the Hub
- ✅ Knowledge push when you discovered something new or a value changed
- ✅ Request when you genuinely need data only another agent has
- ✅ Alert when a task is blocked and needs escalation (DARE protocol)
- ✅ Register when you first start or your config changes

### 2.4 — Batch Knowledge Pushes
ALWAYS batch multiple knowledge entries into ONE message:
```json
{
  "message_type": "knowledge",
  "data": {
    "entries": [
      {"topic": "...", "key": "...", "value": "...", "as_of_date": "..."},
      {"topic": "...", "key": "...", "value": "...", "as_of_date": "..."}
    ]
  }
}
```
NEVER send separate messages for each knowledge entry.

### 2.5 — Minimal Payloads
- Send only fields that are needed — don't include your entire state
- `data` field: actionable information only, not context dumps
- `subject`: max 1 sentence — it's a subject line, not a report
- If you need to share a large result, save to Google Drive and send the link

### 2.6 — Directory Caching
When you look up another agent's webhook via the hub:
- Save the webhook URL locally (file or SQL)
- Reuse for at least 24 hours before querying again
- Only re-query if a direct curl to the cached webhook fails

---

## PART 3: TRIGGER & SCHEDULE EFFICIENCY

### 3.1 — Right-Size Your Schedule
- Don't run every 5 minutes if hourly is sufficient
- Don't run hourly if daily covers it
- Ask: "What's the MINIMUM frequency that meets the use case?"

### 3.2 — Early Exit Pattern
At the START of every triggered run, check if there's actual work to do:
1. Check for new data / changes since last run
2. If nothing new → log minimal status and EXIT immediately (1-2 tool calls max)
3. Only proceed to expensive processing if there's real work

### 3.3 — Subagent Design
- Keep subagent instructions FOCUSED — every extra line of instruction = more tokens processed
- One subagent per task type, not one mega-subagent
- Include only the SQL schemas/context the subagent actually needs
- Never include "nice to have" instructions — only what's required

---

## PART 4: COST AWARENESS & BUDGET ENFORCEMENT

### 4.1 — Credit Budget Per Agent (NEW — Critical Gap #3)
Every agent has an implicit credit budget based on its role:

| Agent Type | Max Credits/Week | Max Tool Calls/Run |
|---|---|---|
| **Monitoring** (health, status) | $5 | 5 |
| **Processing** (email, inbox) | $15 | 12 |
| **Analysis** (finance, research) | $25 | 20 |
| **Orchestration** (hub, managers) | $30 | 25 |

If you notice you're consistently hitting budget limits, that's a signal to optimize — not to request more budget.

### 4.2 — Circuit Breakers (NEW — Critical Gap #2)
**Stop throwing credits at failing operations.**

- If an external API call fails, **wait before retrying**: 1st retry after 30s, 2nd after 2min, then STOP
- If a webhook delivery fails 3 times to the same agent, mark them as `unreachable` and stop trying
- If a Notion/Supabase write fails, queue it locally and retry on next scheduled run — don't retry in-loop
- **Never retry more than 3 times** in a single run. After 3 failures: log the error, escalate via DARE, move on.

### 4.3 — Dead Letter Queue (NEW — Critical Gap #4)
When a message or task fails permanently:
- Log to `messages` table with subject prefix "DLQ:"
- Include: original payload, error reason, retry count, timestamp
- Don't keep retrying — let the weekly audit pick up DLQ items for review
- **Pattern**: Try → Retry once → DLQ it → Move on

### 4.4 — The Credit Cost Reference
Think of every tool call as spending money:
- SQL query: ~$0.001
- Web search: ~$0.01  
- Subagent invocation: ~$0.05-0.50 depending on intelligence + context
- Full hub-router processing: ~$0.10-0.30
- Fast-path processing: ~$0.01-0.03
- Notion API call: ~$0.01-0.05
- Google Drive API call: ~$0.01-0.05

### 4.5 — The 3-Second Rule
Before every tool call, ask: "Do I ACTUALLY need this, or do I already have the answer?"
If you already have it → skip the call.

---

## PART 5: ANTI-PATTERNS TO AVOID (8 documented)

These are the most common credit-wasting patterns found across the fleet:

1. **Acknowledgment Theatre** — Replying "got it" to broadcasts. NO-ACK policy. Just process silently.
2. **Re-Registration Spam** — Re-registering on every run "just in case". Register ONCE, then only on config change.
3. **Knowledge Echo** — Re-publishing the same value you published last run. Check before writing.
4. **Context Overload** — Loading entire files/schemas when you need 3 lines. Use start_line/end_line.
5. **Retry Storm** — Retrying failed calls 10+ times in a loop. Use circuit breakers (3 max).
6. **Verbose Payloads** — Sending entire context dumps in hub messages. Send only what's actionable.
7. **Unnecessary Directory Lookups** — Querying the hub for webhooks you already know. Cache for 24 hours.
8. **Intelligence Over-Provisioning** — Using Expert for tasks that Standard handles fine. Start low, escalate only when needed.

---

## PART 6: SELF-MONITORING

### 6.1 — Measure Yourself
Track your own efficiency. In knowledge pushes, include:
- `agent_status.tool_calls_per_run` — your average tool calls
- `agent_status.avg_run_duration` — how long your runs take

This helps the hub identify optimization opportunities across the fleet.

### 6.2 — Weekly Self-Check
Every Friday, the hub audits the entire fleet. Make sure your metrics look good:
- Are you under your credit budget?
- Are your tool calls per run within target?
- Are you caching effectively?
- Are you using the right intelligence level?

---

## SUMMARY CHECKLIST (Every Run)

- [ ] Am I at the right intelligence level for this task?
- [ ] Did I check if there's actual work to do before starting? (Early Exit)
- [ ] Am I batching my outputs (files, messages, knowledge)?
- [ ] Am I only messaging the hub when the value actually changed?
- [ ] Am I using the right message type for fast-path routing?
- [ ] Did I minimize my tool calls?
- [ ] Am I caching data I'll need again?
- [ ] Am I under my credit budget?
- [ ] Did I use circuit breakers on failures (max 3 retries)?
- [ ] Did I compact my context (summaries, not raw data)?
