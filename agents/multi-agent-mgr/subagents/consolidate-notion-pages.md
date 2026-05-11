# Consolidate Notion AI Documentation Pages

## Purpose
Merge overlapping Notion pages into clean single sources of truth.

## Instructions

You must read `/agent/skills/connections/conn_1ykn33de2j69hkpfvg5r/SKILL.md` before using Notion tools.

### TASK 1: Consolidate Architecture Pages → "🤖 Qualico AI Operating System"

**Three overlapping pages exist:**
1. `31cb08937ab7815f9e4de88ecd81f39b` — "🤖 AI Agent System — Qualico Multi-Agent Network" (most complete)
2. `31bb08937ab781d4b3dee5494a596c1f` — "AI Stack Architecture — Qualico's Competitive Edge"
3. `31fb08937ab781cbaf74f084564eba9b` — "📊 Data Architecture & Storage — Where Everything Lives"

**Action:**
1. First, fetch all 3 pages to read their content
2. Create a NEW consolidated page under parent `314b08937ab7819d917ef9c8b4ed3d3d` (09 Tech & Systems) with title: "🤖 Qualico AI Operating System"
3. The content should merge ALL unique content from all 3 pages into clear sections:
   - **Fleet Overview** (from AI Agent System): 38 agents, 8 departments, domain separation
   - **Architecture v3.1** (from AI Agent System + Data Architecture): Supabase-native, Notion for docs, Drive for files  
   - **Infrastructure Stack** (from AI Agent System): Tasklet, Supabase, Notion, Drive, Asana, Shortwave
   - **Data Architecture** (from Data Architecture page): Where everything lives and WHY, decision tree, tables schema
   - **AI Stack Competitive Edge** (from AI Stack Architecture): Why this matters for exit, Gartner stats, buyer value
   - **Domain Separation** (from AI Agent System): Personal vs Company hard split
   - **Communication Protocols** (from AI Agent System): Network Listener, directives (Notion), requests (Supabase)
   - **Shared Skills** (from AI Agent System): 8 skills, triple-storage
   - **Credit Optimization** (from AI Agent System): 7 commandments, $1k→$175/week
   - **Key Resources**: Links to Agent Briefings DB, Onboarding Guide, Skills Library, Broadcast Directives, Shared Drive
4. Make it comprehensive, dataroom-ready, clean
5. Add footer: "Version: 3.1 | Last updated: March 10, 2026 | Maintained by: 🤖 Multi Agent Mgr"
6. Add link to Agent Briefings database: `https://www.notion.so/29f7e3b0f9a34a3c837d941a97f936c3`
7. Add link to Shared Skills Library: `https://www.notion.so/31bb08937ab78163abf4c159de56b601`
8. Add link to Broadcast Directives: `https://www.notion.so/31eb08937ab78127a3aee9e24003afb8`

**IMPORTANT**: Do NOT delete the old pages yet. Just create the new consolidated one.

### TASK 2: Delete Duplicate Onboarding Page

Two overlapping onboarding pages exist:
1. `319b08937ab781e5a4cad5d8c8180c1c` — "🚀 Agent Onboarding Briefing" (ALREADY UPDATED to v3.1 with all directives)
2. `31fb08937ab781ecb51ee62441f555cc` — "🚀 New Agent Setup & Integration Guide" (newer but duplicate)

**Action:**
1. Fetch page `31fb08937ab781ecb51ee62441f555cc` to read its content
2. Check if it has anything NOT already in the Onboarding Briefing
3. If the Onboarding Briefing (319b...) is already comprehensive with all directives, then the New Agent Setup page is redundant
4. Rename the Onboarding Briefing to: "🚀 New Agent Onboarding & Setup Guide (v3.1)"  
5. Report which page to keep and which is duplicate

### Output
Report back:
- Consolidated page URL
- Which pages are now redundant (can be archived later)
- Any content that was unique to one page that you made sure to include
