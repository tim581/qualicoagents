# 🎬 Browser Automation Scripts Overview

**Framework:** Playwright | **Language:** JavaScript | **Status:** Production Ready

---

## 📋 Quick Reference

| Script | Purpose | Status | Run |
|--------|---------|--------|-----|
| **playwright-task-executor.js** | Main orchestrator | ✅ Core | `node playwright-task-executor.js` |
| **playwright-render-service.js** | JS rendering → Supabase cache | ✅ Utility | `node playwright-render-service.js <URL>` |
| **price-monitor-scraper.js** | Weekly Puzzlup price & Buy Box monitor | ✅ Production | via task executor |

---

## 🚀 Core Scripts (Actually Executable)

### 1. **playwright-task-executor.js** — Task Orchestrator (v3.4)
**The main Playwright automation engine that runs on your PC.**

#### What it does:
- Polls Supabase `Browser_Tasks` table every 30 seconds
- Executes tasks mapped to specific scripts (see table below)
- Manages Chromium browser lifecycle + persistent context (cookies/sessions saved!)
- Routes scripts to either **module.exports pattern** (injected context) or **standalone** (node subprocess)
- Downloads latest scripts from GitHub (with fallback to local)
- Captures screenshots to Supabase for debugging

#### Supported Task Types:
```
forecast-sync              → flieber-forecast-updater.js
forecast-verify            → flieber-forecast-verifier.js
po-simulation              → flieber-replenishment-simulator.js
to-simulation              → flieber-replenishment-simulator.js
corax-stock-export         → corax-wms-stock-export.js
mintsoft-product-export    → mintsoft-product-export.js
forceget-inventory-export  → forceget-inventory-export.js
sellerboard-pl-export      → sellerboard-pl-export.js
inventory-sync-forceget    → inventory-sync-forceget.js
inventory-sync-kamps       → inventory-sync-kamps.js
inventory-sync-mintsoft    → inventory-sync-mintsoft.js
forceget-inventory         → forceget-inventory.js
glc-inventory              → glc-inventory.js
kamps-inventory            → kamps-inventory.js
mintsoft-inventory         → mintsoft-inventory.js
sync-inventory             → sync-inventory.js
price-scrape               → price-monitor-scraper.js
bol-price-update           → bol-price-update.js
bol-cases-scrape           → bol-cases-scrape.js
```

#### How to run:
```bash
# Install dependencies
npm install playwright playwright-extra puppeteer-extra-plugin-stealth @supabase/supabase-js dotenv

# Create .env
SUPABASE_URL=https://zlteahycfmpiaxdbnlvr.supabase.co
SUPABASE_KEY=your_service_key

# Start polling
node playwright-task-executor.js
```

#### Key Features:
- ✅ Auto-downloads scripts from GitHub (skip via `USE_LOCAL_SCRIPTS=1`)
- ✅ Stealth mode (anti-detection plugin)
- ✅ Persistent context (cookies saved between runs!)
- ✅ Auto-loads storage state per `credentials_key`
- ✅ Screenshots for debugging via `dbShot()`
- ✅ Auto-chains forecast-sync → forecast-verify
- ✅ Timeout: 4 hours per task

---

### 2. **playwright-render-service.js** — Page Renderer (v1.0)
**Renders JS-heavy sites → uploads clean HTML to Supabase for agents to query.**

#### What it does:
- Launches Playwright → renders JavaScript
- Waits for network idle
- Uploads rendered HTML to `Rendered_Pages` table (7-day cache)
- Optional: login before rendering + custom wait time
- Saves 95% tokens vs AI parsing raw HTML

#### How to run:
```bash
# Simple render (no login)
node playwright-render-service.js "https://example.com"

# With login
node playwright-render-service.js "https://forum.example.com" \
  --login tim@qualico.be Reset123!

# With wait time (lazy-loaded content)
node playwright-render-service.js "https://example.com" --wait 3000

# Real example: eCommerceFuel member list
node playwright-render-service.js "https://forum.ecommercefuel.com/members" \
  --login tim@qualico.be Reset123! --wait 2000
```

#### Options:
```
--login EMAIL PASSWORD    # Login before rendering
--wait MS                 # Wait N milliseconds for content
--no-sandbox              # Docker/Linux mode
```

---

### 3. **price-monitor-scraper.js** — Puzzlup Price Monitor (v1.0)
**The big one: 80KB. Scrapes ~62 product variants across 11 sales channels weekly.**

