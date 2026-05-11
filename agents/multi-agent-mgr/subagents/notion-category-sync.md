# Notion Agent Briefings Category Sync

Updates the Category field options in the Ai Agent Briefings Notion database to match the 8-department structure, then reclassifies every page with the correct new department.

## Instructions

You have access to Notion via conn_1ykn33de2j69hkpfvg5r.

### Step 1 — Update the data source Category options

Update the data source `e35ec83b-91cb-4846-8ab2-5c06712cbf62` to replace the old Category options with the 8 new department options.

Use this DDL:
```
ALTER COLUMN "Category" SET SELECT('Finance & Accounting':green, 'Legal & Compliance':yellow, 'Operations':blue, 'Marketing & Sales':purple, 'HR & People':pink, 'eCommerce & Product':orange, 'IT & Infrastructure':red, 'Personal':default)
```

### Step 2 — Update each agent's Category property

Update each of the following pages using the notion-update-page tool with command `update_properties`.

Use EXACTLY these page IDs and category values:

**💰 Finance & Accounting:**
- `319b0893-7ab7-81b8-afb5-eb74ac260363` → CFO Financial Reporting — Category: "Finance & Accounting"
- `319b0893-7ab7-8128-9d95-dce037f595df` → COGS & Financial Planning — Category: "Finance & Accounting"
- `319b0893-7ab7-81a2-b45e-c661bea662b7` → Finance & Ad-Hoc Operations — Category: "Finance & Accounting"
- `319b0893-7ab7-81bc-b8ab-c0a80f46a28c` → Qualico Investor & Finance — Category: "Finance & Accounting"
- `319b0893-7ab7-81ba-bd0b-c59bada24280` → M&A Outreach & Acquisition Pipeline — Category: "Finance & Accounting"

**⚖️ Legal & Compliance:**
- `319b0893-7ab7-8103-b41a-cc0ec69b6d23` → IP Manager & Dataroom — Category: "Legal & Compliance"
- `319b0893-7ab7-814f-a6fa-fe104eccd7db` → Insurance Manager — Category: "Legal & Compliance"
- `319b0893-7ab7-811e-9f5e-f7d43ab1c581` → Acquisition Dataroom & COGS Analysis — Category: "Legal & Compliance"

**⚙️ Operations:**
- `317b0893-7ab7-8133-82bc-fc54a879c748` → Asana & Inbox Operations — Category: "Operations"
- `317b0893-7ab7-81e5-bac0-eaeefb6e0284` → Road Transport & Logistics Monitor — Category: "Operations"
- `317b0893-7ab7-81a0-a077-d5f551a8d587` → Postal Document Processing — Category: "Operations"
- `317b0893-7ab7-816e-a1a3-f6007cabfae9` → Email Assistant (tim@qualico.be) — Category: "Operations"

**📣 Marketing & Sales:**
- `319b0893-7ab7-81d9-807c-c641c4dca213` → Qualico Brand Knowledge — Category: "Marketing & Sales"
- `319b0893-7ab7-8127-8c02-c720cbc969fc` → Bauwee Brand Manager — Category: "Marketing & Sales"
- `319b0893-7ab7-8169-a01b-d76e3edcd567` → Puzzlup Brand Knowledge Hub — Category: "Marketing & Sales"
- `319b0893-7ab7-819e-9bd5-c54c7b098ff9` → Puzzlup Content Automation — Category: "Marketing & Sales"

**🛒 eCommerce & Product:**
- `317b0893-7ab7-814d-bc5f-c6308a4bd05d` → Puzzlup Price & Buy Box Monitor — Category: "eCommerce & Product"
- `319b0893-7ab7-81af-ac52-d3c181e4a74e` → Customer Service Agent — Category: "eCommerce & Product"
- `319b0893-7ab7-81d1-a5e8-c60b31d4163f` → Inventory Tracking Agent — Category: "eCommerce & Product"

**🔧 IT & Infrastructure:**
- `318b0893-7ab7-811b-8265-f242102e956e` → Multi Agent Mgr — Category: "IT & Infrastructure"

**👤 Personal:**
- `317b0893-7ab7-8188-990b-c42e505a3ea6` → Personal Assistant & Daily Briefing — Category: "Personal"
- `317b0893-7ab7-8137-9d5a-cc12c464e1ec` → Personal Mail Auto-Labeler — Category: "Personal"
- `317b0893-7ab7-81cb-a83f-e7241685a964` → Personal Coach & Habit Reminder — Category: "Personal"
- `319b0893-7ab7-81e4-bbea-e1b7d04a8bd2` → Tim Huybrechts Personal Knowledge — Category: "Personal"
- `319b0893-7ab7-81d2-a2e0-e15d556eb952` → Personal Finance & Investment — Category: "Personal"
- `319b0893-7ab7-8159-96b0-faee95388159` → Health & Bloodwork Dashboard — Category: "Personal"
- `319b0893-7ab7-814e-9372-f14b6f9a81d0` → Personal Google Drive Organizer — Category: "Personal"
- `319b0893-7ab7-81a1-86e2-f0fbf575a773` → Learning Hub — Category: "Personal"

### Step 3 — Report results

Return a summary: how many pages were updated successfully, and any that failed with the error message.
