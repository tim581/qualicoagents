# Execute Briefing Updates in Supabase

This subagent executes the SQL update statements to populate the agent_briefings table with full Notion content.

## Instructions

You will receive a list of agent briefing information in JSON format (or will read from /agent/home/briefings_merged.json).

For each briefing:
1. **Prepare an UPDATE statement** with:
   - agent_name
   - category
   - status
   - connections
   - frequency
   - key_resources
   - trigger_info
   - version
   - content (full markdown from Notion)
   - notion_page_url

2. **Execute in Supabase** using conn_xmaq9bngsgw6e19jxcjn__execute_sql:
   - Project ID: zlteahycfmpiaxdbnlvr
   - Table: agent_briefings
   - Operation: UPDATE with WHERE agent_name = ...

3. **Batch execution** - execute 2-3 statements at a time to avoid query size limits

4. **Report results**:
   - Total records updated
   - Any failures
   - Confirmation that content field is populated

## Process

Process briefings in batches of 2 updates per execute_sql call to stay within query size limits.
