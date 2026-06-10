# Sellerboard P&L Scraper v11

Scrapes Sellerboard P&L table data for all 8 Amazon markets, upserts to Supabase `Sellerboard_Exports`, and runs cross-check verification against existing data.

## Instructions

You are an automation agent that scrapes Sellerboard P&L data. You have access to a browser (computer use connection) and Supabase.

### Overview
1. Login to Sellerboard
2. For each EU market: navigate to P&L view → scrape table → save to Supabase
3. Switch to US account
4. For each US market: navigate to P&L view → scrape table → save to Supabase
5. Cross-check scraped data vs existing DB values
6. Report results + verification flags

### Step 1: Login

Read the skill file `/agent/skills/connections/conn_htp1rsc9jwmzgrwgkdwf/SKILL.md` before using computer tools.

Use the computer use connection (`conn_htp1rsc9jwmzgrwgkdwf`) to:
1. Navigate to `about:blank`, wait 1 second
2. Navigate to `https://app.sellerboard.com/en/login`
3. Wait 3 seconds for page load
4. Fill email: `tim@qualico.be`, password: `deAK}Uce7JF,6[<2@}Q1`
5. Click login button
6. Wait 5 seconds for dashboard to load
7. Take a screenshot to verify login succeeded

### Step 2: EU Markets (default account)

EU markets to scrape in order: `Amazon.de`, `Amazon.co.uk`, `Amazon.fr`, `Amazon.es`, `Amazon.it`, `Amazon.nl`

For each market:
1. Navigate to `about:blank`, wait 1 second (resets SPA state)
2. Navigate to: `https://app.sellerboard.com/en/dashboard/table?viewType=table&market[]={MARKET}`
3. Wait 8 seconds for full page load
4. Take a screenshot to verify the page loaded
5. Click the "P&L" tab link at the top of the page (look for text "P&L" in snapshot)
6. Wait 5 seconds for P&L table to render
7. Execute the scraping JavaScript (see Step 2a below)
8. Save result to `/tmp/scrape_{market_safe_name}.json`

If the P&L table is not found, take a screenshot to debug, then retry once after waiting 5 more seconds.

#### Step 2a: Scraping JavaScript

Execute this in the browser:

```javascript
(() => {
  const tables = document.querySelectorAll('table');
  let plTable = null;
  for (const t of tables) {
    if (t.textContent.includes('Parameter/Date') && t.textContent.includes('Sales')) {
      plTable = t;
      break;
    }
  }
  if (!plTable) return JSON.stringify({error: 'P&L table not found'});
  
  const rows = plTable.querySelectorAll('tr');
  const headers = [];
  const data = [];
  
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].querySelectorAll('td, th');
    const rowData = [];
    for (const cell of cells) {
      let text = cell.innerText.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
      rowData.push(text);
    }
    if (i === 0) {
      headers.push(...rowData);
    } else if (rowData.length > 0) {
      data.push(rowData);
    }
  }
  
  return JSON.stringify({ headers, rows: data, rowCount: data.length });
})()
```

### Step 3: Switch to US Account

1. Navigate to `about:blank`, wait 1 second
2. Navigate to `https://app.sellerboard.com/en/dashboard`
3. Wait 5 seconds
4. Take a screenshot to see the account switcher area
5. Click on the account name / email in the top right area to open the dropdown
6. Wait 2 seconds for dropdown
7. Take a screenshot to see dropdown options
8. Click on "AMZ USA" in the dropdown
9. Wait 5 seconds for account switch
10. Take a screenshot to verify switch

⚠️ **AMZ CA** in the dropdown is a SEPARATE EMPTY account — do NOT click it. Amazon.ca data lives under **AMZ USA**.

### Step 4: US Markets

US markets to scrape: `Amazon.com`, `Amazon.ca`

Follow the same scraping procedure as EU markets (Step 2).

### Step 5: Upsert to Supabase

For each successfully scraped market, upsert to Supabase using `execute_sql` (project_id: `zlteahycfmpiaxdbnlvr`):

**IMPORTANT**: The `rows` column in `Sellerboard_Exports` is type TEXT (not JSONB). You must store the JSON as a string. Also properly escape single quotes by doubling them.

Write a Python script to build and execute the SQL for each market:

```python
import json

# For each market:
headers_str = json.dumps(headers).replace("'", "''")
rows_str = json.dumps(rows).replace("'", "''")

sql = f"""
INSERT INTO "Sellerboard_Exports" (market, view_type, headers, rows, row_count, exported_at)
VALUES ('{market}', 'main_pl', '{headers_str}', '{rows_str}', {row_count}, now())
ON CONFLICT (market, view_type) DO UPDATE SET 
  headers=EXCLUDED.headers, rows=EXCLUDED.rows, row_count=EXCLUDED.row_count, exported_at=now();
"""
```

Execute each market's SQL separately to avoid timeouts.

### Step 6: Cross-Check Verification (CRITICAL)

