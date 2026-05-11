# Agent Request Protocol - Setup Prompt (Copy-Paste to Agent Chat)

**Copy everything below and paste into your agent's chat to set them up immediately:**

---

# 🚀 New: Agent Request Protocol - You're Now Active

Effective immediately: You now have access to a centralized system to request Tim's input when you're blocked.

## How It Works (3 Steps)

### 1. When You're Blocked → Write to Database
Don't email or Slack. Write directly to Supabase `agent_requests` table:

```sql
INSERT INTO agent_requests (
  agent_name,
  request_type,
  question,
  context,
  priority,
  domain
) VALUES (
  'Your Agent Name',
  'DECISION',  -- or MISSING_DATA, APPROVAL, BLOCKED, INPUT
  'Your question here?',
  'Optional context',
  'URGENT',    -- or NORMAL, BATCH
  'company'    -- or 'personal'
);
```

**Request types**: DECISION, MISSING_DATA, APPROVAL, BLOCKED, INPUT

**Priority levels**:
- **URGENT** = Tim checks hourly, you check every hour (9am-6pm)
- **NORMAL** = Tim sees in daily report, you check 3x/day (9am, 1pm, 5pm)
- **BATCH** = Can wait, you check once/day (5pm)

### 2. Check for Responses on Each Run
Every time your agent executes, check for Tim's answer:

```sql
SELECT status, answer 
FROM agent_requests 
WHERE agent_name = 'Your Agent Name' 
AND status IN ('ANSWERED', 'PENDING')
ORDER BY created_at DESC 
LIMIT 1;
```

If `status = 'ANSWERED'` → use the answer in `answer` column to continue work.

### 3. Mark as Processed
After you've used Tim's response:

```sql
UPDATE agent_requests 
SET status = 'PROCESSED' 
WHERE agent_name = 'Your Agent Name' 
AND id = {request_id};
```

## Adaptive Checking Frequency

**You have a pending request?**
- URGENT: Check every hour during business hours
- NORMAL: Check at 9am, 1pm, 5pm
- BATCH: Check at 5pm

**No pending requests?**
- Go back to your standard schedule (3x/day: morning, midday, evening)

## Examples

**Email Agent (URGENT)**: Blocked at 2:15pm on "should I send this email?" 
→ Writes URGENT request → Checks every hour → Tim responds → Continues work → ~1-2 hour delay ✅

**Finance Agent (NORMAL)**: Needs approval to write off debt at 10:45am
→ Writes NORMAL request → Checks at 9am, 1pm, 5pm → Tim responds by 5pm → Same-day decision ✅

**Research Agent (BATCH)**: Wants to know which market to analyze at 8:15am
→ Writes BATCH request → Continues other work → Checks at 5pm → Tim responds by morning → 24-hour window ✅

## Key Rules

1. **Write immediately** when blocked (don't wait for next trigger)
2. **Check every run** for responses
3. **Mark PROCESSED** after using response
4. **Accuracy matters** on priority — it controls your checking schedule
5. **No forgotten requests** — if blocked >48h, escalate to Multi Agent Mgr

## Tim's Interface

Tim sees all your requests in the "Agent Request Inbox" app in Tasklet. He responds with one click. You pick it up on your next check based on priority level.

## Integration

Add this to your agent workflow:
```
1. Do your work
2. Hit a blocker? → INSERT INTO agent_requests
3. Next run: → Check agent_requests for status = 'ANSWERED'
4. If answered: → Use response to continue work
5. Mark: → UPDATE status = 'PROCESSED'
6. Resume work
```

## Questions?

Full documentation in `/agent/home/shared-skills/agent-request-protocol.md` and Notion Shared Skills Library (Skill #8).

---

**Ready to use immediately. Tim will see your requests within the hour.**

