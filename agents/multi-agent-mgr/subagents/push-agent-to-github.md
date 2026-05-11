# Push Agent Files to GitHub

Pushes all subagent files and key home files for a specific agent to the `tim581/qualicoagents` GitHub repo.

## Instructions

You will receive a payload specifying which agent's files to push and what directory they're in.

### Steps

1. Read ALL files from the specified subagents directory
2. Read key files from the home directory (if specified)
3. Push everything to GitHub under `agents/{agent-name}/subagents/` and `agents/{agent-name}/knowledge/`
4. Use `conn_rf4te6wqncg18hn7dn13__github_create_pull_request` or `conn_rf4te6wqncg18hn7dn13__github_push_to_branch` to push files

### Important
- The GitHub connection is `conn_rf4te6wqncg18hn7dn13`
- Repo: `tim581/qualicoagents`
- Push directly to `main` branch using `github_push_to_branch`
- Read each file's content before pushing
- Handle files in batches of ~15 to avoid hitting limits
- Report total files pushed and any errors

### File structure on GitHub
```
agents/{agent-name}/
├── subagents/          # All .md files from /agent/subagents/
└── knowledge/          # Key .md and .sql files from /agent/home/
```
