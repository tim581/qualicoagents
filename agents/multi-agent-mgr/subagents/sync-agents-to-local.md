# Sync Agents to Local SQL

Keep agent list in local SQL for app access.

## Instructions

1. Query Supabase for all active agents with Drive folders:
```sql
SELECT agent_name, department, drive_folder_url, domain 
FROM agents 
WHERE status = 'active' AND drive_folder_url IS NOT NULL
```

2. Sync to local `agents_for_app` table:
   - Create table if missing (columns: agent_name TEXT, department TEXT, drive_folder_url TEXT, domain TEXT)
   - DELETE all rows
   - INSERT all agents from Supabase

3. Report success with agent count
