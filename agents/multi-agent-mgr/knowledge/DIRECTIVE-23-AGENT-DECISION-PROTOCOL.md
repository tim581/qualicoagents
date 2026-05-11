# Directive #23: Agent Decision Protocol

**Status**: ✅ ACTIVE as of March 12, 2026

**Core Problem Solved**: Agents getting stuck waiting for Tim's input, blocking other agents from parallel work.

---

## The Problem

With 30 agents, many hit decision points where ONLY Tim can decide:

- "Should I contact Vendor A or Vendor B?"
- "Should I approve this exception?"
- "User wants X but policy says Y — which wins?"

Agent **STOPS WORK** and waits for Tim's input. Meanwhile:
- Other agents blocked on dependencies
- Parallel execution breaks down
- Hours/days of stalled work
- Tim doesn't see the request (misses in chat)

---

## The Solution: Airtable-Based Decision Queue

### When an Agent Hits a Decision Point

Agent posts question to **Airtable Agent Requests** table immediately:

```
Agent Name: 💰 Accounting
Request: "Invoice for $250k has unusual terms. Approve as-is or request revision?"
Request Type: Analysis
Priority: 🟡 High
```

### Tim's Command Center

Tim reviews Airtable Agent Requests:
1. Sort by Priority (🔴 → ⚪)
2. Read question + context
3. Reply in "Notes" field with decision
4. Update Status → "Done"

### Agent Resumes

Agent checks Airtable periodically (every 30 min while waiting):
- Status = "Done" → Read Tim's decision
- Resume work immediately
- Continue parallel execution

---

## Decision vs Other Requests

### ✅ POST TO AIRTABLE (DECISIONS ONLY)

- "Should I do A or B?" (fork in logic)
- "Is this within my authority?" (permission question)
- "User wants X but policy says Y — which wins?" (conflict resolution)
- "Should I take this irreversible action?" (approval for destructive operations)

### ❌ DON'T POST (HANDLE YOURSELF)

- Technical error → Retry (see Directive #24)
- Missing data → Search sources (Google, Notion, Supabase)
- Generic question → Ask another agent
- Routine task → Execute without asking

---

## How to Post a Request

**Airtable Base**: "Tasklet Base"  
**Table**: "Agent Requests"

**Required fields**:
- **Agent Name**: Your emoji + name (e.g., "💰 Accounting")
- **Notes**: Clear decision question + context
  - Include what you recommend and why
  - Example: "Should I X or Y? I lean toward X because... but I'm uncertain about..."
- **Request Type**: Pick best fit (Analysis, Integration, etc.)
- **Priority**:
  - 🔴 **Urgent** = Blocks critical path (use sparingly)
  - 🟡 **High** = Blocks important work
  - 🟢 **Normal** = Blocks routine tasks
  - ⚪ **Low** = Can wait
- **Target Delivery Date** (optional): When you need answer by

---

## Query for Your Responses

```sql
SELECT * FROM airtable_agent_requests 
WHERE agent_name = '💰 Your Agent Name' 
  AND status = 'Done'
ORDER BY updated_at DESC
LIMIT 1;
```

---

## Credit Impact

**Before**: Agent stalls for hours/days → Other agents blocked → Parallel work collapses → Less output

**After**: Agent posts question → Tim answers in batches → Agent resumes → Parallel execution → Exponential output

**Estimated impact**: +30-50% system throughput through eliminating decision bottlenecks

---

## Key Principles

1. **Post immediately** when you hit a decision point (don't wait, don't retry)
2. **Be specific** — Tim can't decide in a vacuum
3. **One question per request** — don't bundle
4. **Check periodically** while waiting (~30 min intervals)
5. **Resume immediately** when you get answer — don't over-verify

---

## Why This Works

- ✅ **Centralized**: All agent questions in one place
- ✅ **Visible**: Tim can see everything needing his input
- ✅ **Batchable**: Review 5+ decisions in one focused session
- ✅ **Transparent**: Agents see status of their requests
- ✅ **Async**: Tim doesn't need to be "on call" — batch review when ready
- ✅ **Parallelizable**: Other agents continue work while waiting for decisions

---

## Related Directives

- **Directive #24**: Connection Retry Protocol (resilience before escalation)
- **Directive #19**: Agent Requests to Airtable (system details)
- **Directive #20**: Architecture Principle (where data lives)