#### What it does:
- **Amazon:** 10 marketplaces (DE, FR, ES, IT, BE, NL, US, CA, UK)
  - Persistent login (Belgian account)
  - Auto-sets delivery location per market
  - Extracts: price, Buy Box seller, rating, reviews, in-stock status
  - Handles suppressed listings (lowest-offer price extraction)
  
- **Bol.com:** JSON-LD parsing (ProductGroup with variants)
  - Extracts: price, rating, in-stock, D2C vs marketplace
  
- **Webshop (puzzlup.be):** JetWooBuilder HTML scraping
  - URL-slug mapping to product IDs
  - Price extraction with fallback strategies
  
- **Features:**
  - Live exchange rate conversion (EUR → GBP/USD/CAD)
  - Price change detection (vs last scrape)
  - Buy Box alerts (lost, suppressed, switched)
  - Upserts to `amazon_monitor_fba_puzzlup`
  - Updates `puzzlup_margins.price_incl_vat_local`
  - Logs to `Shared_Knowledge` for all agents

#### Run via task executor:
```bash
# Create task in Supabase Browser_Tasks:
{
  "task_type": "price-scrape",
  "url": "https://app.flieber.com",
  "actions": [],
  "credentials_key": "amazon_login",
  "status": "pending"
}

# Executor will pick it up in next poll (30s)
```

Or run standalone:
```bash
npm install playwright @supabase/supabase-js dotenv
node price-monitor-scraper.js
```

#### Output:
- 📊 Results table: `amazon_monitor_fba_puzzlup`
- 💾 Margin updates: `puzzlup_margins`
- 📝 Summary: `Shared_Knowledge`
- 🐛 Debug log: `Price_Monitor_Debug_Log` (with RUN_ID)

---

## 🛠️ Utility Scripts (Cookies & Helpers)

| Script | Purpose |
|--------|---------|
| **bol-partner-save-cookies.js** | Extract Bol.com session → storage state |
| **bol-test-cookies.js** | Verify Bol cookies work |
| **bol-cases-scrape.js** | Scrape Bol case studies |
| **bol-price-update.js** | Update Bol prices (26KB) |
| **amazon-seller-template.js** | Template for Amazon seller actions |
| **bol-seller-template.js** | Template for Bol seller actions |
| **convert-cookies.js** | Convert browser cookies format |
| **convert-amazon-cookies.js** | Amazon-specific cookie conversion |
| **forceget-save-cookies.js** | Extract Forceget session |
| **mintsoft-save-cookies.js** | Extract Mintsoft session |
| **sellerboard-save-cookies.js** | Extract Sellerboard session |
| **corax-wms-save-cookies.js** | Extract Corax WMS session |

---

## 📦 Inventory Sync Scripts

These pull inventory from various sources & sync to Supabase:

| Script | Source | Sync Target |
|--------|--------|-------------|
| **inventory-sync-forceget.js** | Forceget API | Supabase inventory |
| **inventory-sync-kamps.js** | Kamps WMS | Supabase inventory |
| **inventory-sync-mintsoft.js** | Mintsoft API | Supabase inventory |
| **forceget-inventory.js** | Forceget → fetch current |
| **kamps-inventory.js** | Kamps → fetch current |
| **mintsoft-inventory.js** | Mintsoft → fetch current |
| **glc-inventory.js** | GLC supplier |
| **sync-inventory.js** | Main sync orchestrator |
| **inventory-helpers.js** | Shared utility functions |
| **inventory-supabase.js** | Supabase sync helpers |

---

## 📊 Flieber Scripts (Forecast & Replenishment)

| Script | Purpose | Size |
|--------|---------|------|
| **flieber-forecast-updater.js** | Push forecast to Flieber | 41KB |
| **flieber-forecast-verifier.js** | Verify forecast updated | 20KB |
| **flieber-replenishment-simulator.js** | Simulate PO/TO generation | 42KB |

---

## 🐍 Python Scripts

| Script | Purpose |
|--------|---------|
| **to-calculator.py** | Calculate transfer order quantities (16KB) |

---

## 📁 Storage & Cookies

Auto-loaded by playwright-task-executor based on `credentials_key`:

