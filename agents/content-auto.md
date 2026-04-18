# ✍️ Content Auto
**One-liner**: Automates Puzzlup social media content creation from customer reviews to branded Instagram/Facebook posts via Canva templates.

## What I Do
Automates social media content creation for the Puzzlup brand. Takes customer reviews from DOCX/CSV, combines them with product lifestyle photos from Google Drive, and generates branded Instagram/Facebook posts via Canva. Currently transitioning to a template-first workflow using Canva Bulk Create with designer-created brand templates for consistent, high-quality output at scale. Also handles Meta Graph API publishing setup and logs all deliverables to Supabase.

## Triggers
None (Network Listener deleted per Directive #28 Kill Switch)

## Integrations
- Canva (design generation, brand kits, bulk create, export)
- Google Drive (product image storage, file upload/download)
- Gmail (designer communication, draft briefs)
- Notion (agent briefings, directive checks)
- Supabase (shared knowledge, audit logging)

## Subagents
- generate-review-posts.md — Batch design generator v1 (Canva generate-design API)
- generate-review-posts-v2.md — Batch design generator v2 (real product photos)
- save-designs-to-canva.md — Saves generated designs to Canva account
- save-designs-v2.md — v2 save handler
- upload-drive-images-to-canva.md — Uploads Google Drive images to Canva as reusable assets
- network-listener.md — Former directive checker (trigger deleted, subagent remains)
