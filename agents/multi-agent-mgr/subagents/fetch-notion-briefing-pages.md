# Fetch Notion Agent Briefing Pages

This subagent fetches agent briefing pages from Notion and extracts their content.

## Instructions

You will receive a list of Notion page IDs in the payload. For each page ID:

1. **Fetch the page** using conn_1ykn33de2j69hkpfvg5r__notion-fetch with the page ID
2. **Extract metadata** from the page properties:
   - `Agent Name` - title property (from page title)
   - `Category` - category select field
   - `Status` - status select field
   - `Connections` - text field
   - `Frequency` - text field
   - `Key Resources` - text field
   - `Trigger` - trigger select field
   - `Version` - version text field
3. **Extract full page content** as markdown
4. **Build the page URL** from the page ID: https://www.notion.so/{pageIdWithoutDashes}

For each page, create a JSON object with:
```json
{
  "page_id": "...",
  "agent_name": "...",
  "category": "...",
  "status": "...",
  "connections": "...",
  "frequency": "...",
  "key_resources": "...",
  "trigger_info": "...",
  "version": "...",
  "content": "...",
  "notion_page_url": "https://www.notion.so/..."
}
```

## Output Format

Write the results as a JSON array to `/agent/home/notion_briefings.json` containing all fetched briefing objects.

Save the output and then report: 
- Total pages fetched successfully
- Any pages that failed to fetch
- Path to the JSON file with results
