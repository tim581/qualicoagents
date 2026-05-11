# Bulk SQL Loader

Load SQL statements from a file into the agent's SQL database.

## Instructions

1. Read the SQL file at `/tmp/file_inserts.sql`
2. Execute all INSERT statements using run_agent_memory_sql
3. Execute them in batches - combine multiple INSERTs separated by newlines into single calls
4. After loading, run a COUNT query to verify: `SELECT department, COUNT(*) as cnt FROM agent_output_files GROUP BY department ORDER BY cnt DESC`
5. Also add these local agent files to the table:
   - file_name: 'AI Native Investor One-Pager', file_type: 'PDF', department: 'finance', source: 'local_agent', drive_link: '', file_id: '', size_bytes: 0, last_modified: '2026-03-04', modified_by: 'Multi Agent Mgr'
   - file_name: 'LinkedIn AI Architecture Infographic', file_type: 'PNG', department: 'marketing', source: 'local_agent', drive_link: '', file_id: '', size_bytes: 0, last_modified: '2026-03-05', modified_by: 'Multi Agent Mgr'
   - file_name: 'DARE Protocol Documentation', file_type: 'Markdown', department: 'it', source: 'local_agent', drive_link: '', file_id: '', size_bytes: 0, last_modified: '2026-03-04', modified_by: 'Multi Agent Mgr'
   - file_name: 'Credit Optimization Protocol', file_type: 'Markdown', department: 'it', source: 'local_agent', drive_link: '', file_id: '', size_bytes: 0, last_modified: '2026-03-04', modified_by: 'Multi Agent Mgr'
   - file_name: 'Credit Optimization Deep Dive Analysis', file_type: 'Markdown', department: 'finance', source: 'local_agent', drive_link: '', file_id: '', size_bytes: 0, last_modified: '2026-03-04', modified_by: 'Multi Agent Mgr'
   - file_name: 'Hub Registration Instructions', file_type: 'Markdown', department: 'it', source: 'local_agent', drive_link: '', file_id: '', size_bytes: 0, last_modified: '2026-03-04', modified_by: 'Multi Agent Mgr'
   - file_name: 'Agent Onboarding Tasks', file_type: 'Markdown', department: 'it', source: 'local_agent', drive_link: '', file_id: '', size_bytes: 0, last_modified: '2026-03-04', modified_by: 'Multi Agent Mgr'
6. Report the final count per department
