# QUALICO AI OS v3.0 — COMPLETE INFRASTRUCTURE OVERVIEW

**Last Updated**: March 9, 2026 | **Version**: 3.0 Supabase-Native

## FLEET COMPOSITION

- **Total Agents**: 31 (live & active)
  - **Company Domain**: 22 agents
  - **Personal Domain**: 9 agents
  - **Active Status**: 24 agents (77%)
  - **Stale/Inactive**: 7 agents

## DEPARTMENT STRUCTURE (8 Total)

1. **💰 Finance & Accounting** - Revenue tracking, invoicing, reconciliation
2. **⚖️ Legal & Compliance** - Contract management, compliance monitoring  
3. **⚙️ Operations** - Process automation, logistics coordination
4. **📣 Marketing & Sales** - Content, campaigns, lead generation
5. **👥 HR & People** - Recruiting, payroll, employee management
6. **🛒 eCommerce & Product** - Inventory, orders, product management
7. **🔧 IT & Infrastructure** - System monitoring, technical deployment
8. **👤 Personal** - User productivity, health, learning, finance

## ACTIVE CONNECTIONS (8 Total)

### 1. Notion (conn_1ykn33de2j69hkpfvg5r)
- **Workspaces**: Qualico HQ (company), Privé (personal)
- **Tools Activated**: 5/14 (search, fetch, create-pages, update-page, update-data-source)
- **Purpose**: Documentation hub, briefing database, shared skills library
- **Status**: ✅ LIVE — primary documentation layer

### 2. Asana (conn_2ezghgecvh0f8gtpj989)
- **Account**: tim@qualico.be
- **Tools Activated**: 3/44 (list-workspaces, search-tasks, get-projects-workspace)
- **Purpose**: Task tracking, project management, automation triggers
- **Status**: ✅ LIVE

### 3. Supabase (conn_xmaq9bngsgw6e19jxcjn) — **CRITICAL INFRASTRUCTURE**
- **Project**: zlteahycfmpiaxdbnlvr
- **Tools Activated**: 5/29 (list-projects, list-tables, execute-sql, apply-migration, get-project-url)
- **Purpose**: PRIMARY COORDINATION LAYER — shared knowledge, agent registry, skill deliveries
- **Database Tables**: 
  - `agents` (31 rows with department, domain, drive_folder_url)
  - `shared_knowledge` (cumulative knowledge entries with domain separation)
  - `shared_skills` (7 skills mirrored from Notion)
  - `agent_requests` (task queue, requests)
  - `skill_deliveries` (tracking which agents received which skills)
- **Daily Batch Sync**: 3am Brussels time
- **Domain Separation**: personal/company with RLS enabled
- **Status**: ✅ LIVE & MANDATORY for all agents

### 4. LinkedIn (conn_c85pncn9hd0r2zppxdvc)
- **Account**: tim (Qualico profile)
- **Tools Activated**: 1/19 (create-text-post-user)
- **Purpose**: Business visibility, company updates
- **Status**: ✅ LIVE

### 5. Google Drive — Company (conn_zhj70cc89xscszt6ktwj)
- **Account**: tim@qualico.be
- **Tools Activated**: 7/13 (list-drives, search, create-folder, spreadsheet ops, move, upload)
- **Root Folder**: 🤖 AI Agent Output (1fwkB9QMGnrGuUW3nMqbEX5OeWlWtUasi)
- **Structure**: 8 department folders + 29 agent subfolders
- **Usage**: ~5-8 company agents (CFO, Legal, Research for PDFs, Marketing for assets)
- **Status**: ✅ LIVE

### 6. Slack (conn_4syh5zxa3g8xm552sp6r)
- **Account**: tim@qualico.be (Qualico workspace)
- **Tools Activated**: 2/11 (list-channels, post-message)
- **Purpose**: Internal notifications, agent updates
- **Status**: ✅ LIVE (minimal use — no real-time routing in v3.0)

### 7. Shortwave (conn_60gywx06q9armya5206j)
- **Account**: tim@qualico.be
- **Tools Activated**: 1/10 (create-new-draft)
- **Purpose**: Email draft creation (DRAFT ONLY — never send directly)
- **Status**: ✅ LIVE — 3 Iron Rules enforced

