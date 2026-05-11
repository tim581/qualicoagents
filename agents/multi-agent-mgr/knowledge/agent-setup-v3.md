# Agent Protocol v3.0 — Setup Instructions

Paste this into every agent's chat:

---

## ⚠️ CRITICAL SYSTEM UPDATE — Protocol v3.0 (March 2026)

The hub is dead. No more webhooks. No more inter-agent messaging. Supabase is now the shared brain.

### YOUR WORKFLOW (every run):

**1. READ** — Before starting any work:
```sql
SELECT topic, key, value FROM shared_knowledge WHERE topic RELEVANT TO YOUR TASK;
```

**2. DO** — Complete your work.

**3. WRITE BACK** — Publish your findings:
```sql
INSERT INTO shared_knowledge (agent_name, topic, key, value, domain, updated_at)
VALUES ('YOUR_AGENT_NAME', 'topic', 'key', 'your findings', 'company', NOW());
```

### ⚠️ PERSONAL vs COMPANY — HARD SEPARATION (CRITICAL)

Everything you do belongs to either `personal` or `company` domain. This MUST be tagged correctly everywhere — it enables clean data export if the company is ever sold.

**Which domain are you?**
- 💰 Finance & Accounting → `company`
- ⚖️ Legal & Compliance → `company`
- ⚙️ Operations → `company`
- 📣 Marketing & Sales → `company`
- 🛒 eCommerce & Product → `company`
- 🔧 IT & Infrastructure → `company`
- 👥 HR & People → `company`
- 👤 Personal → `personal`

**If unsure**: If the data/work relates to Qualico, Puzzlup, or Bauwee → `company`. If it relates to Tim's personal life → `personal`.

### WHERE TO SAVE DELIVERABLES:

| Type | Company agents | Personal agents |
|---|---|---|
| **Text** (reports, analyses) | **Notion** → Qualico HQ workspace | **Notion** → Privé workspace |
| **Files** (PDFs, spreadsheets) | **Google Drive** → tim@qualico.be | **Google Drive** → huybrechtstim@gmail.com |
| **Data** (facts, numbers) | **Supabase** → `domain = 'company'` | **Supabase** → `domain = 'personal'` |

**COMPANY Google Drive structure** (tim@qualico.be):
```
🤖 AI Agent Output/
├── 💰 Finance & Accounting/
├── ⚖️ Legal & Compliance/
├── ⚙️ Operations/
├── 📣 Marketing & Sales/
├── 🛒 eCommerce & Product/
├── 🔧 IT & Infrastructure/
```
Root folder: https://drive.google.com/drive/folders/1fwkB9QMGnrGuUW3nMqbEX5OeWlWtUasi

**PERSONAL Google Drive** (huybrechtstim@gmail.com):
```
🤖 AI Agent Output — Personal/
├── 👤 Personal Assistant/
├── 💰 Personal Finance/
├── 🏥 Health/
├── 📚 Learning/
├── 🧠 Knowledge/
├── 📬 Mail Labeler/
├── 📮 Postal/
├── 🛡️ Disability Insurance/
```
Root folder: https://drive.google.com/drive/folders/1UYtp1crhzPqC-VPbzkNTmDM7Q9-EBKs4

→ Find YOUR department folder → YOUR agent folder is inside it → Save files there.
→ If your folder doesn't exist, create it inside your department folder.

**Supabase writes — ALWAYS include domain:**
```sql
INSERT INTO shared_knowledge (agent_name, topic, key, value, domain, updated_at)
VALUES ('YOUR_NAME', 'topic', 'key', 'value', 'company', NOW());  -- or 'personal'
```

### REQUIRED CONNECTIONS:

1. **Supabase** (MANDATORY) — Project ID: `zlteahycfmpiaxdbnlvr`
   - Activate: `execute_sql` and `list_tables`
   - This is the shared brain. Without it you're offline.

2. **Notion** — You likely already have this.
   - **Company agents** → Qualico HQ workspace
   - **Personal agents** → Privé workspace
   - For text deliverables + reading protocols.

3. **Google Drive** — Only if you produce files (PDFs, spreadsheets, exports).
   - **Company agents** → Connect to: tim@qualico.be
   - **Personal agents** → Connect to: huybrechtstim@gmail.com
   - Not needed if you only produce text/data.

### SUPABASE TABLES:

| Table | Purpose | You do |
|---|---|---|
| `shared_knowledge` | Shared brain — all agent findings | READ + WRITE |
| `shared_skills` | Reusable protocols | READ only |
| `agents` | Agent directory | READ only |
| `agent_requests` | Questions for Tim | WRITE if you need Tim's input |

### CREDIT RULES (non-negotiable):

- Start at **standard** intelligence, shift up ONLY when stuck
- Shift back down **immediately** after complex work
- No acknowledgment messages — just read, work, write
- Batch findings into **one write per run**
- Skip unchanged data — don't republish what hasn't changed

### TASK ACCOUNTABILITY (DARE):

Every task must end in **DONE** or **ESCALATED** — never silently abandoned.
- **D**o it → **A**ttempt alternatives → **R**eport loudly → **E**scalate with full context

### FULL PROTOCOL:

Query Supabase for the complete protocol:
```sql
SELECT value FROM shared_knowledge WHERE topic = 'protocol_v3_supabase_native';
```
Or read Notion: "Agent Onboarding Briefing v3.0"
