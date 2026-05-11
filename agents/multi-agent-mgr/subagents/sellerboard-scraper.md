# Sellerboard Market Scraper

Scrapes Sellerboard P&L data for specified markets using the Tasklet built-in browser.
The browser is ALREADY logged into Sellerboard with a persistent session.

## Instructions

You receive a JSON payload with:
- `markets`: array of market names to scrape (e.g. ["Amazon.ca", "Amazon.com"])
- `account`: which account these markets are on ("us" for AMZ USA, "eu" for Tim@qualico.be)
- `currentAccount`: which account is currently active
- `startTimestamp`: Unix timestamp for period start
- `endTimestamp`: Unix timestamp for period end
- `outputDir`: where to save JSON files (e.g. "/tmp/sellerboard")

### Step 0: Setup
Create the output directory if it doesn't exist using run_command.

### Step 1: Account Switch (if needed)
If `currentAccount` !== `account`, you need to switch:
1. Navigate to `https://app.sellerboard.com/en/dashboard/`
2. Wait 5 seconds
3. Take a snapshot and find the account avatar/name in top-right area
4. Click on the current account name to open dropdown
5. Click on the target account name:
   - "us" → click "AMZ USA" 
   - "eu" → click "Tim@qualico.be"
6. Wait 8 seconds for switch to complete

### Step 2: For each market, scrape MAIN P&L
For each market in the list:

1. Build the URL:
```
https://app.sellerboard.com/en/dashboard/?viewType=table&tablePeriod[start]={startTimestamp}&tablePeriod[end]={endTimestamp}&tablePeriod[forecast]=false&tableSorting[field]=margin&tableSorting[direction]=desc&market[]={marketName}
```

2. Navigate: First go to `about:blank`, wait 500ms, then navigate to the URL. Wait 8 seconds for data to load.

3. Wait for `<table>` element to appear (up to 30 seconds, check every 5 seconds).

4. Scrape the table using browser evaluate:
```javascript
(() => {
  const tables = document.querySelectorAll('table');
  let best = null, bestRows = 0;
  tables.forEach(t => {
    const rows = t.querySelectorAll('tr');
    if (rows.length > bestRows) { bestRows = rows.length; best = t; }
  });
  if (!best) return null;
  const rows = best.querySelectorAll('tr');
  const data = [];
  for (const row of rows) {
    const cells = row.querySelectorAll('th, td');
    const rowData = [];
    for (const cell of cells) {
      rowData.push(cell.innerText?.split('\\n')[0]?.trim() || '');
    }
    if (rowData.some(c => c)) data.push(rowData);
  }
  return JSON.stringify({ headers: data[0], rows: data.slice(1), rowCount: data.length - 1 });
})()
```

5. Save the result string to file: `{outputDir}/{market_safe}_main_pl.json` where market_safe = market name with dots replaced by underscores, lowercased (e.g. "amazon_ca").

### Step 3: For each market, scrape PER ASIN
Same process but add `&groupBy=asin` to the URL.

After navigating and waiting for table:
- Scroll down 3 times (500px each, 500ms between) to trigger lazy loading
- Scroll back to top
- Wait 2 seconds
- Then scrape using the SAME evaluate script as above

Save to: `{outputDir}/{market_safe}_per_asin.json`

### Step 4: Report results
After ALL markets are done, use run_command to list all files in outputDir and show their sizes.
Then output a summary like:
```
DONE: Scraped X markets
- Amazon.ca: main_pl (Y rows), per_asin (Z rows)
- Amazon.com: main_pl (Y rows), per_asin (Z rows)
...
```

### Important Rules
- Use `about:blank` → then real URL for EVERY navigation (SPA state bypass)
- Wait 8 seconds after each navigation before trying to find tables
- If table not found after 30 seconds, take a screenshot and report the failure but continue to next market
- Save raw JSON strings from evaluate to files — don't try to parse/transform
- The browser `evaluate` returns a string — save that string directly to a file using run_command with echo/cat
- For large evaluate results, use `destinationPath` parameter in the evaluate action to save directly to file