### 8. Google Drive — Personal (conn_cp8t6gy5wwmb1m9y8ka1)
- **Account**: huybrechtstim@gmail.com
- **Tools Activated**: 2/13 (search-documents, create-folder)
- **Root Folder**: 🤖 AI Agent Output — Personal (1UYtp1crhzPqC-VPbzkNTmDM7Q9-EBKs4)
- **Structure**: 8 personal agent folders
- **Usage**: All 8 personal agents
- **Status**: ✅ LIVE — hard separation from company data

## ARCHITECTURE PHILOSOPHY — v3.0 (Supabase-Native)

### The Radical Simplification (March 8-9, 2026)

**What Was Killed**:
- Real-time hub routing system (500+ lines, constant bugs)
- Request retry engine (4h trigger, exponential backoff)
- Health scoring & circuit breakers
- Anti-loop guards and delivery tracking
- Fast-path subagent (40-55% traffic optimization)

**What Was Built**:
- Supabase as shared bulletin board
- Scheduled agent reads (15-30 min latency acceptable)
- Direct agent writes to shared_knowledge
- Simplified deliverables strategy

**Result**: 70-80% credit reduction (€1,000/week week 1 → ~€135-175/week target)

### How It Works (Simple Terms)

1. **Agent reads first** → `SELECT * FROM shared_knowledge WHERE topic = 'X'`
2. **Agent does work** → Executes its specialized task
3. **Agent writes back** → `INSERT findings` + save deliverable to appropriate location

### Deliverables Strategy (Simplified)

| Type | Where | Why |
|------|-------|-----|
| Text reports, analyses, summaries | **Notion** | Searchable, readable in workspace |
| Spreadsheets with formulas | **Google Sheets** | Calculations, formulas, live data |
| Files for external sharing | **Google Drive** | File format matters for recipients |
| Structured data/findings | **Supabase** | Queryable, fast, portable, shared |

## COST PROFILE — v3.0 TARGET

- **Weekly Budget**: ~€135-175 (down from €1,000 first week)
- **Credit Reduction**: 85%
- **Per-Agent Average**: ~€4-5/week
- **Cost Drivers**: 
  - Task complexity (standard vs expert intelligence)
  - Execution frequency (hourly vs weekly)
  - Tool call density (batch vs individual)

## KEY PROTOCOLS IN FORCE

### 1. The 7 Credit Commandments

1. **No Acknowledgment Theatre** — Broadcasts don't need replies unless action required
2. **Batch Your Knowledge** — One message per run with all findings, not one per finding
3. **Right-Size Intelligence** — Use standard for routine, expert only when actually needed
4. **Skip the Unchanged** — Don't republish data that hasn't changed
5. **Quota Reports: 1x Daily Max** — Update credit/quota status once per day, not per-run
6. **Minimal Payloads** — Send only what's needed, not everything you know
7. **Queue Don't Query** — Write to Supabase in batches

### 2. Intelligence Right-Sizing Protocol

- **Standard ($)** — Routine tasks with clear procedures
- **Advanced ($$)** — Moderate complexity requiring some reasoning
- **Expert ($$$)** — Complex judgment or creative problem-solving
- **Genius ($$$$)** — Only when truly necessary

**Rules**:
- Start low, shift up only when stuck
- Shift down immediately after complex work
- Each task gets its own assessment (conversation history is not valid reason to stay high)

### 3. DARE Task Accountability Protocol

When assigned a task:

- **D** — Do it: Try to complete the task
- **A** — Attempt alternatives: Try at least ONE other approach before giving up
- **R** — Report loudly: Use alert message type, match original priority
- **E** — Escalate to requester: Respond with full context of what was tried and why it failed

**Critical**: Silent "cannot execute" updates are protocol violations. Failed tasks must trigger user notification via alert type.

### 4. Email Drafting — 3 Iron Rules (DNA-Level)

1. **Never send emails directly** → Create DRAFT via Shortwave → give user the URL
2. **Never ask for email addresses** → Search Google/Apollo/LinkedIn yourself first
3. **Always provide draft URL** → "Draft klaar: [URL]" format

This must be baked into all agent DNA — agents should know this instinctively.

### 5. Domain Separation (Hard Architecture)

**Company Data**:
- Workspace: Qualico HQ (Notion)
- Drive: tim@qualico.be (Google Drive company account)
- Supabase: `WHERE domain = 'company'`

**Personal Data**:
- Workspace: Privé (Notion)
- Drive: huybrechtstim@gmail.com (personal Gmail)
- Supabase: `WHERE domain = 'personal'`

