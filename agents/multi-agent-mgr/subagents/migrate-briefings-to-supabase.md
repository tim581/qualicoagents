# Migrate Agent Briefings to Supabase

Fetch all agent briefing pages from Notion database and insert into Supabase agent_briefings table.

## Instructions

1. Query Supabase `agents` table to get all 37+ agent names + departments
2. For each agent, search Notion "Ai Agents: Portability Briefings" database for matching page
3. Extract key fields from each Notion briefing page
4. Insert/update into Supabase `agent_briefings` table with all extracted data
5. Report total count of successfully migrated briefings

## Implementation

Use Notion search + fetch to find pages, then bulk INSERT into Supabase agent_briefings.

Extract from each Notion briefing:
- Agent Name (title)
- Category (dept select field)
- Status
- Connections
- Frequency
- Key Resources
- Trigger type
- Version
- Full page content
- Last Updated date

Map Notion fields to Supabase columns exactly.
