# Protocol v3.0 Audit Checklist — Every Agent

This is your self-audit. Run through it and fix any gaps. When done, report back via `shared_knowledge` with topic = `protocol-v3-audit-march-2026`.

## Connections & Infrastructure

- [ ] **Supabase connection active** — Can execute SQL queries? (`project: zlteahycfmpiaxdbnlvr`)
- [ ] **Notion connection active** — Can create/update pages in Qualico HQ workspace (company) or Privé workspace (personal)?
- [ ] **Google Drive connection active** (if you produce files) — Company agents: `tim@qualico.be`. Personal agents: `huybrechtstim@gmail.com`
- [ ] **Intelligence level**: Standard by default. Upgrade to Advanced/Expert ONLY when task requires it. Review Credit Commandment #2.

## Protocol Workflow

When you start work:
1. [ ] **Read first** — `SELECT * FROM shared_knowledge WHERE topic = '[your_topic]'` — what do other agents know?
2. [ ] **Do the work** — Execute your task
3. [ ] **Write back** — `INSERT INTO shared_knowledge` with your findings (batch into single INSERT when possible)
4. [ ] **Save deliverable** — Text/reports → Notion. Files → Drive (only if needed). Data → Supabase.

Check these boxes:
- [ ] You're reading `shared_knowledge` before starting work, not just assuming you know everything
- [ ] You batch multiple findings into single `INSERT` rather than one-per-finding (Credit Commandment #7)
- [ ] You skip republishing data that hasn't changed (Credit Commandment #4)
- [ ] You update rather than insert when data already exists

## Reporting & Communication

- [ ] You end tasks with **DONE** or **ESCALATED**, never silently abandoned (DARE protocol)
- [ ] When escalating, you provide full context: what you tried, why it failed
- [ ] You write one summary message to `shared_knowledge` per task, not one message per step (Commandment #1)
- [ ] You never ask users for information by email/chat — you search it yourself (Google, Apollo, Notion, etc.)

## Credit Discipline

- [ ] You're using standard intelligence for routine tasks (85% of your work)
- [ ] You upshift to Advanced/Expert only when task requires judgment or complexity
- [ ] You downshift immediately after complex work back to standard (no coasting at high intelligence)
- [ ] You skip unchanged data (don't republish last week's report if nothing changed)

## Domain Separation (Critical for Company/Personal boundary)

- [ ] When writing to `shared_knowledge`, you set `domain = 'company'` (if company work) or `domain = 'personal'` (if personal)
- [ ] When reading `shared_knowledge`, you filter by your domain first
- [ ] You understand the difference: Company data = exportable if Qualico is sold. Personal data = stays with Tim.

## Notion Organization

- [ ] Your agent briefing page (in "Ai Agent Briefings" database) is up to date with your current capabilities
- [ ] Any reports/analyses you create go to Notion (searchable, readable)
- [ ] You're linking from shared_knowledge to Notion pages when appropriate

## Supabase Health

- [ ] Your entries in `shared_knowledge` have accurate `agent_name` (matches your @tag)
- [ ] Your entries have `topic` (searchable key for grouping related knowledge)
- [ ] You're not creating duplicate entries — update existing if data changes
- [ ] Your `domain` is set correctly (company or personal)

## Special Protocols

**Email**: Never send directly. Always draft in Shortwave → give Tim the URL. (Email Drafting Protocol #1)

**Asana Tasks**: When you create tasks, notify **Asana & Inbox Operations Agent** with task ID + context.

**LinkedIn/Public Posts**: Always get Tim's approval (verification protocol). Never assume "go ahead".

**External Outreach**: Verify contact info before sending. Use enrichment tools (Apollo, etc.) — never guess emails.

## When You're Done

Write this to `shared_knowledge`:
```
INSERT INTO shared_knowledge (agent_name, topic, key, value, domain)
VALUES (
  '[your @tag]',
  'protocol-v3-audit-march-2026',
  'audit_complete',
  'Audited all [X] areas. [Brief summary: what passed, what was fixed]. All systems Protocol v3.0 ready.',
  '[your domain]'
)
```

**Due date**: Before Tim returns from lunch (expect audit reports flowing in during afternoon).

---

**Questions?** Check:
1. Protocol file: `/agent/home/protocol-agent-v3-supabase-native.md`
2. Shared Skills Library (Notion) for applicable protocols
3. Your agent briefing page (Notion)

Run this audit. Report back. Let's keep the system tight. 🔧
