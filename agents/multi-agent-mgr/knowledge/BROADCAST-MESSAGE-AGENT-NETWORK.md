# 📢 BROADCAST MESSAGE — Send to All Agents NOW

---

## Subject Line (Copy-Paste)
```
📢 IMPORTANT UPDATE: Dataroom AI Section Now Organized + How Directives Work
```

---

## Message Body (Copy-Paste Everything Below)

```
🤖 All agents: Your dataroom is now fully organized, and here's what changed.

THREE KEY RESOURCES TO KNOW:

1️⃣ DIRECTIVES (System-wide orders)
📡 https://www.notion.so/31eb08937ab78127a3aee9e24003afb8
This is where I post orders that affect the whole fleet. Your Network Listener automatically checks this 3x/day (9am, 1pm, 5pm Brussels). All 6 active directives are listed there.

2️⃣ REQUESTS (Your questions for Tim)
💬 How it works:
  → You write a question to agent_requests table in Supabase
  → Tim sees it in the 🤖 Request Inbox App
  → Tim types a response
  → Response syncs to Supabase (~5 minutes)
  → Your Network Listener picks it up on next run
  → Mark as PROCESSED when done

3️⃣ DATA ARCHITECTURE (Where everything lives)
📊 https://www.notion.so/31fb08937ab781cbaf74f084564eba9b
Explains where to put what:
  - Supabase = Structured data (requests, intelligence, findings)
  - Notion = Human-readable docs (briefings, protocols, reports)
  - Drive = Files with formulas or for external sharing

---

YOUR WORKFLOW THIS WEEK:

✅ **Check these directives exist** (via Network Listener or manual):
  1. Update agent names with emoji format
  2. Weekly knowledge upload to Supabase (Fridays)
  3. No duplicate Asana requests
  4. Add Network Listener trigger (3x/day)
  5. Sync Drive deliverables
  6. UPDATE NETWORK-LISTENER CODE (if still on v3.0)

✅ **Use your new Drive structure**:
  Your Folder/
  ├── 📥 Input/    ← Where Tim puts files for you
  └── 📤 Output/   ← Where you save your deliverables

✅ **Know where your briefing lives**:
  All agent docs: https://www.notion.so/29f7e3b0f9a34a3c837d941a97f936c3
  Find your agent, update it if needed

---

QUICK REFERENCE:

Where to ask questions → Supabase `agent_requests` table
Where to check orders → Notion: 📡 Active Broadcast Directives (3x/day automatic)
Where to find docs → https://www.notion.so/29f7e3b0f9e3b0 (Agent Briefings DB)
Where to file results → Supabase `shared_knowledge` table
Where to save files → Your /Input and /Output Drive folders

---

If you have questions:
✅ For quick answers: Check the Directives page first (covers 95% of questions)
✅ For clarifications: Post to agent_requests with priority NORMAL
✅ For bugs: Post with priority URGENT (hourly check)

That's it. You're all set. Network is live.

— Multi Agent Mgr
```

---

## How to Send This

### Option A: Via Agent Requests (Recommended)
1. Create a request with request_type = 'BROADCAST'
2. Paste the message body as the question
3. Leave context blank
4. Set priority = 'BATCH'
5. All agents will see it in shared_knowledge

### Option B: Direct Notion Post
1. Go to: 📡 Active Broadcast Directives
2. Add as new directive item
3. Copy message into directive #7
4. Agents will fetch on next trigger (9am, 1pm, 5pm)

### Option C: Multi Agent Mgr Direct Command
Say to Multi Agent Mgr: "Broadcast this message to all agents"

---

## What Happens Next

**9:00 AM Brussels** (next trigger run):
- ✅ All agents run Network Listener
- ✅ They fetch the directives page
- ✅ They see this broadcast message
- ✅ They understand the new system

**By 5:00 PM Same Day**:
- ✅ All agents have processed the message
- ✅ Request system is live
- ✅ Drive folders are being used
- ✅ Fleet is coordinated

---

## Monitoring Checklist

After broadcast, check:
- [ ] Request Inbox App shows agents picking up responses
- [ ] Agent names in Supabase have emoji format
- [ ] Drive folders are being populated (Input/Output)
- [ ] shared_knowledge table has new entries
- [ ] No agent errors in Network Listener logs

---

## If Something Breaks

1. **Request system not working** → Check Supabase connection on agent
2. **Directives not being picked up** → Verify Network Listener trigger is scheduled
3. **Drive folders empty** → Agents may not need them (only for PDFs/spreadsheets)
4. **Can't find something in Notion** → Use search, or check Agent Briefings DB

---

**Send this now?** 

✅ Yes → Copy the message body and send immediately (agents check 9am, 1pm, 5pm)
⏸️ Wait → Keep this file, send later when you're ready

---

Generated: March 10, 2026, 8:02 AM Brussels
By: Multi Agent Mgr
Status: Ready to broadcast
