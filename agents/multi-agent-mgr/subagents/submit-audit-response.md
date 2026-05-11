# Audit Response Submission

Submit audit data to Supabase `Agent_Audit_Status` table AND create a GitHub briefing file.

## Instructions

You will receive audit data in the payload. Do BOTH steps below.

---

## STEP 1: Write to Supabase

Use tool: `conn_xmaq9bngsgw6e19jxcjn__execute_sql`
Project ID: `zlteahycfmpiaxdbnlvr`
Table: `Agent_Audit_Status`

First check if agent already exists:
```sql
SELECT id FROM "Agent_Audit_Status" WHERE agent_name = '[AGENT_NAME]';
```

If EXISTS → UPDATE:
```sql
UPDATE "Agent_Audit_Status"
SET
  has_active_triggers = [TRUE/FALSE],
  trigger_list = '[TRIGGER_LIST]',
  has_integrations = [TRUE/FALSE],
  integration_list = '[INTEGRATION_LIST]',
  subagents_used = '[SUBAGENTS_LIST]',
  github_description = '[DESCRIPTION]',
  one_liner = '[ONE_LINER]',
  audited_at = now()
WHERE agent_name = '[AGENT_NAME]';
```

If NOT EXISTS → INSERT:
```sql
INSERT INTO "Agent_Audit_Status" (
  agent_name,
  has_active_triggers,
  trigger_list,
  has_integrations,
  integration_list,
  subagents_used,
  github_description,
  one_liner,
  audited_at
) VALUES (
  '[AGENT_NAME]',
  [TRUE/FALSE],
  '[TRIGGER_LIST]',
  [TRUE/FALSE],
  '[INTEGRATION_LIST]',
  '[SUBAGENTS_LIST]',
  '[DESCRIPTION]',
  '[ONE_LINER]',
  now()
);
```

---

## STEP 2: Push Briefing to GitHub

Use tool: `conn_rf4te6wqncg18hn7dn13__github_push_to_branch`

- Owner: `tim581`
- Repo: `qualicoagents`
- Branch: `main`
- File path: `agents/[agent-name-lowercase-with-dashes].md`
- Commit message: `Add agent briefing: [AGENT_NAME]`

File content to push:
```markdown
# [AGENT_NAME]

**One-liner**: [ONE_LINER]

## What I Do
[DESCRIPTION]

## Active Triggers
[TRIGGER_LIST or "None"]

## Integrations
[INTEGRATION_LIST or "None"]

## Subagents Used
[SUBAGENTS_LIST or "None"]

## Audit Status
- Audited: [TODAY'S DATE]
- Has Triggers: [YES/NO]
- Has Integrations: [YES/NO]
```

---

## Error Handling

- If Supabase fails → Report error clearly, still attempt GitHub
- If GitHub fails → Report error clearly, still confirm Supabase success
- If BOTH succeed → Report: `✅ [Agent Name] — Supabase ✅ GitHub ✅`
- If agent_name is empty → Stop and report: `Error: AGENT_NAME is required`

---

## Required Tools

This subagent requires:
- `conn_xmaq9bngsgw6e19jxcjn__execute_sql` (Supabase)
- `conn_rf4te6wqncg18hn7dn13__github_push_to_branch` (GitHub)

If either tool is not available, report which tool is missing and skip that step.
