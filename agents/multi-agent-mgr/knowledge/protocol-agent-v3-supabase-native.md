# Agent Protocol v3.0 — Supabase Native
**Effective**: March 2026 | Replaces all hub-routing protocols

## The Hub Is Gone. Here's What Replaces It.

Inter-agent communication via webhooks is retired. All shared knowledge lives in Supabase. No routing. No retries. No loops.

## Where Do Deliverables Go?

| Deliverable type | Where | Why |
|---|---|---|
| Structured data & findings | **Supabase `shared_knowledge`** | Queryable, fast, other agents read it |
| Text reports, analyses, summaries | **Notion** (under your agent briefing or workspace) | Searchable, readable, organized |
| Spreadsheets with formulas | **Google Sheets** in Drive | File format matters |
| PDFs/docs for external sharing | **Google Drive** | Clients/partners need file downloads |

**Rule of thumb**: If it's TEXT → Notion. If it's a FILE FORMAT that matters → Drive. If it's DATA → Supabase.

Most agents will use Supabase + Notion only. Google Drive is only needed when the file format matters (spreadsheets, PDFs for external parties, media assets).

---

## Every Agent: 3 Steps Per Run

### Step 1 — READ (before you work)
Query Supabase `shared_knowledge` for anything relevant to your domain:
```sql
SELECT topic, value, source_agent, updated_at 
FROM shared_knowledge 
WHERE topic IN ('your_relevant_topics')
ORDER BY updated_at DESC LIMIT 20
```
Check if your question was already answered. If yes — use it. Don't request it again.

### Step 2 — DO YOUR WORK
Use what you found. Do your analysis, monitoring, or task.

### Step 3 — WRITE BACK
**Findings → Supabase:**
```sql
INSERT INTO shared_knowledge (topic, value, source_agent, domain, updated_at)
VALUES ('topic', 'finding', 'your_agent_name', 'company|personal', NOW())
ON CONFLICT (topic) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
```

**Deliverables → Right Place for the Type:**
- **Text reports/analyses** → Save as Notion page in your workspace section
- **Spreadsheets/PDFs/files** → Save to Google Drive: `🤖 AI Agent Output / [Department] / [Your Agent Name] /`
- **Most agents**: Supabase + Notion is enough. Only use Drive if file format matters.

**Questions for Tim → Supabase:**
```sql
INSERT INTO agent_requests (from_agent, to_agent, topic, question, status, created_at)
VALUES ('your_agent', 'Tim', 'topic', 'your specific question', 'pending', NOW())
```
Tim sees these in the UNLOCK app. No webhook needed.

---

## What's Gone (Do NOT Use)

- ❌ Hub webhook — retired
- ❌ Sending messages to other agents via HTTP/webhook
- ❌ Requesting hub to route messages
- ❌ Heartbeat pings
- ❌ Health check responses
- ❌ Broadcast acknowledgements
- ❌ `reply_webhook` field — no longer needed
- ❌ `to_agent` routing — use Supabase reads instead

---

## Agent-to-Agent Communication

**Old way**: Agent A → HTTP POST → Hub → HTTP POST → Agent B → waits for trigger

**New way**: Agent A writes finding to `shared_knowledge` → Agent B reads it on next scheduled run

No credits burned on routing. No failed deliveries. No loops. No retries needed.

If you need Agent B to do something specific — write a row to `agent_requests` with `to_agent = 'agent_b_name'`. Agent B checks this table at start of every run.

---

## Supabase Connection

- **Connection ID**: conn_xmaq9bngsgw6e19jxcjn
- **Project ID**: zlteahycfmpiaxdbnlvr
- **Key tables**: `shared_knowledge`, `agent_requests`, `agents`

---

## Google Drive Structure

```
🤖 AI Agent Output/
├── 💰 Finance & Accounting/
│   ├── Qualico Financial Agent/
│   ├── Qualico Investor & Finance Agent/
│   ├── COGS & Financial Planning Agent/
│   ├── Finance & Loans Agent/
│   ├── M&A Outreach Agent/
│   └── Email Assistant/
├── ⚖️ Legal & Compliance/
│   ├── IP Manager & Dataroom Agent/
│   └── Insurance Manager/
├── ⚙️ Operations/
│   ├── Multi Agent Mgr/
│   ├── Road Transport & Logistics Monitor/
│   ├── Inventory Tracking Agent/
│   ├── Asana & Inbox Operations Agent/
│   └── Overhead Manager/
├── 📣 Marketing & Sales/
│   ├── Qualico Brand Agent/
│   ├── Puzzlup Brand Agent/
│   └── Puzzlup Content Automation/
├── 🛒 eCommerce & Product/
│   ├── Bauwee Brand Manager/
│   └── Puzzlup Price & Buy Box Monitor/
├── 🔧 IT & Infrastructure/
│   ├── Research Agent/
│   └── Browser Agent/
└── 👤 Personal/
    ├── Personal Assistant (Tim)/
    ├── Personal Finance & Investment Agent/
    ├── Health & Bloodwork Dashboard Agent/
    ├── Learning Hub/
    ├── Personal Knowledge Agent/
    ├── Personal Mail Auto-Labeler/
    ├── Personal Drive Organizer/
    ├── Postal Document Processor/
    └── Arbeidsongeschiktheid Agent/
```

---

## Credit Rules (Still Apply)

- Standard intelligence for routine tasks
- Expert only for complex judgment
- Never genius unless truly necessary
- Batch your writes — one INSERT with all findings, not one per finding
