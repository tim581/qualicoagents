# Airtable Agent Requests System - Complete Setup Guide

**Status**: ✅ LIVE - March 12, 2026  
**Replaces**: Deprecated Supabase `agent_requests` system  
**Location**: Airtable Tasklet Base

---

## Quick Access

| Item | Value |
|------|-------|
| **Base Name** | Tasklet Base |
| **Base ID** | appW71PeNcSqB2CpL |
| **Table Name** | Agent Requests |
| **Table ID** | tblSKutgtEYIE9rdY |
| **Direct URL** | https://airtable.com/appW71PeNcSqB2CpL/tblSKutgtEYIE9rdY |

---

## Table Structure

### Required Fields (Fill These)
1. **Name** (singleLineText)
   - Brief title of your request
   - Example: "Fix billing export formatting"

2. **Agent Name** (singleLineText)
   - Your agent name WITH emoji
   - Example: "💰 Accounting"

3. **Request Type** (singleSelect)
   - Options: Bug Fix, Data Request, Feature, Analysis, Integration, Configuration
   - Choose the one that best fits

4. **Priority** (singleSelect)
   - Options: Low, Medium, High, Urgent
   - Low = can wait weeks
   - Medium = within 1-2 weeks
   - High = within 2-3 days
   - Urgent = within 24 hours

5. **Notes** (multilineText)
   - Full description of what you need
   - Include context, background, what's broken/needed
   - Include examples if relevant
   - Include any supporting links/data

6. **Target Delivery Date** (date)
   - When you need this (optional but recommended)
   - Helps Tim prioritize

### Status Field (Tim Manages This)
- **Todo** = New request, not started
- **In progress** = Tim is working on it
- **Done** = Completed, delivered

### Optional Fields
- **Assignee**: Who it's assigned to (Tim can set this)
- **Attachments**: Upload files if needed
- **Attachment Summary**: AI-generated summary of files

---

## How Agents Use This

### Create a Request

**Via Airtable UI** (simplest):
1. Open https://airtable.com/appW71PeNcSqB2CpL/tblSKutgtEYIE9rdY
2. Click "+ Add record"
3. Fill in the required fields
4. Done! Tim will see it immediately

**Via Airtable API**:
```bash
curl -X POST https://api.airtable.com/v0/appW71PeNcSqB2CpL/tblSKutgtEYIE9rdY \
  -H "Authorization: Bearer YOUR_AIRTABLE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "fields": {
        "Name": "Fix billing export formatting",
        "Agent Name": "💰 Accounting",
        "Request Type": "Bug Fix",
        "Priority": "High",
        "Notes": "CSV export has encoding issues with special characters in product names. This breaks downstream invoice processing. Test file attached.",
        "Target Delivery Date": "2026-03-14"
      }
    }]
  }'
```

**Via Tasklet Tools** (using Airtable connection):
```javascript
// If your agent has the Airtable connection activated
// Use remote_http_call to POST to the API endpoint above
```

### Monitor Your Requests

1. **Check Airtable directly**: https://airtable.com/appW71PeNcSqB2CpL/tblSKutgtEYIE9rdY
2. **Filter by Agent Name**: See only your requests
3. **Watch Status column**: When status changes to "In progress" or "Done", Tim is responding
4. **Read Notes when Done**: Tim leaves updates in the Notes field or comments

### Examples of Good Requests

**Bug Fix Request**:
```
Name: "Dashboard crashes when exporting PDF"
Agent Name: "📊 Analytics"
Request Type: "Bug Fix"
Priority: "High"
Notes: "The export PDF button on the analytics dashboard throws 500 error. 
Happens on all exports. Blocks weekly reporting. 
Error log shows: 'LibreOffice not available on server'. 
Needs server-side config fix or alternative PDF library."
Target Delivery Date: "2026-03-13"
```

**Data Request**:
```
Name: "Q1 2026 historical supplier pricing"
Agent Name: "🔍 Research"
Request Type: "Data Request"
Priority: "Medium"
Notes: "Need historical pricing data for all suppliers (Q1 2024 - Q1 2026) 
for cost trend analysis. Should include: supplier_id, product_code, price_per_unit, 
date_effective, currency. Format: CSV or Sheets URL. 
Roughly 500-1000 rows expected."
Target Delivery Date: "2026-03-20"
```

**Feature Request**:
```
Name: "Add email validation to contact forms"
Agent Name: "🌐 Website"
Request Type: "Feature"
Priority: "Medium"
Notes: "Current contact forms accept invalid emails. 
Need real-time validation using email service (e.g., Sendgrid's validation API). 
Reduces fake form submissions and improves contact quality."
Target Delivery Date: "2026-03-31"
```

---

## Important Rules

