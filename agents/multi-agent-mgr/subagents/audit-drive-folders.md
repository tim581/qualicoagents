# Audit & Fix AI Agent Drive Folders

## Purpose
Systematically check all agent folders in the "AI Agents Qualico" shared drive structure, verify Input/Output subfolders exist, create missing ones, and report findings.

## Instructions

Use the `conn_zhj70cc89xscszt6ktwj` Google Drive connection for all operations.

### Step 1: List all agent folders inside each department folder

The root folder `1fwkB9QMGnrGuUW3nMqbEX5OeWlWtUasi` ("AI Agents Qualico") contains these department folders:

| Department | Folder ID |
|---|---|
| 💰 Finance & Accounting | 1xAojJj9iIpjiwR8lB3dNCRBkaCszLV2s |
| ⚖️ Legal & Compliance | 1CtZTOCXKdbx0wD7fThiia4aXU22nXarr |
| ⚙️ Operations (first) | 1Dv1oMHv2bBzY464RSAJqWp5LWDeFeXVW |
| ⚙️ Operations (duplicate) | 1D1anCmj-hBvADLxcq6x6APcP2bKWzei5 |
| 📣 Marketing & Sales | 155LhZD-ih_DaUP2zgRbd4EFYgUTN9Pyk |
| 🛒 eCommerce & Product | 1pbMiROW1fl_6gRkGMPo2naK9ECxU-lNT |
| 🔧 IT & Infrastructure | 1g0rUfP6e3xtldSo59B7LS6lLj5yE8GGf |
| 👤 Personal | 11aFS6Yj10gMApIKzqOYcVel0C5TMfppK |

For EACH department folder, search for all subfolders using:
```
mimeType = 'application/vnd.google-apps.folder' and '{FOLDER_ID}' in parents
```
Use `corpora: "allDrives"` for all searches.

### Step 2: For each agent folder found, check for Input/Output subfolders

For each agent folder, search inside it:
```
mimeType = 'application/vnd.google-apps.folder' and '{AGENT_FOLDER_ID}' in parents
```

Record:
- ✅ Has both Input and Output
- ⚠️ Has one but not both
- ❌ Has neither

### Step 3: Create missing Input/Output folders

For any agent folder missing Input or Output subfolders, create them:
- Use `google_drive_create_folder` with the agent folder ID as parentFolderId
- Create "Input" folder if missing
- Create "Output" folder if missing

### Step 4: Check the duplicate Operations folders

Two folders named "⚙️ Operations" exist. Check which one has content (agent subfolders) and which is empty. Report this finding — the empty one should be deleted by the user.

### Step 5: Report

Provide a comprehensive report:
1. **Total agent folders found** (per department)
2. **Folders that were missing Input/Output** and what was created
3. **Duplicate Operations folder status** — which has content, which is empty
4. **Any other anomalies** (empty folders, wrong naming, etc.)

Also compare against the expected agent list from Supabase. Query Supabase to get all company agents:
```sql
SELECT agent_name, department FROM agents WHERE domain = 'company' ORDER BY department, agent_name;
```
Use connection `conn_xmaq9bngsgw6e19jxcjn` with project_id `zlteahycfmpiaxdbnlvr`.

Report which agents are MISSING folders entirely.

### Important Notes
- Use `corpora: "allDrives"` for ALL search queries (folders are on shared Qualico drive)
- Don't delete any folders — only create missing Input/Output ones
- Be thorough — check every single department folder
