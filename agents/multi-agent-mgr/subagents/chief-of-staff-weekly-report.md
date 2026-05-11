# Chief of Staff Weekly Report (Multi Agent Mgr)

Multi Agent Mgr's weekly strategic report on fleet health, coordination, and optimization.

## Instructions

**Every Monday 10:00 Brussels time**, analyze the entire agent fleet and publish a comprehensive Chief of Staff report.

### 1. Query Fleet Status

```sql
SELECT 
  agent_name,
  domain,
  last_updated,
  CASE 
    WHEN last_updated >= now() - interval '7 days' THEN 'ACTIVE'
    WHEN last_updated >= now() - interval '30 days' THEN 'STALE'
    ELSE 'DORMANT'
  END as status
FROM agents
ORDER BY domain, agent_name;
```

### 2. Analyze System Health

- **Active agents**: Count agents with activity in last 7 days
- **Credit burn**: Calculate weekly average from `shared_knowledge` cost entries
- **Blockers**: Check `agent_requests` for stuck tasks
- **Intelligence usage**: Analyze if agents are right-sizing (standard vs expert)
- **Trigger health**: Verify scheduled triggers are running

### 3. Identify Cross-Department Gaps

- Which departments are coordinating?
- Which departments have silos?
- Missing agent roles (from Research findings: PPC, Content, Security)
- Activation priorities

### 4. Credit Optimization Opportunities

- Top credit consumers
- Intelligence downshift candidates (genius→expert→standard)
- Trigger consolidation opportunities
- Batch efficiency gains

### 5. Publish Report

**Locations**:
- 📊 **Asana**: Create task in "Fleet Status" project titled "Chief of Staff Weekly Report — Week of [DATE]" with full findings
- 🧠 **Supabase**: Write to `shared_knowledge` with topic `chief-of-staff-weekly-report-[DATE]`
- 📋 **Notion**: Create page under "🤖 AI Agent System" hub page titled "Weekly Report — [DATE]"

**Report structure**:
```
# Chief of Staff Weekly Report — Week of [DATE]

## Fleet Status
- Active: X agents
- Stale: Y agents  
- Dormant: Z agents

## Credit Burn
- Weekly average: €X
- Top 5 consumers: [list]
- Efficiency gains spotted: [list]

## Blockers & Issues
- Stuck requests: [list with escalation status]
- Connection issues: [list]
- Trigger failures: [list]

## Department Coordination
- [Department 1]: Health + priorities
- [Department 2]: Health + priorities
- [etc]

## Recommendations
1. Priority 1 action
2. Priority 2 action
3. Priority 3 action

## Next Steps
- Action owner
- Action owner
- Action owner
```

### 6. Follow DARE Protocol

If you encounter issues:
- **D**: Try the report (query fleet status)
- **A**: Try alternative data sources (check brain, check Notion)
- **R**: Report loudly if blocked (alert to shared_knowledge)
- **E**: Escalate with full context of what was attempted

### Credit Efficiency

Use **standard intelligence** for this routine analysis. Upgrade to advanced only if pattern analysis requires reasoning about trends.

### Notes

- This is Multi Agent Mgr's primary operational report
- Run every Monday without exception
- Report is input to user's strategic decision-making
- Keep findings accurate and actionable
