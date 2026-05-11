# Execute Remaining Briefing Batches

Execute Supabase batches 2-20 to populate agent_briefings table with full briefing content.

## Instructions

You will receive the Supabase project ID and briefings file path.

1. **Read briefings from JSON**
   - Read `/agent/home/briefings_merged.json`
   - Extract all briefings

2. **For each batch (2 briefings per batch)**
   - Build INSERT...ON CONFLICT SQL statement
   - Include all fields: agent_name, department, category, status, connections, frequency, key_resources, trigger_info, version, content, notion_page_url
   - Truncate content to first 10000 chars to stay within SQL limits
   - Escape single quotes in all string fields

3. **Execute in Supabase**
   - Use conn_xmaq9bngsgw6e19jxcjn__execute_sql
   - Project ID: zlteahycfmpiaxdbnlvr
   - Execute batches 2-20 sequentially
   - Report success/failure for each batch

4. **Report results**
   - Total briefings processed
   - Any failures
   - Confirmation that content field is populated
