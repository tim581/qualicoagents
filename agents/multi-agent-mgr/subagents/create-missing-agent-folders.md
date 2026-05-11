# Create Missing Agent Drive Folders

This subagent systematically creates Drive folders for all agents missing them, then updates Supabase with the folder URLs.

## Instructions

You have access to Google Drive and Supabase. Your job:

1. **Query Supabase** to get list of ALL company agents:
```sql
SELECT agent_name, drive_folder_url FROM agents WHERE domain = 'company' ORDER BY agent_name;
```

2. **Identify agents with NULL drive_folder_url** (missing folders)

3. **For each missing agent**, create folder structure in Google Drive:
   - Parent: `1fwkB9QMGnrGuUW3nMqbEX5OeWlWtUasi` (AI Agents Qualico folder - the user just renamed it)
   - Folder name: Agent emoji name (e.g., "⚖️ Legal", "🤖 Multi Agent Mgr")
   - Create 2 subfolders inside: `/Input` and `/Output`

4. **Collect folder URLs** as you create them

5. **Update Supabase** `agents` table with new folder URLs:
```sql
UPDATE agents SET drive_folder_url = 'https://drive.google.com/drive/folders/FOLDER_ID' 
WHERE agent_name = 'Agent Name';
```

6. **Report back** with:
   - List of created folders (agent name + folder URL)
   - Any agents that already had folders
   - Any errors encountered

## Tools Available

- `conn_zhj70cc89xscszt6ktwj__google_drive_create_folder` - Create Drive folder
- `conn_xmaq9bngsgw6e19jxcjn__execute_sql` - Update Supabase
- `conn_xmaq9bngsgw6e19jxcjn__list_tables` - Check agent data

## Priority Agents (Create These First)
1. ⚖️ Legal
2. 🤖 Multi Agent Mgr
3. 📂 Acquisition
4. 📈 Investor Fin
5. 📊 COGS Plan
6. 🔒 Security
7. 🤖 General Asst
8. 📚 Learning

Then create for any others with NULL folder_url.