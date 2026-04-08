# Browser Automation — Self-Service Guide for Agents

Any Qualico agent can trigger browser automations without writing Playwright code.

## How It Works

```
Agent → INSERT INTO Browser_Tasks → Tim's PC picks up → Script runs → Result in Browser_Tasks
```

## Step 1: Discover Available Automations

```sql
SELECT task_type, display_name, description 
FROM "Browser_Task_Registry" 
WHERE available = true;
```

## Step 2: Post a Task

```sql
INSERT INTO "Browser_Tasks" (agent_name, task_type, status, created_at)
VALUES ('your-agent-name', 'forecast-sync', 'pending', now())
RETURNING id;
```

## Step 3: Check Result

```sql
SELECT status, result, error_message, completed_at 
FROM "Browser_Tasks" 
WHERE id = <your_task_id>;
```

## Available Task Types

| task_type | What it does | Duration |
|---|---|---|
| `forecast-sync` | Push Puzzlup forecasts → Flieber (all 5 stores) | ~5 min |
| `po-simulation` | Run PO simulation in Flieber | ~2 min |
| `to-simulation` | Run TO simulation in Flieber | ~2 min |

## Using the Subagent

Agents with access to `/agent/subagents/post-browser-task.md` can use it directly.

## Requirements

- `playwright-task-executor.js` must be running on Tim's PC
- Scripts must be downloaded to `C:\Users\Tim\playwright-render-service\`
