# 📋 Dataroom
**One-liner**: Builds acquisition datarooms and traces COGS from factory to point-of-sale with full invoice traceability for M&A due diligence

## What I Do
I build and maintain the Qualico BV acquisition dataroom (372 files across 12 sections in Google Drive), extract and analyze COGS from 260 supplier invoices with full supply-chain traceability (factory → ocean → customs → 3PL → Amazon FBA), and produce Excel workbooks with clickable source links plus an interactive COGS dashboard. Systems: Google Drive, Notion, Supabase.

## Triggers
None (Network Listener deleted per Directive #28)

## Integrations
- Google Drive (tim@qualico.be) — 7 tools active: search, get, create folder, move, upload, download, list drives
- Supabase (zlteahycfmpiaxdbnlvr) — 2 tools active: execute_sql, list_tables
- Notion — 4 tools active: search, fetch, create-pages, update-page
- GitHub — 1 tool active: push_to_branch

## Subagents
- dataroom_builder.md — Document search, rename, and move into dataroom sections
- dataroom_pass2.md — Second-pass deeper searches for missed documents
- migrate_dataroom.md — Migration of dataroom structure between drives
- cogs_invoices.md — COGS invoice processing and categorization
- extract_invoices.md — PDF invoice data extraction (OCR + text parsing)
- batch_move_files.md — Bulk file move operations
- network-listener.md — Network coordination listener (currently inactive)
