# Drive Input/Output Folder Audit & Creation

## Purpose
Scan ALL agent folders in the AI Agents Qualico Drive folder and create missing Input/Output subfolders.

## Instructions

### Step 1: List all department folders
Use `conn_zhj70cc89xscszt6ktwj__google_drive_search_documents` to find all folders under the AI Agents Qualico root folder `1fwkB9QMGnrGuUW3nMqbEX5OeWlWtUasi`:

```
query: "mimeType = 'application/vnd.google-apps.folder' and '1fwkB9QMGnrGuUW3nMqbEX5OeWlWtUasi' in parents"
corpora: allDrives
limit: 100
```

### Step 2: For each department folder, list agent folders
For each department folder found, search for subfolders:
```
query: "mimeType = 'application/vnd.google-apps.folder' and '{departmentFolderId}' in parents"
corpora: allDrives
limit: 100
```

### Step 3: For each agent folder, check for Input/Output
For each agent folder, search for subfolders:
```
query: "mimeType = 'application/vnd.google-apps.folder' and '{agentFolderId}' in parents"
corpora: allDrives
limit: 100
```

### Step 4: Create missing Input/Output folders
For any agent folder missing an "Input" or "Output" subfolder, create it:
```
conn_zhj70cc89xscszt6ktwj__google_drive_create_folder
title: "Input" (or "Output")
parentFolderId: {agentFolderId}
```

### Step 5: Also check Personal Drive
Check the personal drive root `1UYtp1crhzPqC-VPbzkNTmDM7Q9-EBKs4` using `conn_cp8t6gy5wwmb1m9y8ka1__google_drive_search_documents`:
```
query: "mimeType = 'application/vnd.google-apps.folder' and '1UYtp1crhzPqC-VPbzkNTmDM7Q9-EBKs4' in parents"
corpora: user
limit: 100
```

For each personal agent folder, check and create Input/Output as needed using `conn_cp8t6gy5wwmb1m9y8ka1__google_drive_create_folder`.

### Step 6: Report
Return a complete report:
- Total agent folders found (company + personal)
- How many already had Input/Output
- How many needed creation
- Any errors encountered
- List of all agent folders with their IDs and Input/Output status
