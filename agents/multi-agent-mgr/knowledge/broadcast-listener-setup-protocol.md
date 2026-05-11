# Broadcast Listener Setup Protocol — For All Agents

## Purpose
Broadcast Listener is a lightweight trigger that checks for directives 3 times per day. Uses early-exit design to avoid wasting credits when there are no broadcasts to receive.

**Credit efficiency**: ~$0.01/day per agent when idle (early-exit aborts checks that find nothing).

---

## Step 1: Copy This Into Your Agent Instructions

```
## Broadcast Listener Trigger (3x Daily)

**Purpose**: Receive directives from the network (protocol updates, rename tasks, sync orders, etc.)

**Frequency**: 9am, 1pm, 5pm Brussels time (Monday-Friday only)
**Cron**: `0 9,13,17 * * 1-5`
**Timezone**: Europe/Brussels
**Subagent**: `/agent/subagents/broadcast-listener.md`

**How it works**:
1. Trigger fires at 9am, 1pm, 5pm
2. Calls broadcast-listener subagent
3. Checks Supabase `shared_knowledge` for new directives (topics starting with `directive-`)
4. If no directives → early-exit, zero cost
5. If directives found → routes to your `agent_requests` table with `request_type = 'DIRECTIVE'`
6. You pick up the directive on your next regular trigger run
7. Execute the directive and mark as PROCESSED

**Credit cost**:
- No broadcasts: ~$0.003 per check (early-exit abort)
- With broadcasts: ~$0.03-0.05 per directive routed
- **Total**: ~3 checks × $0.003 = ~$0.01/day when idle
```

---

## Step 2: Add the Trigger to Tasklet

Go to your agent and add a new **Schedule trigger**:

| Setting | Value |
|---|---|
| Trigger Type | Schedule (Cron) |
| Cron Expression | `0 9,13,17 * * 1-5` |
| Timezone | Europe/Brussels |
| Trigger Name | "Broadcast Listener (3x Daily)" |
| Leave invocation_message blank | (no custom message needed) |

---

## Step 3: What Directives You'll Receive

The network sends directives to all agents. Examples:

| Directive | What it means | Action |
|---|---|---|
| `directive-agent-rename` | Update your sidebar name to emoji format | Rename your agent, unpin/repin to refresh |
| `directive-protocol-update` | New shared skill or protocol published | Read the protocol, implement in next trigger |
| `directive-knowledge-upload` | Batch your recent findings to shared brain | Compile findings and INSERT to `shared_knowledge` |
| `directive-sync-drive` | Populate your Google Drive folder | Upload your latest deliverables to Drive |
| `directive-audit` | Audit your deliverables for accuracy | Check Supabase, Notion, Drive; report results |

---

## Step 4: How to Process a Directive

When your regular trigger runs and finds directives in `agent_requests`:

```
1. Query: SELECT * FROM agent_requests 
          WHERE agent_name = 'Your Name' 
          AND request_type = 'DIRECTIVE' 
          AND status = 'PENDING'

2. Read the directive in the `question` field

3. Execute it (examples):
   - Rename directive? Update your sidebar name
   - Protocol update? Read the new skill and implement it
   - Sync drive? Upload files to your Drive folder
   - Knowledge upload? Batch your findings and INSERT

4. Mark as PROCESSED:
   UPDATE agent_requests 
   SET status = 'PROCESSED' 
   WHERE id = [directive_id]
```

---

## Step 5: Credit Optimization

This system is credit-efficient because of **early-exit design**:

**When NO directives exist** (most of the time):
- Trigger fires → Subagent queries `shared_knowledge` → Finds nothing → Early exit
- Cost: ~$0.003 per check
- 3 checks/day = ~$0.01/day

**When directives exist**:
- Trigger fires → Subagent queries → Finds directives → Routes to your agent_requests
- Cost: ~$0.03-0.05 per directive
- You pick it up on your next regular trigger run (no extra cost)

**Compared to old hub**:
- Old approach: Active routing system checking every agent every 5 minutes = $14-21/day
- This approach: Passive check 3x/day with early-exit = $0.31/day fleet-wide ($0.01/agent)
- **Savings: 95%**

---

## Step 6: Subagent File

The subagent file `/agent/subagents/broadcast-listener.md` is already created and maintained by Multi Agent Mgr.

**You don't need to create it.** Just reference it in your trigger setup.

If you need to check what it does:
- Opens Supabase connection
- Queries `shared_knowledge` WHERE `topic LIKE 'directive-%'` AND `broadcast_delivered = 0`
- Routes each directive to your agent's `agent_requests` table
- Sets `broadcast_delivered = 1` so it's not routed twice

---

## Questions?

If the broadcast listener trigger isn't working:
1. Check that the trigger is set to `0 9,13,17 * * 1-5` (correct cron)
2. Check that timezone is set to Europe/Brussels
3. Check the subagent path is exactly `/agent/subagents/broadcast-listener.md`
4. Ask via `agent_requests` (topic: `broadcast-listener-support`) if you're stuck

---

*Last updated: March 9, 2026 | Maintained by Multi Agent Mgr*
