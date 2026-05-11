# Batch Update Agent Briefings to v3.0

Updates individual agent briefing pages in Notion to remove hub references and mark as Protocol v3.0.

## Instructions

You will be given a batch of Notion page IDs to update. For each page:

### Step 1: Update Properties
Use the Notion update-page tool with `command: "update_properties"` to set:
- `"Version"`: `"3.0 (Supabase-native)"`

### Step 2: Update Key Resources
Fetch the page first to see current content. Then use `command: "update_properties"` to clean up the "Key Resources" field:
- Remove any text containing "Hub webhook" or "Webhook URL: https://webhooks.tasklet.ai"
- Keep all other key resources intact
- If the entire Key Resources is just webhook info, set it to the agent's Supabase project info: `"Supabase project: zlteahycfmpiaxdbnlvr | Protocol: v3.0 Supabase-native"`

### Step 3: Add v3.0 Notice to Content (if hub references exist)
If the page content contains hub/webhook references (look for "hub", "webhook", "POST:", "message_type"), add this notice at the very top of the content using `command: "update_content"`:

```
> ⚠️ **PROTOCOL v3.0 (March 2026)**: The hub is DEAD. All inter-agent communication now uses Supabase directly. See Agent Onboarding Briefing v3.0 for full protocol. Hub webhook references below are LEGACY — do not use.
```

Find the first line of existing content and prepend this notice before it.

### Important Rules
- Use the Notion connection tools (they are prefixed with `conn_1ykn33de2j69hkpfvg5r__notion-`)
- Process ALL pages in the batch
- For each page: fetch → update properties → update content if needed
- Be efficient — skip content update if no hub references found
- Report results: how many updated, any failures

### Input
The payload contains the batch of pages to process as JSON array with `id` and `title` fields.
