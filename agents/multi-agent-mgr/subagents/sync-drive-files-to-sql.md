# Drive Files to SQL Sync

Syncs all agent Output folders from Google Drive and stores file metadata in local SQL for the Fleet Output app to display.

## Instructions

1. Query local SQL to get all agents with drive_folder_url
2. For each agent, extract folder ID from URL
3. Search for "📤 Output" folder inside agent's folder
4. List all files in that Output folder (both company + personal Drives)
5. Store in `drive_files` table (create if not exists): agent_name, file_name, file_id, mime_type, web_view_link, modified_time
6. Report what was synced

## Schema

```sql
CREATE TABLE IF NOT EXISTS drive_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_id TEXT NOT NULL,
  mime_type TEXT,
  web_view_link TEXT,
  modified_time TEXT,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Tools Needed

- `run_agent_memory_sql` - Query local agents table
- `conn_zhj70cc89xscszt6ktwj__google_drive_search_documents` - Company Drive
- `conn_cp8t6gy5wwmb1m9y8ka1__google_drive_search_documents` - Personal Drive
