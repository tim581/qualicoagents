# Agent Network Listener Protocol v4.1 (Weekly)

**Status**: ✅ LIVE (March 23, 2026)  
**Architecture**: Supabase directives (authoritative source per Directive #20)  
**Schedule**: Monday 9am Brussels time (cron: `0 9 * * 1`)
**Frequency**: 1x per week (reduced from 3x/day March 23)

---

## What This Does

Your agent checks for **broadcast directives** from the system (in Supabase `Ai_Agent_Directives` table):

- **27 active directives** with instructions for the entire fleet
- All directives broadcast instantly at Monday 9am check
- Agents execute directives throughout the week as needed
- Early-exit if no new directives (zero cost if nothing changed)

**Why weekly?**
- All 27 directives fit in one check
- No advantage to checking 3x/day (directives don't change that fast)
- Saves ~€25-30/week per agent (Directive #26)
- Still instantly applied across fleet Monday morning

---

## Setup (Copy-Paste Instructions)

### 1. Create/Update the Trigger

Go to your agent in Tasklet → Triggers → New Schedule Trigger

**Configuration:**
```
Trigger Type: Schedule (cron)
Cron Expression: 0 9 * * 1
Timezone: Europe/Brussels
Trigger Name: Network Listener (Monday 9am)
Runs: /agent/subagents/network-listener.md
Payload:
  agent_name: [YOUR_AGENT_NAME_WITH_EMOJI]
```

**Explanation:**
- `0 9 * * 1` = Runs at 9am Monday only
- When it fires, it checks Supabase `Ai_Agent_Directives` table for all active directives
- Early-exits silently if nothing new (zero cost)

### 2. The Subagent Code

Create `/agent/subagents/network-listener.md` with this structure:

**Purpose**: Fetch all active directives from Supabase and execute them

**Your subagent should**:
1. Query `Ai_Agent_Directives` WHERE `active = true` AND `domain IN ('all', 'YOUR_DOMAIN')`
2. For each directive: Execute the instruction
3. Report directives executed (quiet execution, not chatty)
4. Skip silently if no new directives since last check

**Minimal implementation**:
```sql
SELECT directive_number, title, content 
FROM "Ai_Agent_Directives"
WHERE active = true 
  AND domain IN ('all', 'company')  -- or 'personal' if personal agent
ORDER BY directive_number;
```

Then execute each directive's instructions.

---

## All 27 Active Directives (As of March 23, 2026)

| # | Title | Domain | Purpose |
|---|-------|--------|---------|
| 1 | Agent Naming Standard | company | One name per agent, emoji format |
| 2 | Weekly Knowledge Upload | company | Share findings in Supabase |
| 3 | No Duplicate Asana Requests | company | Check before creating tasks |
| 4 | Network Listener Setup | company | This very system |
| 5 | Drive Folder Population | company | Keep output folders current |
| 6 | Update Network Listener Code | company | Query Supabase not Notion |
| 7 | Populate Output Folders | company | Push deliverables to Drive |
| 8 | Learn Consolidated Docs | company | Read 5 core Notion pages |
| 10 | Trigger Optimization | company | Reduce frequency, add filters |
| 11 | Bookmarks Library Access | company | 1,235 URLs in Supabase |
| 12 | Basic Intelligence Mandate | company | Operate at Basic ($) level |
| 13 | DEPRECATED: Agent Requests | company | Old system (now Airtable) |
| 14 | Reset to Basic NOW | company | No permission needed to go basic |
| 15 | Email Composition Protocol | company | Draft in Gmail, match Tim's style |
| 16 | Never Invent Data | company | Query sources, never synthesize |
| 17 | Directives Moved to Supabase | company | This table is authoritative |
| 18 | Task Logging System | company | Log all work in two tables |
| 19 | Agent Requests → Airtable | company | Post decisions to "Tasklet Base" |
| 20 | ARCHITECTURE PRINCIPLE | company | Agent data → Supabase, human data → Notion |
| 21 | Agent Briefings → Supabase | company | Briefings only in Supabase, not Notion |
| 22 | Briefing Update Schedule | company | Update briefings Friday 18h only |
| 23 | Agent Decision Protocol | company | Post only decision forks Tim resolves |
| 24 | Connection Retry Protocol | company | Retry 3x before escalating |
| 25 | Knowledge vs Execution Split | company | Know WHERE to log what |
| 26 | Network Listener Weekly | all | This trigger: Monday 9am only |
| 27 | Agent Briefings Cleanup | all | 43 active agents, 9 complete |

---

## Important Notes

- **Early exit**: If no new directives since last check, don't spam — just exit silently
- **All agents run independently**: Your agent doesn't need to know about other agents
- **No acknowledgment needed**: Tim doesn't expect confirmations — just execute
- **Directives are durable**: They stay active until Tim marks them `active = false`
- **Execution is flexible**: You have the whole week to implement each directive

---

## Changelog

- **v4.1 (March 23, 2026)**: Weekly schedule (was 3x/day), added Directives #26-27
- **v4.0 (March 11, 2026)**: Switched from Notion to Supabase for speed
- **v3.1 (March 9, 2026)**: Initial release with Notion directives