**Exit-Readiness**:
- If Qualico sold → `WHERE domain = 'company'` exports cleanly
- Personal Drive (huybrechtstim@gmail.com) stays with user
- Zero data mixing, GDPR compliant

## INFRASTRUCTURE PORTABILITY STATUS

- ✅ **Notion** — Portable (human-readable documentation, can export)
- ✅ **Supabase** — Portable (schema-based Postgres, can migrate)
- ✅ **Google Drive** — Portable (standard Google Workspace)
- ✅ **Shared Skills** — Mirrored in Supabase + Notion + local cache
- ✅ **Agent Briefings** — All 31 documented in Notion (v3.0 updated)
- ✅ **Protocols** — Documented in local files + Supabase
- ✅ **Exit-Ready** — Dataroom organized under 09 Tech & Systems

## DATAROOM ORGANIZATION (EXIT-READY)

**Location**: 09 🔧 Technology & Systems (Notion dataroom)

**Hub Page**: 🤖 AI Agent System
- Fleet overview (31 agents, 8 departments)
- Architecture v3.0 explanation
- Infrastructure stack documentation
- Supabase schema reference
- Domain separation details
- All 7 shared skills listed
- Google Drive structure (company + personal maps)
- Cost profile & portability notes
- Links to all key resources

**Child Pages**:
- Agent Briefings Database (31 agents with full documentation)
- Onboarding Briefing (v3.0 with personal Drive section)
- Shared Skills Library (7 skills, Supabase-native architecture)

## MONITORING & OPERATIONS

### UNLOCK Command Center v3.0 (4 Tabs)

1. **📊 Dashboard** — Fleet overview (agents, publishers, knowledge entries, health distribution, top publishers)
2. **🏥 Health** — Per-agent health scoring (green/yellow/red/grey), staleness detection
3. **📈 Activity** — Publishing activity as credit proxy (bar charts by agent or department)
4. **🏷️ Tags** — Agent directory grouped by department

**Additional Tabs** (new):
5. **🔌 Connections** — All 8 connections with tool activation status
6. **🏢 Organigram** — Agent tree by department with domain badges

### Operational Rhythms

- **Daily Batch Sync**: 3am Brussels time (queue → Supabase)
- **Weekly Audit**: Fridays 10am (credit efficiency, deliverables accuracy, domain integrity)
- **Real-Time Monitoring**: UNLOCK app (refresh button for live data)

### Health Scoring

- **🟢 Green** — Publishing within 48h + has Drive folder
- **🟡 Yellow** — Stale (>7 days no publish) OR missing Drive
- **🔴 Red** — Both stale AND missing Drive
- **⚫ Grey** — Never published anything

## PERFORMANCE BASELINE — March 9, 2026

- **Active Publishers**: 24/31 agents (77%)
- **Knowledge Entries**: 1,247+ cumulative
- **Skill Deliveries**: 156 completed
- **Stale Agents**: 7 (marked for audit)
- **Connection Uptime**: 8/8 active (100%)
- **Daily Cost**: ~€19-25 (target weekly: €135-175)

## SHARED SKILLS LIBRARY (7 Skills)

1. **hub-communication** — Inter-agent knowledge sharing via Supabase
2. **tim-personalization-context** — Qualico user context & preferences
3. **asana-task-routing** — Task creation & project management
4. **content-quality-standards** — Output quality assurance
5. **notion-operations** — Workspace documentation & updates
6. **email-drafting-protocol** — Draft creation (no direct sending)
7. **calendar-booking-protocol** — PA energy mapping & scheduling rules

**Status**: All 7 mirrored in Supabase + Notion + local cache. Broadcast complete to all agents.

## FUTURE ARCHITECTURE CONSIDERATIONS

- **v3.1**: Real-time option (webhook triggers) if latency becomes critical
- **v3.5**: AI-driven routing (optional hub lite if patterns emerge)
- **v4.0**: Multi-user coordination (if expanding beyond single operator)
- **Potential**: Platform migration (documented for ChatGPT Codex, other platforms)

---

**For Research Agent**: Use this overview for AI architecture research. All tooling, protocols, and integration points are documented above. Reference shared_knowledge table for specific implementation details.

**For Exit Planning**: This documentation is investor-ready. All infrastructure is portable, data is cleanly separated, and cost profile is transparent.
