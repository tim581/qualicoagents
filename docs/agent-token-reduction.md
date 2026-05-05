# Agent Token Reduction Guide

## The Problem
Conversation summaries grow unbounded. Every detail gets preserved. Credits burn on context that could be queried at runtime.

## The Rule
**Remove EVERYTHING that can be queried from Supabase, GitHub, or Notion at runtime.**

## Keep (max ~500 words total)
1. **Connection IDs** — can't be queried
2. **Active trigger list** — reference only
3. **Subagent paths** — `/agent/subagents/*.md`
4. **Max 10 critical rules** — things that cause errors if forgotten
5. **Current focus** — what you're working on RIGHT NOW

## Remove
- ❌ Table schemas (query `list_tables` at runtime)
- ❌ Supabase data snapshots (query at runtime)
- ❌ Script version history (check GitHub at runtime)
- ❌ Full API documentation (read from GitHub docs/)
- ❌ Completed work history (it's done — let it go)
- ❌ Detailed error history / lessons learned (move to `Shared_Knowledge`)
- ❌ Step-by-step instructions for tools (read from skill files)
- ❌ Drive folder IDs (query Drive at runtime or store in Supabase)
- ❌ Notion page IDs (search Notion at runtime)
- ❌ Full credential details (query `Browser_Credentials` at runtime)
- ❌ PowerShell commands for Tim (store in GitHub docs/)

## Where to Put Removed Knowledge
| What | Where |
|------|-------|
| Lessons learned | `Shared_Knowledge` Supabase table |
| Script docs | GitHub `docs/` or `scripts/` comments |
| Architecture decisions | GitHub `docs/` |
| Credentials/config | Supabase tables |
| Human instructions | Notion pages |

## Template for Lean Summary
```
# [Agent Name] — Lean Summary

## Role
[1 sentence]

## Critical Rules (max 10)
1. ...

## Connections
- conn_xxx: [service] — tools: [list]

## Subagents
- /agent/subagents/xxx.md — [purpose]

## Current Focus
- [what you're doing now]

## Key References (query at runtime)
- Supabase project: zlteahycfmpiaxdbnlvr
- GitHub: tim581/qualicoagents
- For [topic]: query Shared_Knowledge WHERE topic='[x]'
- For [scripts]: check GitHub scripts/ folder
```

## Credit Impact
A 5000-word summary costs ~$0.05 per message just to READ. At 50 messages/day = $2.50/day = $17.50/week JUST for context.
A 500-word summary = $0.25/week. **That's a 98% reduction.**
