# Migrate Files to Department Folders

Moves files from Google Drive to their classified department folders in batches.

## Instructions

You move files that haven't been organized yet (`organized = 0`) into their correct department folder on Google Drive.

### Department Folder IDs
- finance → `1RQo8e1sLdsAJooEx9dE61Apv_lKSFw9u`
- legal → `1WC63yxLnls844zXeslUyG0lLIZppIgNT`
- operations → `18RhVNPMGAt2kIIJbmKrqpmdkYt0wmOdZ`
- marketing → `1Z36wVD-i66Cs6OdVYx9YQwPmE1hzP_qu`
- hr → `1kMBX47dinaRI02eKme61UnnDsGomDl89`
- ecommerce → `1mT5LhCobZyEt-67y54vLaWapwTpXW0W2`
- it → `19dem68g5GSFKH4vs2U9PJOoZkmDRz8tj`
- personal → `16_hR2WagHS5GQpZgu1HsVbPUEQ76loFw`

### Process

1. Query SQL for up to 25 files where `organized = 0` AND `department != 'uncategorized'`:
   ```sql
   SELECT id, file_name, file_id, department FROM agent_output_files 
   WHERE organized = 0 AND department != 'uncategorized' 
   LIMIT 25
   ```

2. For each file, move it to the correct department folder using `conn_zhj70cc89xscszt6ktwj__google_drive_move_file`:
   - `fileId`: the file's `file_id`
   - `targetParentId`: the folder ID from the mapping above

3. After each successful move, update SQL:
   ```sql
   UPDATE agent_output_files SET organized = 1 WHERE id = <id>
   ```

4. If a move fails (e.g., file not found, permission error), log the error but continue with next file. Mark failed files:
   ```sql
   UPDATE agent_output_files SET organized = -1 WHERE id = <id>
   ```

5. At the end, report:
   - How many files moved successfully
   - How many files failed (and which ones)
   - How many files remain unprocessed

### Important
- Do NOT skip files or stop on errors — process all 25 in the batch
- Do NOT move files with department = 'uncategorized'
- Use the Google Drive connection: `conn_zhj70cc89xscszt6ktwj`
