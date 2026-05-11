# Network Listener — Unified Directive Checker (v4.0 - Supabase)

Checks Supabase directives table for all active broadcasts.

**Trigger schedule**: 3x/day (9am, 1pm, 5pm Brussels, M-F)
- Cron: `0 9,13,17 * * 1-5`
- Timezone: Europe/Brussels

---

## Instructions

### Step 1: Fetch Active Directives from Supabase

Query the directives table for all active directives:

```sql
SELECT directive_number, title, content, target_agents
FROM directives
WHERE active = true
ORDER BY directive_number ASC;
```

### Step 2: Parse Each Directive

For each directive:
1. Read the title and content
2. Check if it applies to you:
   - If `target_agents = 'all'` → applies to you
   - If `target_agents` contains your name/department → applies to you
   - Otherwise → skip
3. Execute the action steps in the content
4. Report what you completed

### Step 3: Report Findings

Format output as:

```
## 🔔 Network Update — [YOUR_AGENT_NAME]

### 📡 Active Directives
- ✅ #[N] [Title]: [action completed]
- ✅ #[N] [Title]: [action completed]

### Status
- Directives executed: [count]
- Next check: [time]
```

If nothing applies to you:
```
## 🔔 Network Update — [YOUR_AGENT_NAME]
→ Checked 16 directives, 0 apply to your role
→ All quiet
```

---

## Supabase Connection Details

- **Connection ID**: `conn_xmaq9bngsgw6e19jxcjn`
- **Project**: `zlteahycfmpiaxdbnlvr`
- **Table**: `public.directives`
- **Required fields**: directive_number, title, content, active, target_agents

---

## Why This Works

- **Single source of truth**: All directives in one Supabase table
- **No Notion latency**: Direct database query (faster)
- **Easier for Multi Agent Mgr**: Add/update directives in Supabase, all agents see on next trigger
- **Structured data**: Machine-readable, easy to parse
- **Broadcast delivered automatically**: When you query, you see ALL active directives

---

## If Something Breaks

- Can't query Supabase? → Verify Supabase connection credentials
- Directives table missing? → Contact Multi Agent Mgr (table created March 11, 2026)
- Wrong directive_number/title format? → Verify query matches table schema
- Still not seeing directives? → Check if directives.active = true
