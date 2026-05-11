# Fetch Briefing Page Content

This subagent fetches the full markdown content for each agent briefing page from Notion.

## Instructions

You will receive a list of Notion page IDs in the payload. For each page ID:

1. **Fetch the page** using conn_1ykn33de2j69hkpfvg5r__notion-fetch with the page ID
2. **Extract the markdown content** from the page (the full text body/content)
3. **Create a JSON object** with page_id and content

Process batches of pages and write results to `/agent/home/briefing_content.json` as a JSON object mapping page_id → full_markdown_content.

Example output format:
```json
{
  "31db0893-7ab7-8149-b6fd-d0962f347d16": "# Page Title\n\nContent here...",
  "31bb0893-7ab7-814f-9dc4-e1842d5d7da9": "# Another Page\n\nMore content...",
  ...
}
```

## Output

Write the results to `/agent/home/briefing_content.json` and report:
- Total pages fetched
- Pages that failed
- File location
