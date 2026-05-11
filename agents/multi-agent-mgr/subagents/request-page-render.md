# Request Page Render

Agents call this subagent when they need a JavaScript-heavy website rendered. This saves 95% tokens vs parsing broken HTML.

## Instructions

You receive a JSON payload with:
```json
{
  "url": "https://example.com/page",
  "agent_name": "Your Agent Name",
  "description": "Why you need this rendered",
  "login_needed": false,
  "wait_ms": 0
}
```

### Step 1: Check Cache First

Query Supabase to see if we already have a fresh render:

```sql
SELECT html_content, last_rendered, expires_at 
FROM "Rendered_Pages" 
WHERE url = '[URL]' 
AND expires_at > NOW()
LIMIT 1;
```

**If found and NOT expired**: Return the cached HTML immediately. Done.

**If expired or missing**: Post to Airtable request queue (Step 2).

### Step 2: Post to Request Queue (If Cache Miss)

If no fresh cache exists, create an Airtable request:

POST to: `https://api.airtable.com/v0/appW71PeNcSqB2CpL/tblSKutgtEYIE9rdY`

Body:
```json
{
  "fields": {
    "Agent Name": "[agent_name]",
    "Request Type": "Page Render",
    "Notes": "URL: [url] | Description: [description] | Login needed: [login_needed] | Wait: [wait_ms]ms",
    "Priority": "Medium",
    "Target Delivery Date": "2026-04-07",
    "Status": "Open"
  }
}
```

Then tell the agent:

**Response if cache found:**
```
✅ CACHE HIT - Returning [X] bytes of rendered HTML
Rendered: [ISO timestamp]
Expires: [ISO timestamp]
```

**Response if cache miss:**
```
📋 POSTED TO QUEUE - Waiting for Multi Agent Mgr
Request ID: [airtable_record_id]
Status: Open
Tim will render this when convenient and upload to cache.
Check back in a few hours.
```

### Step 3: Return Data Format

Return ONLY this structure (no markdown formatting):

```json
{
  "source": "playwright_cache",
  "hit": true/false,
  "url": "[original_url]",
  "html_length": 45230,
  "rendered_at": "2026-04-06T08:49:00Z",
  "expires_at": "2026-04-13T08:49:00Z",
  "html_content": "[HTML STRING - FULL CONTENT]",
  "queue_id": null  // or Airtable record ID if posted
}
```

## How Agents Use This

**Step 1: Call the subagent**
```
run_subagent({
  "path": "/agent/subagents/request-page-render.md",
  "payload": JSON.stringify({
    "url": "https://forum.ecommercefuel.com/members",
    "agent_name": "Ecommerce Sourcing Agent",
    "description": "Need to extract member list and webshop links",
    "login_needed": true,
    "wait_ms": 2000
  })
})
```

**Step 2: Receive rendered HTML**
The subagent returns the JSON response with full HTML_content.

**Step 3: Parse with regex/jq (no Claude needed!)**
```bash
echo "$html_content" | grep -oP 'href="[^"]*webshop[^"]*"' | cut -d'"' -f2
```

**Step 4: No token burn!**
- Without render cache: 3,000-5,000 tokens parsing broken HTML
- With cache + regex: 200 tokens total

## Benefits

- **Saves 95% tokens** on large page parsing
- **One render per agent cycle** vs repeated parsing
- **7-day cache** = if 5 agents need the same page, only first render costs credits
- **Login support** for paywalls/forums
- **Async queue** = Tim renders when convenient, agents don't wait

## Example: eCommerce Fuel Member Scraping

**Agent workflow:**
1. Call subagent: "Render forum members page with login"
2. Get back clean HTML
3. Parse with regex: `member_id|webshop_url`
4. Store in Supabase
5. Done in 2 mins, ~300 tokens (vs 1 hour + 4,000 tokens old way)

## Airtable Feedback Loop

When Tim renders a page (locally), he can update the Airtable record:

```
Status: Done
Notes: Added rendered HTML to Supabase. Agents can query cache now.
```

Agents check Airtable and know when their request is ready.

---

**Reference**: Playwright Render Service at `/agent/home/playwright-render-service.js`
