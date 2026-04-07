# 📊 COGS
**One-liner**: Automates end-to-end COGS landed cost tracking: inbox scanning → invoice classification → CBM-weighted allocation → Supabase → Vercel app review → COGS_Landed updates → Sellerboard sheet sync

## What I Do
Full COGS landed cost automation for Puzzlup/Qualico. Scans 2 Gmail inboxes weekly for supplier invoices (WeShip, IFB, Floormax, WePrep), classifies by actual content (never by label), allocates costs via CBM-weighted volume ratios from Supabase product data. Writes pending invoices to Supabase for Tim to review in the Vercel platform (`/finance/cogs`). On approval, moves invoice to final table, updates COGS_Landed weighted averages per product per region, and auto-syncs two Sellerboard Google Sheets (EUR for EU+UK, USD for US+CA). Maintains a 3-layer cost model (L0 factory, L1 factory→3PL, L2 3PL→FBA) across EU, UK, US, and Canada regions. Builds and maintains the COGS module on the qualico-platform Vercel app with 3 tabs: Landed Costs, Invoices, and New Invoices.

## Triggers
- **Weekly COGS invoice scan** — Every Monday at 9:00 AM CET, scans both inboxes with 14-day window
- **COGS invoice approval/comment webhook** — Fires when Tim approves or comments on a pending invoice in the Vercel app

## Integrations
- **Gmail** — invoices@qualico.be + tim@qualico.be (dual inbox scanning)
- **Supabase** — COGS_Landed, COGS_Invoices, COGS_Pending_Invoices, TO_Transfers, PO_Purchases, Emails_Processed, Puzzlup_Product_Info, Agent_Briefings, and more
- **Google Drive** — Invoice upload/download, 2026 COGS Invoices folder
- **Google Sheets** — Sellerboard EU+UK (EUR) & US+CA (USD) auto-sync after each COGS_Landed update
- **Slack** — Channel posting (minimal, mostly deprecated for COGS flow)
- **GitHub** — qualico-platform repo: PRs for COGS module, MarketDynamics fixes, feature branches
- **Notion** — Search, fetch, create/update pages
- **Computer Use** — Sellerboard browser automation
- **Airtable** — Legacy connection, fully deprecated for COGS

## Subagents
- `cogs-email-scanner.md` — Weekly inbox scanner with content-first classification
- `batch-invoice-parser.md` — PDF/Excel invoice parsing
- `sellerboard-sheet-sync.md` — Auto-sync COGS_Landed → Sellerboard Google Sheets (EUR + USD)
- `landed-cost-analysis.md` — 3-layer landed cost calculations
- `supabase-batch-loader.md` — Bulk data loading to Supabase
- `cogs-master-comparison.md` — COGS comparison analysis
- `update-sellerboard-sheet.md` — Sheet update helper
- `build-cogs-vercel-module.md` — Vercel COGS module builder
- `network-listener.md` — *(deprecated)*
- `update-notion-briefing.md` — *(deprecated)*