```
scripts/
├── corax-wms-storage-state.json          # Corax session
├── mintsoft-storage-state.json           # Mintsoft session
├── forceget-storage-state.json           # Forceget session
├── sellerboard-storage-state.json        # Sellerboard session
├── flieber-storage-state.json            # Flieber session
└── .browser-data/                        # Chrome persistent context
```

---

## 🔑 Environment Variables

Create `.env` in scripts directory:

```bash
# Supabase
SUPABASE_URL=https://zlteahycfmpiaxdbnlvr.supabase.co
SUPABASE_KEY=your_service_role_key

# Optional
USE_LOCAL_SCRIPTS=1                       # Don't download from GitHub
BROWSER_TASK_ID=123                       # Set by task executor
RUN_MODE=po                               # For Flieber simulations (po|to)
MARKET_SCOPE=eu                           # For Sellerboard exports (eu|uk|us)
TASK_ACTIONS=["action1","action2"]        # For task routing
```

---

## 💻 How to Manage Scripts in GitHub (vs Cursor)

### ✅ GitHub Advantages:
1. **Centralized source of truth** — all agents see latest version
2. **Version history** — git blame + rollback
3. **Branching** — test changes before merging
4. **Task linking** — issues → scripts → PRs
5. **Automation** — GitHub Actions (CI/CD)
6. **Collaboration** — team reviews & comments

### Workflow:
```bash
# 1. Clone repo
git clone https://github.com/tim581/qualicoagents.git
cd qualicoagents

# 2. Create feature branch
git checkout -b feature/improve-price-monitor

# 3. Edit script
nano scripts/price-monitor-scraper.js

# 4. Test locally
node scripts/price-monitor-scraper.js

# 5. Commit & push
git add scripts/price-monitor-scraper.js
git commit -m "fix: improve Amazon location detection"
git push origin feature/improve-price-monitor

# 6. Create PR on GitHub for review
# 7. Merge to main
# 8. Task executor auto-downloads next run
```

---

## 🎯 Quick Start

### Run a single script now:
```bash
cd scripts
npm install
node playwright-render-service.js "https://puzzlup.be"
```

### Start the task executor (runs continuously):
```bash
cd scripts
npm install
node playwright-task-executor.js
# Waits for tasks in Supabase Browser_Tasks table...
```

### Create a browser task in Supabase:
```sql
INSERT INTO Browser_Tasks (
  agent_name,
  task_type,
  url,
  actions,
  credentials_key,
  status
) VALUES (
  'Tim',
  'price-scrape',
  'https://puzzlup.be',
  '[]'::jsonb,
  'amazon_login',
  'pending'
);
```

---

## 📚 Script Categories by Function

### **Authentication & Session Management**
- `*-save-cookies.js` — Extract & persist sessions
- `convert-cookies.js` — Cookie format conversion

### **E-Commerce Marketplaces**
- `bol-*.js` — Bol.com integration
- `amazon-*.js` — Amazon seller tools
- `price-monitor-scraper.js` — Multi-marketplace price tracking

### **Inventory Management**
- `inventory-sync-*.js` — Sync from various WMS/APIs
- `*-inventory.js` — Single-source inventory fetch
- `inventory-helpers.js` — Shared utilities

### **Forecasting & Planning**
- `flieber-*.js` — Demand forecasting & replenishment
- `to-calculator.py` — Transfer order math

### **Core Infrastructure**
- `playwright-task-executor.js` — Main orchestrator
- `playwright-render-service.js` — JS rendering utility

---

## 🐛 Debugging

### Enable verbose logging:
```bash
DEBUG=pw:api node scripts/playwright-task-executor.js
```

### Check task status in Supabase:
```sql
SELECT * FROM Browser_Tasks 
ORDER BY created_at DESC 
LIMIT 10;

SELECT * FROM Flieber_Debug_Log 
WHERE run_id = 'price_1718894023456' 
ORDER BY created_at DESC;
```

### View screenshots:
Screenshots saved to `Flieber_Debug_Log.screenshot` during execution.

---

## 🚀 Next Steps

1. **Review** the main three scripts above (task-executor, render-service, price-monitor)
2. **Run locally**: `node playwright-task-executor.js` to start polling
3. **Create a GitHub issue** for any script improvements
4. **Manage everything from GitHub** — no need for Cursor!

**Ready to switch from Cursor to GitHub for browser automation? 🎯**

---

*Last updated: 2026-06-12 | 34 Playwright scripts | ~500KB total | All production-ready*
