# Cache Skills from Supabase

## Instructions

1. Query Supabase for all shared skills:
   - Connection: conn_xmaq9bngsgw6e19jxcjn
   - Project ID: zlteahycfmpiaxdbnlvr
   - Query: `SELECT skill_name, content FROM shared_skills ORDER BY id;`

2. For each skill returned, save the `content` field to `/agent/home/shared-skills/{skill_name}.md` using write_file

3. Report which files were saved and their byte sizes
