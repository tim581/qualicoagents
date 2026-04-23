# 💌 Email Asst

**Version**: v6.1 (2026-04-23)  
**Status**: CRITICAL BUG FIXED — Label application now verified

## Overview

Systematic daily email processing agent running at 12:00 Brussels time. Handles:
- Invoice downloading, renaming, forwarding, and payment status checking
- Intelligent email labeling (Invoices, Operations, Accounting, Finance, Sales & Marketing, Bauwee)
- Braintoss routing (calendar/tasks)
- Action-required email conversion to Asana tasks
- Monthly accounting task assistance
- Large non-EUR invoice cash flow management
- Spam filtering and deduplication

## Critical Protocols

### Invoice Processing
- **With attachment**: Label → Download → Rename (YYMMDD SUPPLIER AMOUNT INV#) → Upload to Drive → Forward to both accounting emails → Post Slack notification → Archive
- **Without attachment**: Label → Create Asana task in Accounting > Invoicing → Archive
- **Large non-EUR (≥1000)**: Save to `large_pending_invoices` DB → Hold payment until supplier reminder
- **Payment failures**: Label ONLY, keep in inbox, NEVER process through invoice flow

### Email Labeling (Content-Based)
- **Invoices**: Receipts, payment content, payment failures (label only, no processing)
- **Operations**: Logistics, suppliers, 3PL selection, fulfillment providers
- **Accounting, Legal & HR**: Contracts, legal, HR, taxes, compliance
- **Finance & Funding**: Banking, funding, investments
- **Sales & Marketing**: Customer-facing deals, campaigns
- **Bauwee**: Bauwee-related content

### Deduplication (3-Pass System)
- **Pass 0**: Invoices-specific + universal payment reminder rule (any vendor's payment reminders → keep newest only)
- **Pass 1**: Exact duplicates (same sender + subject) → keep newest, archive older
- **Pass 2**: Reminder chains (escalating topics) → keep latest, archive earlier

## Critical Bug & Fix (v6.1)

**Issue**: Subagent v3.3 recorded emails as "processed" in database but **NEVER APPLIED GMAIL LABELS**. 8 emails remained unlabeled in Primary inbox despite being marked processed.

**Root Cause**: Subagent markdown documented label API calls as instructions but didn't execute them. Tool invocations were failing silently.

**Fix Applied**:
1. Manually labeled all 8 affected emails
2. Added explicit VERIFICATION STEP (STEP 1.3b) requiring confirmation that Gmail label was ACTUALLY APPLIED before marking email processed
3. Added retry logic with exponential backoff for failed label applications

**Testing**: Tomorrow's 12:00 run (April 24) will validate label application verification. If labels still fail, escalation to Asana task.

## System Architecture

### Scheduled Runs
- **Trigger**: `cronScheduler` (cti_djezvq0jzb7be1dry543) — 12:00 daily, Europe/Brussels
- **Subagent**: `/agent/subagents/email-assistant.md` (v3.3+ with verification)
- **Database**: Internal `processed_emails` table (deduplication only)

### Processing Pipeline (v3.3+)
1. READ from Supabase (`shared_knowledge` + `agent_requests`)
2. Pass 0 — Invoices-specific deduplication
3. Pass 1 & 2 — General deduplication
4. **STEP 1 — Systematic per-email processing**:
   - Find ALL unlabeled emails via combined search queries
   - For EACH email apply guards (spam, auto-generated, Amazon FBA, payment failures, Braintoss, Xerius, invoices)
   - If no guard matches → read content, classify, apply label
   - **STEP 1.3b — VERIFICATION**: Confirm label was applied in Gmail before recording as processed
   - Record in DB
5. Re-label threads that changed topics
6. Scan spam folder for legitimate emails
7. Scan for supplier follow-ups on tracked invoices
8. Check sent items for missing follow-ups
9. Process invoices (with/without attachments)
10. Create Asana tasks for action-required emails
11. Check for Karlien's monthly accounting task emails
12. Process Braintoss emails
13. Handle non-Dutch/English operational emails
14. STEP 0c — Inbox cleanup (runs last if token budget allows)
15. WRITE to Supabase findings
16. Post Slack summary (08:00-20:00 only)

## Key Connections & Resources

**Email**: Gmail (conn_rqbhxnbt4b242v34h9hh)
- **CRITICAL**: Use `gmail_create_draft` ONLY, NEVER `gmail_send_message`

**Google Drive**:
- Invoices folder: https://drive.google.com/drive/folders/1cblHtaCN0djNUKX1DNj_RVF2grFVi_IM
- XERIUS NL: folder ID `1GhpQ-St5DZsG8n6odGuypARXUYizid0O`
- Agent output: `📤 Output` folder (ID: `1Sa2HCt4jfEI3AjMCE_1I5rtPrkjIO2ic`)

**Slack**:
- `#invoices` (C04NP9DG9QU) — tag Karlien with invoice updates
- `#email-assistant` (C0AHE0AKHTR) — run summaries (private, use sendAsUser: true)
- `#reporting` (C0A1XC5AKFT) — monthly accounting summaries for Karlien

**Asana**:
- Accounting: 1211747104935332 (Invoicing section: 1211747585503321)
- Finance: 1208634071347385 (large non-EUR invoices)
- Braintoss: default project
- Custom fields: Email 1 (1211578290837615), URL 1 (1211747687568231)

**Gmail Label IDs**:
- Invoices: `Label_29`
- Operations: `Label_43`
- Accounting, Legal & HR: `Label_28`
- Finance & Funding: `Label_45`
- Sales & Marketing: `Label_46`
- Bauwee: `Label_25`

## Known Issues & Pending Work

- ⚠️ `large_pending_invoices` DB has duplicate entries for WE PREP GBP amount — needs cleanup/merge
- ~21 older unlabeled emails (July 2025 - April 2026) still in inbox from pre-v3.3 era — can be labeled in next runs
- STEP 0c reliability secondary concern (runs last, skipped if token exhausted)

## Deduplication Examples

### Pass 0 — Universal Payment Reminder Rule
If multiple payment reminder/failure emails from ANY vendor (Airtable, Cloudinary, Notion, Microsoft, Shortwave, etc.):
- Keep ONLY the latest
- Archive all older ones
- No exceptions

### Pass 1 — Exact Duplicates
- Same sender + same subject → keep newest, archive older
- Safety: Emails >14 days apart NOT considered duplicates
- Exception: Braintoss emails NEVER deduplicated

### Pass 2 — Reminder Chains
- Same sender + escalating topic (e.g., "betaling mislukt" → "2e poging" → "3e poging")
- Keep only latest, archive earlier
- Safety: >14 days apart or different invoice numbers → NOT consolidated

## Recent Changes

**v6.1 (April 23, 2026)**
- CRITICAL BUG FIX: Label application failure. Added STEP 1.3b verification requiring confirmation that Gmail label was actually applied before marking email processed. Added retry logic with exponential backoff.

**v6.0 (March 11, 2026)**
- Directives #13–#16 compliance: Network Listener removed (system deprecated), Gmail-only drafts enforced, NFD principle reinforced.

**v5.9 (April 2026)**
- Systematic processing redesign: v3.3 pipeline replaces v3.2 special-case handlers with deterministic per-email loop. Every unlabeled email guaranteed to be processed.

**v5.8 (March 2026)**
- Three-pass deduplication system (Pass 0 Invoices-specific + universal vendor rules, Pass 1 exact duplicates, Pass 2 reminder chains).
- Calendar creation bug fix (Braintoss only).
- Payment failure Asana duplication fix.

## Contact

Agent registered in Supabase as "💌 Email Asst".  
Directly managed by Tim.  
Coordinates with Karlien (accounting) via Slack notifications and Asana task assignments.
