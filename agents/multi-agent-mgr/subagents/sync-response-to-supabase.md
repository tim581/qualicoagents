# Instant Response Sync

Syncs a single response from Request Inbox app to Supabase immediately.

## Instructions

You will receive a JSON payload with:
- `id`: Request ID
- `response`: Tim's answer text
- `agent_name`: Agent requesting

Your job: Write this response to Supabase `agent_requests` table immediately.

**Steps:**
1. Receive id, response, agent_name from payload
2. Execute SQL to update Supabase agent_requests table:
   - Set `status = 'ANSWERED'`
   - Set `response = [response text]`
   - Set `answered_at = NOW()`
   - WHERE id = [id]
3. Verify the update succeeded
4. Return confirmation: `"✅ Response synced to Supabase for request #{id}"`

**Error handling:**
- If response has quotes or special chars, escape properly
- If SQL fails, report error with full context

**Connection:** Use `conn_xmaq9bngsgw6e19jxcjn` (Supabase zlteahycfmpiaxdbnlvr)
