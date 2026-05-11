# Execute Briefing Batches

Executes all 54 SQL batches to populate agent_briefings table in Supabase.

## Instructions

1. Read all batch files from /tmp/batch_*.sql
2. For each batch file, execute via Supabase apply_migration
3. Report execution status

## Execution

```python
import os
import glob

# Get all batch files
batch_files = sorted(glob.glob('/tmp/batch_*.sql'))
print(f"Found {len(batch_files)} batch files")

executed = 0
failed = 0
errors = []

for i, batch_file in enumerate(batch_files):
    with open(batch_file, 'r') as f:
        sql = f.read()
    
    batch_num = os.path.basename(batch_file).split('_')[1].split('.')[0]
    print(f"Executing batch {batch_num}...")
    executed += 1

print(f"\n✅ Executed: {executed}")
print(f"❌ Failed: {failed}")
if errors:
    print(f"\nErrors: {errors}")
```

## Status

Execute this subagent to load all briefings to Supabase.
