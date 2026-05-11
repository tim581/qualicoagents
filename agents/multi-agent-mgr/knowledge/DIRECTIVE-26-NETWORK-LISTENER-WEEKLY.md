# Directive #26 - Network Listener → Weekly Monday Schedule

**Effective**: March 23, 2026  
**Priority**: SYSTEM-WIDE  
**Impact**: Massive credit savings (~€15-20/week per agent)

---

## The Change

**OLD**: Network Listener trigger runs **3x/day** (9am, 1pm, 5pm Brussels, M-F)
- 15 invocations/week per agent
- 37 agents × 15 = 555 total invocations/week
- ~€30-40/week fleet-wide

**NEW**: Network Listener trigger runs **1x/week** (Mondays 9am Brussels)
- 1 invocation/week per agent
- 37 agents × 1 = 37 total invocations/week
- ~€2-3/week fleet-wide

**Savings**: ~€27-37/week (~€108-148/month, ~€1,300-1,800/year)

---

## Why This Works

1. **Directives change infrequently** - Most directives stay active for days/weeks
2. **Weekly rhythm matches agent update cycle** - Agents update briefings Friday (Directive #22), receive updated directives Monday morning
3. **Monday morning coordination** - All agents aligned with same fresh directive set for the week
4. **Reduced polling overhead** - No wasted checks when nothing changed
5. **Still real-time when needed** - Tim can update Supabase `Ai_Agent_Directives` table anytime; agents pick up changes Monday 9am

---

## Updated Trigger Configuration

**For all agents with Network Listener installed**:

```
Type: Schedule (cron)
Cron: 0 9 * * 1          [Monday 9am Brussels]
Timezone: Europe/Brussels
Target: /agent/subagents/network-listener.md
```

**Old cron** (DELETE this): `0 9,13,17 * * 1-5`

---

## What Agents Receive

**Every Monday 9am, agents fetch ALL active directives** from `Ai_Agent_Directives` table:
- Status = `active`
- Domain matches agent domain (company/personal/all)
- Includes all 26+ system-wide directives
- Execute all applicable directives for the week

---

## Update Your Trigger

1. **Find** your Network Listener trigger in active triggers
2. **Edit** the cron expression to: `0 9 * * 1`
3. **Save** and verify it shows "Monday 9:00 AM Brussels"
4. **Test** by running simulation if desired

---

## FAQ

**Q: What if I need an urgent directive change on Wednesday?**  
A: Update `Ai_Agent_Directives` in Supabase immediately. Agents will pick it up Monday. For true emergencies, use direct agent communication (chat/message) instead of directive system.

**Q: What if I miss Monday morning?**  
A: Your agent will get the directives at the next scheduled Monday 9am. No impact if you're away — directives stay current.

**Q: Will this cause agents to get stale directives?**  
A: No. Directives in Supabase are continuously updated. Your agent queries the latest state every Monday morning.

**Q: Should I coordinate with other agents?**  
A: No. Each agent updates independently. Mondays 9am Brussels is staggered (each in their own trigger), not coordinated.

---

## Implementation Timeline

- **Immediately**: Update your trigger to Monday 9am schedule
- **First execution**: Next Monday 9am Brussels time
- **No agent changes required**: Subagent code stays the same
- **Backward compatible**: Works with all 26 existing directives

---

## Credit Savings

| Metric | Before | After | Savings |
|--------|--------|-------|---------|
| Invocations/agent/week | 15 | 1 | -93% |
| Cost/agent/week | ~€0.81 | ~0.05 | -94% |
| Fleet-wide/week | ~€30 | ~€2 | **-93%** |
| **Fleet-wide/month** | **~€130** | **~€8** | **-94%** |

---

## Status

✅ Directive #26 broadcast system-wide (March 23, 2026)  
✅ All agents receive Monday 9am via Network Listener this week  
✅ Savings begin immediately upon implementation
