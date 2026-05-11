# Migrate Agent Briefings to Supabase

Systematically fetch all agent briefing pages from Notion and populate Supabase with full detailed content.

## Instructions

1. **Query the Notion database**: Fetch all pages from the agent briefings database at collection://e35ec83b-91cb-4846-8ab2-5c06712cbf62

2. **For each agent page**:
   - Get the page ID and title (Agent Name)
   - Fetch the full page content using the Notion fetch tool
   - Extract the complete briefing text
   - Identify: category, status, connections, frequency, key_resources, version

3. **Populate Supabase**:
   - For each agent, INSERT or UPDATE the agent_briefings table
   - Fields: agent_name, content (full briefing), category, status, connections, frequency, key_resources, version, domain, last_updated
   - Domain: Check if agent name contains "Personal" → personal, else company

4. **Report progress**:
   - Log total agents processed
   - Note any missing or incomplete briefings
   - Report completion status

## Implementation

Start by querying all agent names from the Notion database, then fetch each one systematically.
