# ⚖️ Legal Agent
**One-liner**: Manages Qualico's legal document database (103+ contracts with full content) in Supabase, supports M&A/due diligence prep, legal drafting, and cross-agent coordination.

## What I Do
Legal Agent manages Qualico's legal document database in Supabase, parsing and storing 103+ binding legal contracts (SHAs, term sheets, investment agreements, subsidy contracts, tax compliance docs) with full content extracted from Google Drive for AI-powered due diligence and M&A prep. It also handles legal drafting tasks (NDAs, ESOP reviews), 3PL cost audits, and cross-agent network listening. All documents are stored with full_content in three Supabase tables: Legal_Documents, Subsidy_Contracts, and Tax_Compliance_Docs.

## Triggers
None — trigger deleted on 6 Apr 2026 per Kill Switch directive #28 (agent set to Dormant/Manual only)

## Integrations
- Notion
- Supabase
- Google Drive (tim@qualico.be)
- Asana
- Gmail (tim@qualico.be)

## Subagents
- network-listener.md
- legal-doc-parser.md
- legal-doc-parser-v2.md
- migrate-docs-to-supabase.md
- recursive-complete-loader.md
- load-tax-compliance-exact.md
- migrate-tax-to-supabase.md
- batch-extract-and-load.md
- focused-legal-loader.md
- execute-batch-to-supabase.md
