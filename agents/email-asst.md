# 💌 Email Asst

**Version**: v6.2 (2026-04-27)  
**Status**: CRITICAL BUG FIX — Subagent now enforces actual label API execution with verification

## Overview

Systematic email processing agent (on-demand, no longer scheduled). Handles:
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

## Critical Bug & Fix (v6.2 — April 27, 2026)

**ISSUE**: Subagent v3.3 claimed to label emails but **did NOT actually apply Gmail labels**. 20+ emails remained unlabeled in Primary inbox despite being marked "processed" in database.

**Root Cause**: 
- Subagent markdown documented label steps as instructions but didn't execute them
- Emails were found, classified correctly, and recorded in DB
- But `conn_rqbhxnbt4b242v34h9hh__gmail_modify_message_labels` was never called
- STEP 1.3b (label verification) was documented but never executed

**Fix Applied (April 27, 2026)**:
1. Added **CRITICAL ENFORCEMENT** section to subagent STEP 1 making it absolutely clear that actual API calls are mandatory, not optional
2. Specified **batch size max 5 emails** to ensure verification can happen between batches
3. Specified **explicit verification requirement**: Search Gmail after each label batch to confirm label ID appears in labelIds array
4. Added **mandatory retry** logic: If verification fails, immediately retry before moving to next email
5. Manually labeled 8+ affected emails from 27 April to clear Primary inbox
6. Tested that labels persist in Gmail (verified via search results)

**Testing Status**: Subagent redesigned with enforcement; next run will test whether labels are actually applied.

## System Architecture

### Execution
- **Trigger**: On-demand (user runs manually via Tasklet UI)
- **Subagent**: `/agent/subagents/email-assistant.md` (v3.3+ with CRITICAL enforcement)
- **Database**: Internal `processed_emails` table (deduplication only)

### Processing Pipeline (v3.3+)
1. READ from Supabase (`shared_knowledge` + `agent_requests`)
2. Pass 0 — Invoices-specific deduplication
3. Pass 1 & 2 — General deduplication
4. **STEP 1 — Systematic per-email processing**:
   - Find ALL unlabeled emails via combined search queries
   - For EACH email apply guards (spam, auto-generated, Amazon FBA, payment failures, Braintoss, Xerius, invoices)
   - If no guard matches → read content, classify, apply label
   - **CRITICAL**: Call `gmail_modify_message_labels` API (batch max 5)
   - **VERIFY**: Search Gmail to confirm label appears in labelIds
   - **RETRY**: If verification fails, immediately retry
   - Record in DB ONLY after verification succeeds
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
- Draft URL must be returned to user immediately after creation

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
- ⚠️ Some emails from 27 April over-labeled (got extra Label_29) during cleanup — need selective removal
- ~50+ older unlabeled emails (July 2025 - April 2026) still in inbox from pre-v3.3 era — will be labeled in next runs

## Recent Changes

**v6.2 (April 27, 2026)**
- CRITICAL: Subagent enforcement rewrite. Root cause identified: subagent documented API calls but never executed them. Enforcement section added making actual API calls mandatory, batch size capped at 5, verification required before DB recording. 8+ emails manually labeled to clear backlog.

**v6.1 (April 23, 2026)**
- CRITICAL BUG FIX: Label application failure. Added STEP 1.3b verification requiring confirmation that Gmail label was actually applied before marking email processed. Added retry logic with exponential backoff.

**v6.0 (March 11, 2026)**
- Directives #13–#16 compliance: Network Listener removed, Gmail-only drafts enforced, NFD principle reinforced.

**v5.9 (April 2026)**
- Systematic processing redesign: v3.3 pipeline replaces special-case handlers with deterministic per-email loop.

## Contact

Agent registered in Supabase as "💌 Email Asst".  
Directly managed by Tim.  
Coordinates with Karlien (accounting) via Slack notifications and Asana task assignments.
