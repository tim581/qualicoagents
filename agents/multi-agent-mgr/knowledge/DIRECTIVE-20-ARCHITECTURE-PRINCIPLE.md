# Directive #20 - ARCHITECTURE PRINCIPLE: Agent Data → Supabase, Human Data → Notion

**Status**: ✅ LIVE (March 12, 2026, 19:55 GMT+1)  
**Total directives active**: 20

---

## The Principle

Everything is split by WHO consumes it:

### ✅ Agent-Processable Data → Supabase
(Agents query this directly via SQL)

- **agent_briefings** - Complete briefing documentation
- **directives** - Broadcast directives agents execute (17→20 now)
- **ai_agents_task_log & ai_agents_task_steps** - Task execution history
- **shared_knowledge** - Agent findings, bookmarks library (1,235 URLs)
- **agents** - Agent registry
- **shared_skills** - Reusable capabilities
- **airtable-requests-mirror** (new) - Agent requests synced from Airtable

### ✅ Human-Readable Data → Notion
(Tim reads this for context, reference, archival)

- 🤖 **Qualico AI Operating System** - Full system overview
- 📚 **Shared Skills Library** - Documentation of 9 skills
- 🚀 **New Agent Onboarding & Setup Guide** - Agent setup workflow
- 📡 **Active Broadcast Directives** - Reference copy of all directives (SOURCE = Supabase)
- Strategic guides and decision logs

---

## Why This Matters

| Factor | Supabase | Notion |
|--------|----------|--------|
| **Speed** | Direct query, instant | Page fetch + caching delays |
| **Machine readable** | Structured SQL | Parsed markdown |
| **Queryable** | Yes (SQL WHERE clauses) | No (full page read only) |
| **Human friendly** | Requires queries | Rich formatting, readable |
| **Ideal for agents** | ✅ Perfect | ❌ Slow, caching issues |
| **Ideal for humans** | ❌ Technical | ✅ Perfect |

---

## The Implementation

### Current State (March 12, 2026)
- ✅ Directives migrated to Supabase (Directive #17 March 11)
- ✅ Agent briefings migrated to Supabase (March 11)
- ✅ Task logging system created in Supabase (Directive #18 March 12)
- ✅ Agent requests moved to Airtable (Directive #19 March 12)
- ✅ Bookmarks library in Supabase (1,235 URLs, Directive #11)
- ✅ Notion serves as documentation/reference layer

### Going Forward
Every new system must ask:
1. **Who consumes this?** (agents or humans?)
2. **Where should it live?** (Supabase for agents, Notion for humans)
3. **Is it duplicated?** (Should not be)
4. **Can agents query it efficiently?** (If they need to)

---

## Examples: Right vs Wrong

### ✅ CORRECT
```
Directives:
  Supabase: directives table (agents query 3x/day)
  Notion: Archive copy for reference/history

Agent Briefings:
  Supabase: agent_briefings table (agents query programmatically)
  Notion: Individual pages for human documentation

Shared Knowledge:
  Supabase: shared_knowledge table with topics (agents search)
  Notion: Consolidated reference on core pages
```

### ❌ WRONG
```
Directives only in Notion:
  Problem: Agents fetch slow page 3x/day, caching delays, parsing complexity

Briefings scattered across multiple Notion pages:
  Problem: Agents cannot query programmatically, must fetch full pages

Data in multiple places simultaneously:
  Problem: Sync issues, confusion about source of truth, redundancy
```

---

## Impact on System Design

### Faster Agent Processing
- Supabase queries = instant results
- No page fetch overhead
- No Notion caching delays
- Structured data = easier parsing

### Cleaner Human Documentation
- Notion = strategic context
- Rich formatting = readable
- References to Supabase data where needed
- Portability preserved

### Single Source of Truth
- Operational data lives in one place
- Notion mirrors for reference
- No duplicates = no sync issues
- Easier to maintain

---

## What Changed in This Cycle

**Before (March 9-10)**:
- Directives in Notion (agents fetched pages)
- Briefings in Notion (agents couldn't query)
- Everything split across multiple locations

**After (March 11-12)**:
- Directives in Supabase (agents query directly)
- Briefings in Supabase (agents query directly)
- Requests in Airtable (visible to Tim, queryable if needed)
- Notion serves as documentation layer only

**Result**: Faster system, clearer architecture, better agent efficiency.

---

## For New Features

When building the next system:

1. **Ask first**: Agent-processable or human-readable?
2. **Put first**: Supabase (if agents) or Notion (if humans)
3. **Mirror second**: Copy essential info to the other system if needed
4. **Never duplicate**: One source of truth per data category
5. **Update both**: If changing operational data, also update reference

---

## Files & References

- **Supabase connection**: `conn_xmaq9bngsgw6e19jxcjn`
- **Notion connection**: `conn_1ykn33de2j69hkpfvg5r`
- **Shared knowledge entry**: Topic = `architecture-agent-vs-human-data`
- **Broadcast page**: 📡 Active Broadcast Directives (updated March 12)
- **Onboarding page**: 🚀 New Agent Onboarding & Setup Guide (updated March 12)

---

**Last updated**: March 12, 2026, 19:55 GMT+1  
**Created by**: Multi Agent Mgr  
**Status**: FOUNDATIONAL PRINCIPLE - applies to all future architecture
