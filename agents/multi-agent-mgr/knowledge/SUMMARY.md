# Multi Agent Mgr — Lean Summary

## Role
Top-level orchestrator for 37+ Tasklet agents. Chief of Staff: system health, inter-agent communication, browser automation infrastructure, credit optimization.

## Critical Rules
1. **Basic ($) intelligence default** — only go higher with Tim's permission, reset immediately after
2. **Network-first design** — every feature must be discoverable by other agents via Supabase
3. **Credit target: ~$135-175/week** — question app complexity, no acknowledgment theatre, batch knowledge
4. **Supabase table names are PascalCase** — ALWAYS double-quote in SQL (`"Shared_Knowledge"`)
5. **Browser_Tasks.actions is NOT NULL** — pass `'[]'::jsonb` for script-based tasks
6. **ONE executor at a time** across Tim's 2 PCs
7. **GitHub = source of truth, Supabase = agent discovery, Notion = human view**
8. **Never invent data** — query authoritative source first
9. **Sellerboard: AMZ CA account = EMPTY** — Amazon.ca data lives under AMZ USA
10. **Flieber: ALWAYS consult uploaded PDFs before changing scripts**

## Connections
- `conn_xmaq9bngsgw6e19jxcjn`: Supabase (project: `zlteahycfmpiaxdbnlvr`)
- `conn_rf4te6wqncg18hn7dn13`: GitHub (`tim581/qualicoagents` + `qualico-platform`)
- `conn_1ykn33de2j69hkpfvg5r`: Notion (skill file required)
- `conn_zhj70cc89xscszt6ktwj`: Google Drive (company)
- `conn_cp8t6gy5wwmb1m9y8ka1`: Google Drive (personal)
- `conn_rqbhxnbt4b242v34h9hh`: Gmail (skill file required)
- `conn_4syh5zxa3g8xm552sp6r`: Slack
- `conn_2ezghgecvh0f8gtpj989`: Asana
- `conn_jr26b33r1azf9ys1nh4p`: Airtable (Agent Requests: base `appW71PeNcSqB2CpL`)
- `conn_c85pncn9hd0r2zppxdvc`: LinkedIn
- `conn_60gywx06q9armya5206j`: Shortwave (skill file required)
- `conn_kd02nc5yrb4xv2w8vd7z`: Vercel

## Subagents
- `/agent/subagents/post-browser-task.md` — agents post browser automation tasks
- `/agent/subagents/submit-audit-response.md` — agent audit self-submission
- `/agent/subagents/network-listener.md` — directive fetching (deprecated)
- `/agent/subagents/playwright-browser.md` — browser rendering
- `/agent/subagents/request-page-render.md` — page render requests

## Key Files
- `/agent/home/CFO-SELLERBOARD-SCRAPING-PROMPT.md` — paste into CFO agent for Sellerboard onboarding
- `/agent/home/AGENT-AUDIT-PROMPT.md` — paste into agents for audit

## Runtime Queries (don't memorize — query when needed)
- Scripts & versions: `github_get_file_content` → `tim581/qualicoagents/scripts/`
- Architecture docs: `github_get_file_content` → `tim581/qualicoagents/docs/`
- Browser task types: `SELECT * FROM "Browser_Task_Registry"`
- Credentials: `SELECT * FROM "Browser_Credentials"`
- Agent audit status: `SELECT * FROM "Agent_Audit_Status"`
- Sellerboard data: `SELECT * FROM "Sellerboard_Exports"`
- Lessons learned: `SELECT * FROM "Shared_Knowledge" WHERE agent_name='Multi Agent Mgr'`
- Directives: `SELECT * FROM "Ai_Agent_Directives"`
- Drive CFO folder: `1_MxSUeXGE1bsJo7-cABJ3FUMFyJEHRXd`

## Current Focus
- ✅ Sellerboard scraping COMPLETE (all 3 phases — 42 CSVs, all in Supabase)
- 🟠 Re-test Corax/Mintsoft/Forceget with executor v3.3
- 🟠 Agent audit: 15/43 submitted, 28 pending
- 🟡 Vercel platform: BrowserTaskButton PR pending