### ✅ DO:
- Fill all required fields completely
- Be specific in Notes (Tim can't read minds)
- Include context and why you need it
- Set realistic Target Delivery Dates
- Update your request with progress if needed
- Check for responses 1-2x per day

### ❌ DON'T:
- Leave Notes blank (Tim won't know what you need)
- Use vague titles ("Help" or "Urgent thing")
- Create multiple requests for the same issue (consolidate into one)
- Assume urgent delivery (set Priority appropriately)
- Leave old requests hanging (mark Done or close them)
- Try to modify Status (Tim manages that)

---

## How Tim Uses This

### Tim's Workflow
1. **Sees all requests** at https://airtable.com/appW71PeNcSqB2CpL/tblSKutgtEYIE9rdY
2. **Filters by Priority** and **Request Type** to prioritize
3. **Updates Status** as he works:
   - Sets to "In progress" when starting
   - May add comments with updates
   - Sets to "Done" when complete
4. **Agents know**: When your request status changes, Tim has news

---

## Example Request Timeline

```
09:15 AM   Agent creates request: "Fix CSV export encoding issue"
           Status: Todo, Priority: High

11:30 AM   Tim sees request in Airtable
           Reads the Notes
           Sets Status: In progress
           Adds comment: "Found the issue - config file update needed"

03:45 PM   Tim completes the fix
           Sets Status: Done
           Adds comment: "Fixed on staging. Test with sample file: [link]"

Next check  Agent sees Status: Done
           Reads Tim's notes
           Tests the fix
           Confirms it works
```

---

## Comparison: Old vs New System

| Aspect | Old System (Supabase) | New System (Airtable) |
|--------|---------------------|----------------------|
| **Location** | Supabase `agent_requests` table | Airtable Tasklet Base |
| **Visibility** | Requires SQL knowledge | Simple table view |
| **Status tracking** | Manual, unreliable | Automatic, clear |
| **Field structure** | Inconsistent | Standardized, validated |
| **Request types** | Mixed, confusing | Clear categories |
| **Tim's view** | Scattered across tables | Centralized Airtable |
| **Creation method** | SQL INSERT (complex) | UI or API (simple) |
| **Mobile friendly** | No | Yes (Airtable app) |

---

## Troubleshooting

**Q: I can't see Airtable Tasklet Base**
A: You may not have Airtable connection activated. Ask Multi Agent Mgr to grant access.

**Q: How do I know Tim saw my request?**
A: Check Status column. When Tim opens your request, Status will change from "Todo" to "In progress".

**Q: Can I modify my request after sending?**
A: Yes. Click the record, edit Name/Notes/Priority/Target Delivery Date. Tim may have already started, so avoid changing things unnecessarily.

**Q: What if I don't get a response in 2 days?**
A: Check if Status is "In progress" (Tim is working). If Status is still "Todo" after 2 days, @ mention Tim in Slack or send message directly.

**Q: Can multiple agents see all requests?**
A: Yes. Everyone can see everyone's requests. This is intentional - transparency. Your request is visible to the whole fleet.

**Q: Should I use this OR ask Tim directly in Slack/message?**
A: **Use this system** for any work requests. Direct communication is for urgent clarifications or quick questions. Work requests go in Airtable.

---

## Network Listener Integration

⚠️ **IMPORTANT**: The Airtable request system is NOT checked by Network Listener anymore.

**Why**: You can see Airtable directly (it's real-time). Periodically checking is unnecessary.

**What to do**:
- Remove old Supabase `agent_requests` queries from your Network Listener
- Instead, check Airtable directly 1-2x per day
- Or set up Airtable email notifications to alert you when Status changes

**Example Airtable Notification**:
1. Open Airtable table
2. Click expand (if it shows notifications)
3. Set up: "Email me when Status changes on my Agent Name"

---

## Migration from Old System

**If you have pending requests in old Supabase system**:
1. Note down the details
2. Create new record in Airtable with same info
3. Mark old Supabase request as archived/ignored
4. Tim will see the Airtable version and respond there

**Timeline for migration**: March 12-15, 2026 (agents migrate old requests)

---

## API Details (for Agents Who Code)

### Headers Required
```
Authorization: Bearer [YOUR_AIRTABLE_API_TOKEN]
Content-Type: application/json
```

### Create Record
```
POST https://api.airtable.com/v0/appW71PeNcSqB2CpL/tblSKutgtEYIE9rdY
```

### List Records
```
GET https://api.airtable.com/v0/appW71PeNcSqB2CpL/tblSKutgtEYIE9rdY
```

### Update Record
```
PUT https://api.airtable.com/v0/appW71PeNcSqB2CpL/tblSKutgtEYIE9rdY/[recordId]
```

### Filter Examples
```
# Get only YOUR requests
GET ...?filterByFormula={Agent Name}="💰 Accounting"

# Get only Urgent + High priority
GET ...?filterByFormula=OR({Priority}="Urgent",{Priority}="High")

# Get only Done requests
GET ...?filterByFormula={Status}="Done"
```

---

## Support

- **Airtable documentation**: https://airtable.com/developers/web/api/introduction
- **Base access**: Contact Multi Agent Mgr
- **API token**: Ask Tim for your personal API token (don't hardcode Tim's token)

---

**System Status**: ✅ LIVE  
**Last Updated**: March 12, 2026  
**Maintained By**: Multi Agent Mgr  
**Broadcast**: Directive #19 to all agents