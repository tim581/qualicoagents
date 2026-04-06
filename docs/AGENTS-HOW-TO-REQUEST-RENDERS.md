# 📖 Quick Reference: How to Request Page Renders

**For all 43 agents in the network.**

---

## Problem You're Solving

You need data from a JavaScript-heavy website (forum, SPA, paywall). Two options:

### ❌ Old Way (Expensive)
```
web_scrape_website → broken HTML → Claude parses → 4,000+ tokens wasted
```

### ✅ New Way (Smart)
```
request-page-render subagent → cached HTML → regex parse → 150 tokens total
```

**Savings**: 95% tokens, 50x faster.

---

## How to Use It (3 Steps)

### Step 1: Call the Subagent

```python
import json

render_request = {
    "url": "https://forum.ecommercefuel.com/members",
    "agent_name": "Your Agent Name",
    "description": "Need member list and webshop links",
    "login_needed": False,  # Set True if site requires login
    "wait_ms": 0           # Set to 2000+ if content lazy-loads
}

result = run_subagent({
    "path": "/agent/subagents/request-page-render.md",
    "payload": json.dumps(render_request),
    "action_pending": "Requesting page render...",
    "action_finished": "Page render ready",
    "action_error": "Render request failed"
})
```

### Step 2: Handle Response

```python
import json

response = json.loads(result)

if response['hit']:
    # Cache hit! You got fresh HTML
    html = response['html_content']
    print(f"✅ Cache hit (expires: {response['expires_at']})")
else:
    # Cache miss, queued with Tim
    print(f"📋 Posted to queue (ID: {response['queue_id']})")
    print("Tim will render this when convenient (~1-2 hours)")
    # Wait or retry later
```

### Step 3: Parse with Regex (No Claude!)

```python
import re

# Example: Extract member links from eCommerce Fuel
member_links = re.findall(r'href="(/members/[^"]+)"', html)

# Example: Extract product prices
prices = re.findall(r'<span class="price">(\$[\d,]+)</span>', html)

# Example: Extract webshop URLs
webshops = re.findall(r'https://[^/]+\.[a-z]+', html)

print(f"Found {len(member_links)} members")
print(f"Found {len(prices)} prices")
```

**No Claude needed = No token burn!**

---

## Real Examples

### Example 1: eCommerce Fuel Members (With Login)

```python
result = run_subagent({
    "path": "/agent/subagents/request-page-render.md",
    "payload": json.dumps({
        "url": "https://forum.ecommercefuel.com/members",
        "agent_name": "Ecommerce Sourcing Agent",
        "description": "Extract member list for supplier outreach",
        "login_needed": True,
        "wait_ms": 2000
    })
})

response = json.loads(result)
html = response['html_content']

# Parse members
import re
members = re.findall(r'<a class="member" href="([^"]+)">([^<]+)</a>', html)

for member_url, member_name in members:
    print(f"{member_name}: {member_url}")
```

### Example 2: Competitor Product Page (No Login)

```python
result = run_subagent({
    "path": "/agent/subagents/request-page-render.md",
    "payload": json.dumps({
        "url": "https://competitor.com/products",
        "agent_name": "Market Research Agent",
        "description": "Monitor competitor product pricing",
        "login_needed": False,
        "wait_ms": 3000
    })
})

response = json.loads(result)
html = response['html_content']

# Extract prices
prices = re.findall(r'<span class="product-price">([^<]+)</span>', html)
print(f"Found {len(prices)} products with prices: {prices[:5]}")
```

### Example 3: SPA with Lazy Loading

```python
result = run_subagent({
    "path": "/agent/subagents/request-page-render.md",
    "payload": json.dumps({
        "url": "https://spa-app.com/data",
        "agent_name": "Data Collection Agent",
        "description": "Extract dynamically loaded content",
        "login_needed": False,
        "wait_ms": 5000  # Wait 5 seconds for JS to render
    })
})

response = json.loads(result)
html = response['html_content']

# Content should now be fully rendered
data = re.findall(r'<div class="item">([^<]+)</div>', html)
```

---

## When to Use This

✅ **USE THIS WHEN:**
- Site is JavaScript-heavy (SPA, dynamic content)
- Site has login/paywall
- You're scraping multiple pages (render once, agents use many times)
- You want sub-100-token extraction

❌ **DON'T USE WHEN:**
- Simple static HTML (use `web_scrape_website`)
- One-off queries (faster to do manually)
- Real-time data that changes every minute (cache will be stale)

---

## Response Format

The subagent returns JSON:

```json
{
  "source": "playwright_cache",
  "hit": true,
  "url": "https://forum.ecommercefuel.com/members",
  "html_length": 456230,
  "rendered_at": "2026-04-06T08:49:00Z",
  "expires_at": "2026-04-13T08:49:00Z",
  "html_content": "[FULL HTML STRING HERE - 456KB]",
  "queue_id": null
}
```

**Fields:**
- `hit`: true = cache found and fresh, false = queued for Tim to render
- `html_length`: Size of HTML (helps you know what you got)
- `expires_at`: When this cache expires (7 days by default)
- `html_content`: The actual rendered HTML (parse this!)
- `queue_id`: Airtable record ID if posted to queue

---

## Parsing Tips

### Find All Attribute Values

```python
import re

# Extract all href values
urls = re.findall(r'href="([^"]*)"', html)

# Extract all src values  
images = re.findall(r'src="([^"]*)"', html)

# Extract all text inside specific tags
titles = re.findall(r'<h1[^>]*>([^<]+)</h1>', html)
```

### Extract Structured Data

```python
# Tables
rows = re.findall(r'<tr>(.*?)</tr>', html, re.DOTALL)
cells = re.findall(r'<td[^>]*>([^<]+)</td>', html)

# Lists
items = re.findall(r'<li[^>]*>([^<]+)</li>', html)

# Nested divs
divs = re.findall(r'<div class="item">(.*?)</div>', html, re.DOTALL)
```

### JSON Embedded in HTML

```python
import json
import re

# Extract JSON from <script> tags
json_match = re.search(r'<script type="application/json">(.*?)</script>', html, re.DOTALL)
if json_match:
    data = json.loads(json_match.group(1))
    print(data)
```

---

## Common Questions

**Q: What if the page isn't rendered yet when I need it?**  
A: The subagent will queue it in Airtable. Check back in 1-2 hours when Tim renders it.

**Q: Can I render pages with complex interactions?**  
A: Limited to login + wait time. For complex workflows, ask Tim to add custom logic.

**Q: How long does cache last?**  
A: 7 days by default. Request longer if you want the data to persist.

**Q: What if parsing fails?**  
A: Print the HTML to debug:
```python
response = json.loads(result)
print(response['html_content'][:5000])  # First 5000 chars
```

**Q: Can I call this from Notion?**  
A: No. Only agents with Tasklet tools. (This is an agents-only service.)

---

## Cost Comparison

| Task | Old Way | New Way | Savings |
|------|---------|---------|---------|
| Scrape 1 page | 4,000 tokens | 150 tokens | 96% |
| Scrape 10 pages | 40,000 tokens | 1,500 tokens (1 render) | 96% |
| 43 agents scrape same page | 172,000 tokens | 150 tokens (1 render) | 99% |

---

## See Also

- **Setup guide**: `/agent/home/PLAYWRIGHT-LOCAL-SETUP.md` (for Tim)
- **Subagent code**: `/agent/subagents/request-page-render.md`
- **Render service**: `/agent/home/playwright-render-service.js`
