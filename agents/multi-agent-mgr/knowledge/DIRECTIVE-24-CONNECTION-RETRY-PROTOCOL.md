# Directive #24: Connection Retry Protocol

**Status**: ✅ ACTIVE as of March 12, 2026

**Core Principle**: Resilience before escalation. Most connection errors are transient. Retry before bothering Tim.

---

## The Problem

Connection fails → Agent panics → Posts to Airtable immediately → "Need help!"

But 80% of connection failures are transient (network glitch, temporary overload, etc.) and resolve within minutes.

**Result**: Tim gets spammed with false-positive escalations. Real bugs drown in noise.

---

## The Solution: Structured Retry Logic

### Step 1: Connection Fails
Connection returns: 403, 500, timeout, auth error, etc.

### Step 2-4: Retry 3 Times with 10-Minute Intervals
```
Attempt 1: Fails
    ↓ Wait 10 minutes
Attempt 2: Fails
    ↓ Wait 10 minutes
Attempt 3: Fails
    ↓ Wait 10 minutes
```

**Total time invested**: ~30 minutes

### Step 5: All Retries Exhausted?
If still failing after 3 retries → Escalate to Airtable with full context

---

## Implementation

### Pseudocode

```python
def call_connection_with_retry(connection_name, operation):
    max_retries = 3
    retry_interval = 600  # 10 minutes in seconds
    
    for attempt in range(1, max_retries + 1):
        try:
            result = connection.execute(operation)
            return result
        except ConnectionError as e:
            if attempt < max_retries:
                log(f"Attempt {attempt} failed: {e}. Retrying in 10 minutes...")
                sleep(retry_interval)
            else:
                log(f"All {max_retries} retries failed. Escalating to Tim...")
                post_to_airtable_escalation(connection_name, e, attempt)
                return None
```

### During Retry Windows

**Don't block waiting**. Use the 10-minute windows to do other work:

```
Connection A fails (Attempt 1)
    ↓ Start work on Connection B
    ↓ Work for 10 minutes
    ↓ Retry Connection A (Attempt 2)
    ↓ Continue Connection B work
    ↓ (repeat)
```

Maximize parallel execution while retrying.

---

## When to Escalate (Airtable Request)

**Only after 3 failed retries**, create Airtable Agent Requests record:

**Fields**:
- **Agent Name**: Your emoji + name (e.g., "💼 Accounting")
- **Notes**: Full escalation details (see format below)
- **Request Type**: "Bug Report" or "Integration"
- **Priority**: 
  - 🔴 **Urgent** = Blocks critical path (time-sensitive)
  - 🟡 **High** = Blocks important work
  - 🟢 **Normal** = Blocks routine work
  - ⚪ **Low** = Bonus work blocked

**Escalation Notes Format**:
```
Connection: [Service name]
Error Type: [Connection error, Timeout, 403 Forbidden, etc.]
Error Code: [If available]
Error Message: [Full message]

Retry History:
  Attempt 1: [timestamp] — Failed: [brief reason]
  Attempt 2: [timestamp] — Failed: [brief reason]
  Attempt 3: [timestamp] — Failed: [brief reason]

Total Time Invested: [e.g., 28-38 minutes]

Impact: [What work is blocked. Be specific.]
Example: "Cannot fetch customer emails. Blocking 30 customer service tasks."

Attempted Fixes (before retries):
  - [What you tried, e.g., "Restarted trigger"]
  - [What you tried, e.g., "Checked connection auth tokens in settings"]
  - [What you tried, e.g., "Verified network connectivity"]

Status: [Ready for Tim to investigate]
```

**Example Escalation**:
```
Connection: Supabase
Error Type: 403 Forbidden
Error Code: 403
Error Message: "Invalid API key or insufficient permissions"

Retry History:
  Attempt 1: 2026-03-12 09:05 — Failed: 403 Forbidden
  Attempt 2: 2026-03-12 09:15 — Failed: 403 Forbidden
  Attempt 3: 2026-03-12 09:25 — Failed: 403 Forbidden

Total Time Invested: 20 minutes

Impact: Cannot query agent_briefings table. Blocking 5 agents from reading their briefing metadata at 1pm sync.

Attempted Fixes:
  - Restarted Network Listener trigger
  - Verified API key in connection settings (appears valid)
  - Checked Supabase status page (no incidents reported)

Status: Needs investigation. Possibly expired token or revoked permissions.
```

---

## Expected Resolution Timeline

| Scenario | Resolution Time | Who Fixes |
|----------|---|---|
| **Transient glitch** | 30 minutes | Network auto-resolves on retry 1-3 |
| **Temporary overload** | 10-60 minutes | Service recovers, retry succeeds |
| **Expired token** | 30-120 minutes | Tim reauthorizes connection |
| **Permission revoked** | 30-60 minutes | Tim debugs, restores access |
| **Service down** | Varies | Tim or vendor resolves outage |

---

## Why This Protocol

✅ **Reduces noise**: Tim doesn't get 50 false positives per day  
✅ **Resilience**: Network glitches don't cascade into escalations  
✅ **Parallel work**: Agent doesn't sit idle, does other work during retry windows  
✅ **Context preservation**: When Tim gets escalation, full history is there  
✅ **Teaches distinction**: Agents learn what's transient vs persistent  

---

## Don't Confuse This With

### Directive #23: Decision Protocol
- **Decision Protocol**: "Which path should I take?" (Tim chooses)
- **Retry Protocol**: "Connection failed" (Try again, escalate if persistent)

### Directive #12: Intelligence Level
- **Intelligence Level**: What reasoning model to use
- **Retry Protocol**: How to handle connection failures

---

## Related Directives

- **Directive #23**: Agent Decision Protocol (when to post decisions)
- **Directive #19**: Agent Requests to Airtable (system details)
- **Directive #10**: Trigger Optimization (efficiency)
