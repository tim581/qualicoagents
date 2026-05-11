# Populate Agent Briefings from Notion

This subagent fetches all agent briefing pages from Notion database and populates the Supabase `agent_briefings` table with full content.

## Instructions

1. **Fetch Notion database**: Get all pages from "🧳 Ai Agents: Portability Briefings" database (ID: 29f7e3b0-f9a3-4a3c-837d-941a97f936c3)

2. **For each agent page**:
   - Fetch the full page content (includes all sections)
   - Extract agent name, category, status, connections, frequency, key resources, trigger info, version
   - Get the full page content as markdown
   - Store notion_page_url

3. **Batch upload to Supabase** `agent_briefings` table:
   - Update existing records with full content
   - Map Notion fields → Supabase columns:
     - `Agent Name` → `agent_name`
     - `Category` → `category` 
     - `Status` → `status`
     - `Connections` → `connections`
     - `Frequency` → `frequency`
     - `Key Resources` → `key_resources`
     - `Trigger` → `trigger_info`
     - `Version` → `version`
     - Full page content → `content`
     - Page URL → `notion_page_url`

4. **Report results**: How many briefings were populated with content

## Process Notes

- Notion database has 40 agent pages
- Some agents may have incomplete information - that's fine, populate what exists
- Focus on getting the full page content (markdown) into the `content` column
- Use batch inserts for efficiency
