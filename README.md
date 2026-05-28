# qualicoagents

Qualico agent tooling, browser automation scripts, and documentation.

## Browser automation

**Runtime:** Tim's PC — `C:\Users\Tim\playwright-render-service\`  
**Executor:** `scripts/playwright-task-executor.js` (polls Supabase `Browser_Tasks` every ~30s)  
**Human overview:** https://qualico-platform.vercel.app/it-tech/browser-automation

### Documentation

Start at [docs/README.md](./docs/README.md):

- [BROWSER-AUTOMATION-SELF-SERVICE.md](./docs/BROWSER-AUTOMATION-SELF-SERVICE.md) — agents: trigger tasks via SQL
- [playwright-task-executor-system.md](./docs/playwright-task-executor-system.md) — full system architecture
- [WRITING-BROWSER-SCRIPTS.md](./docs/WRITING-BROWSER-SCRIPTS.md) — script authors

**Live task list (source of truth):**

```sql
SELECT task_type, display_name, script_name FROM "Browser_Task_Registry" WHERE available = true;
```

### Dev workflow

1. Develop in `scripts/` locally (Cursor)
2. Test until run succeeds and outcome is verified
3. Push to `main` — executor auto-downloads latest script on next task
