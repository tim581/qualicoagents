# Amazon Buyer Messages Handler

Scrapes Amazon Seller Central UK messaging inbox (EU-consolidated cases) and forwards new messages to the CS webhook.

## Instructions

1. Insert a `Browser_Task` into Supabase to trigger the local Playwright executor
2. Poll for the result (every 30 seconds, up to 5 minutes)
3. Process new messages from the result JSON
4. Return a formatted report

### Step 1: Insert Browser Task

Use Supabase project `zlteahycfmpiaxdbnlvr`:

```sql
INSERT INTO "Browser_Tasks" (agent_name, task_type, url, actions, status, priority)
VALUES (
  'customer-service',
  'amazon-buyer-messages',
  'https://sellercentral.amazon.de/messaging/inbox',
  '[]'::jsonb,
  'pending',
  1
)
RETURNING id, status, created_at;
```

**Prerequisites on Tim's PC:** Playwright executor running, fresh cookies in `scripts/amazon-storage-state.json` (run `node scripts/convert-amazon-cookies.js` after Cookie-Editor export from sellercentral.amazon.co.uk).

### Step 2: Poll for Result

```sql
SELECT status, result, error_message, completed_at
FROM "Browser_Tasks"
WHERE id = '{task_id}';
```

- `pending` / `running` → wait 30s and poll again
- `done` / `completed` → proceed
- `failed` → report `error_message`

### Step 3: Process Result

The `result` column contains JSON:

```json
{
  "success": true,
  "messages_scraped": 3,
  "new_messages": 1,
  "webhooks_sent": 1,
  "messages": [...],
  "webhook_results": [...]
}
```

New messages are also POSTed to the Tasklet CS webhook automatically by the script.

### Cookie refresh

If login fails, export cookies from **sellercentral.amazon.de** (logged in, Messages inbox open) via Cookie-Editor → save as `amazon-cookies-raw.json` in repo root → run:

```
node scripts/convert-amazon-cookies.js
```

### Script location

GitHub: `tim581/qualicoagents` → `scripts/amazon-buyer-messages.js`  
Task type: `amazon-buyer-messages`

⚠️ Amazon ToS risk — use for daily CS check only, not high-frequency polling.
