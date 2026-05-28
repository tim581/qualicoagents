# Browser Automation Documentation

**Repo:** `tim581/qualicoagents`  
**Runtime:** Tim's PC — `C:\Users\Tim\playwright-render-service\`  
**Canonical scripts:** `scripts/`  
**Human overview (Qualico OS):** https://qualico-platform.vercel.app/it-tech/browser-automation

---

## For agents (trigger a task)

| Doc | When to read |
|-----|----------------|
| [BROWSER-AUTOMATION-SELF-SERVICE.md](./BROWSER-AUTOMATION-SELF-SERVICE.md) | **Start here** — INSERT `Browser_Tasks`, poll result |
| [playwright-task-executor-system.md](./playwright-task-executor-system.md) | Full system: resolution, schema, troubleshooting |

**Live task list (source of truth):**

```sql
SELECT task_type, display_name, description, script_name
FROM "Browser_Task_Registry"
WHERE available = true
ORDER BY task_type;
```

Agents do **not** run Playwright or git. They only insert/read `Browser_Tasks`.

---

## For developers (write or change scripts)

| Doc | When to read |
|-----|----------------|
| [WRITING-BROWSER-SCRIPTS.md](./WRITING-BROWSER-SCRIPTS.md) | Script template, deploy, registry, debugging |
| [PLAYWRIGHT-LOCAL-SETUP.md](./PLAYWRIGHT-LOCAL-SETUP.md) | First-time setup on Tim's PC |
| [AGENTS-HOW-TO-REQUEST-RENDERS.md](./AGENTS-HOW-TO-REQUEST-RENDERS.md) | HTML page render queue |

**Dev workflow (May 2026):**

1. Develop in `scripts/` (Cursor + local test)
2. Do **not** push until run succeeds + outcome verified
3. Push to `main` → executor downloads latest script on next task
4. Optional: `git pull` on Tim PC before long executor sessions

---

## Removed / do not use

| task_type / script | Reason |
|--------------------|--------|
| `inventory-sync-bol` | Bol LvB inventory → **API only**, no Playwright |
| `amazon-buyer-messages.js` | Removed — Amazon ToS risk |

---

## Related

- **Subagent:** `/agent/subagents/post-browser-task.md`
- **Shared_Knowledge:** topic `browser-automation`, key `browser_tasks_v1`
- **Pricing targets:** topic `pricing`, key `price_targets_architecture_v1`
