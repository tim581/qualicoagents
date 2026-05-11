# Expand Agent Drive Folders — Add Input/Output Structure

Systematically create Input/ and Output/ subfolders for each agent's Google Drive folder.

## Instructions

### Step 1: Get all agent folder IDs

Execute this SQL query against Supabase:
```sql
SELECT agent_name, drive_folder_url FROM agents 
WHERE drive_folder_url IS NOT NULL AND drive_folder_url != '' 
ORDER BY agent_name;
```

### Step 2: Parse folder IDs and determine Drive connection

For each row, extract folder ID from URL format: `https://drive.google.com/drive/folders/{FOLDER_ID}`

Determine which Google Drive connection to use:
- **Company agents** (Finance, Legal, Operations, Marketing, HR, eCommerce, IT) → Use `conn_zhj70cc89xscszt6ktwj` (tim@qualico.be Drive)
- **Personal agents** (Personal, Health, Learning, Knowledge, Mail Labeler, Postal, Disability Insurance, Personal Finance, Personal Assistant, Coach) → Use `conn_cp8t6gy5wwmb1m9y8ka1` (huybrechtstim@gmail.com Drive)

### Step 3: For each agent folder, create two subfolders

Using the appropriate Drive connection:

**Create Input folder:**
```
conn_{DRIVE_CONNECTION}__google_drive_create_folder
  title: "📥 Input"
  parentFolderId: "{AGENT_FOLDER_ID}"
```

**Create Output folder:**
```
conn_{DRIVE_CONNECTION}__google_drive_create_folder
  title: "📤 Output"
  parentFolderId: "{AGENT_FOLDER_ID}"
```

Batch these calls — create all Input folders first (group by connection), then all Output folders.

### Step 4: Handle errors gracefully

If a folder already exists (409 error), skip it — that agent already has the structure.

If a folder creation fails for other reasons, log it and continue with next agent.

### Step 5: Report results

```
📂 Drive Folder Structure Expansion Complete:
- Input folders created: X
- Output folders created: X
- Skipped (already exist): X
- Errors encountered: X (list agent names)

Status: Ready for broadcast to agents
```

### Step 6: Note for Tim

After completion, send this to Multi Agent Mgr's task list:
- All 30 agents now have Input/Output folder structure
- Ready to broadcast updated briefing to agents
- Agents can start using Input folders to receive files from Tim
