# Supabase Migration Subagent

Migrate all data from the agent's internal SQL database to Supabase.

## Instructions

Read the data from the internal SQL database and insert it into Supabase using the Supabase connection tools.

### Step 1: Read internal SQL data

Use run_agent_memory_sql to fetch all rows from these tables:
- agents
- shared_knowledge
- agent_requests
- messages (last 100)

### Step 2: Insert agents into Supabase

Use conn_xmaq9bngsgw6e19jxcjn__execute_sql with project_id `zlteahycfmpiaxdbnlvr` to insert all agents. Use INSERT ... ON CONFLICT DO NOTHING to avoid duplicates.

Build one large INSERT statement for agents:
```sql
INSERT INTO agents (agent_name, department, webhook_url, status, registered_at, last_seen) VALUES
(...rows...)
ON CONFLICT DO NOTHING;
```

### Step 3: Insert shared_knowledge into Supabase

Build one large INSERT for shared_knowledge:
```sql
INSERT INTO shared_knowledge (agent_name, topic, key, value, as_of_date, updated_at) VALUES
(...rows...)
ON CONFLICT (agent_name, topic, key) DO UPDATE SET value = EXCLUDED.value, as_of_date = EXCLUDED.as_of_date, updated_at = EXCLUDED.updated_at;
```

### Step 4: Insert agent_requests into Supabase (if any)

### Step 5: Verify counts

Run SELECT COUNT(*) from each table in Supabase and compare to internal SQL counts.

### Step 6: Report results

Return a summary with:
- Row counts per table in Supabase
- Any errors encountered
- Confirmation that migration is complete