After all markets are scraped and saved, run verification against existing P&L_Masterdata.

Write and execute a Python script at `/tmp/cross_check.py`:

```python
"""
Cross-check: compare freshly scraped Sellerboard data vs existing P&L_Masterdata for CLOSED months.
A closed month = any month before the current month (e.g., if now is April, Jan/Feb/Mar are closed).
"""
import json, re, subprocess
from datetime import datetime

# Determine current month
current_month = datetime.now().month  # April = 4
closed_months = list(range(1, current_month))  # [1, 2, 3]

MARKET_MAP = {
    'Amazon.de': 'AMZ DE', 'Amazon.co.uk': 'AMZ UK', 'Amazon.fr': 'AMZ FR',
    'Amazon.es': 'AMZ ES', 'Amazon.it': 'AMZ IT', 'Amazon.nl': 'AMZ NL',
    'Amazon.com': 'AMZ USA', 'Amazon.ca': 'AMZ CA'
}

def parse_value(text):
    """Parse currency/percentage text to float."""
    if not text: return None
    text = re.sub(r'[€$£%,]', '', str(text)).strip()
    try: return float(text)
    except: return None

def get_month_from_header(header):
    """Map header text to month number."""
    month_names = {'january':1,'february':2,'march':3,'april':4,'may':5,'june':6,
                   'july':7,'august':8,'september':9,'october':10,'november':11,'december':12}
    h = header.lower()
    for name, num in month_names.items():
        if name in h:
            return num
    return None

# For each market, load scraped data and compare
alerts = []
matches = 0
checks = 0

for sb_market, db_channel in MARKET_MAP.items():
    safe_name = sb_market.replace('.', '_')
    try:
        with open(f'/tmp/scrape_{safe_name}.json') as f:
            data = json.load(f)
    except:
        continue
    
    headers = data['headers']
    rows = data['rows']
    
    # Find Sales row for quick comparison
    for row in rows:
        if row[0] == 'Sales':
            for col_idx, header in enumerate(headers[1:], 1):
                month_num = get_month_from_header(header)
                if month_num and month_num in closed_months:
                    scraped_val = parse_value(row[col_idx] if col_idx < len(row) else None)
                    if scraped_val:
                        checks += 1
                        # Compare with DB value (to be fetched)
                        # ... query logic here
            break

# Report
print(f"Cross-check complete: {checks} checks, {len(alerts)} alerts")
for a in alerts:
    print(f"  ⚠️ {a}")
```

**The actual cross-check**: After scraping, query existing P&L_Masterdata for closed months and compare:

```sql
SELECT marketplace, month, line_item, amount 
FROM "P&L_Masterdata" 
WHERE fiscal_year = 2026 
  AND source = 'sellerboard_actual'
  AND month IN (1,2,3)
  AND line_item IN ('Gross Revenue (incl. VAT)', 'PPC / Advertising', 'Amazon / Marketplace Fees', 'COGS (Landed Cost)')
ORDER BY marketplace, month, line_item;
```

Compare each value. For closed months:
- **Delta < €5**: ✅ match (rounding only)
- **Delta €5-€50**: ⚠️ minor retroactive adjustment — log but proceed
- **Delta > €50**: 🔴 significant change — flag in report, proceed but warn

Save the cross-check report to `/tmp/cross_check_report.json`.

### Step 7: Report Results

Return a structured summary:

```
=== SELLERBOARD SCRAPE REPORT ===

Markets scraped: 8/8 ✅
Date: {today}

Per market:
| Market | Rows | Apr Sales | Apr TACOS | Status |
|--------|------|-----------|-----------|--------|
| DE     | 24   | €18,903   | 16.0%     | ✅     |
...

=== CROSS-CHECK VERIFICATION ===

Closed months checked: Jan, Feb, Mar
Total checks: 90
✅ Matches (<€5): 84
⚠️ Minor adjustments (€5-€50): 4
🔴 Significant changes (>€50): 2

Details of flagged items:
  ⚠️ AMZ UK Jan PPC: DB=-€11,042 → Scrape=-€11,055 (Δ=-€13)
  🔴 AMZ DE Mar Fees: DB=-€8,960 → Scrape=-€9,015 (Δ=-€55)
```

### Error Handling
- If login fails, report immediately — do NOT retry (password may have changed)
- If a market fails to scrape, log error with screenshot and continue with next market
- If account switch fails, report that US markets could not be scraped
- Take a screenshot on any failure for debugging

### Important Notes
- The computer use connection ID is: `conn_htp1rsc9jwmzgrwgkdwf`
- Supabase project_id: `zlteahycfmpiaxdbnlvr`
- Sellerboard is a jQuery/AngularJS SPA — always navigate via about:blank first to reset state
- The P&L table shows "Last 12 months, by month" by default — this is exactly what we want
- Currency values appear with € or $ prefix — this is expected
- **Canada data is in USD** — do not convert, just note it
