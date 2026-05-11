# Broadcast Listener

Checks Supabase for new directives. If none found → abort (zero cost). If directives exist → route to all agents.

## Instructions

**Purpose**: Monitor Supabase `shared_knowledge` for broadcast directives and route them to agents efficiently.

**Early-exit optimization**: 
- Query for new directives (WHERE topic LIKE 'directive-%' AND broadcast_delivered = false)
- If result is empty → Log "No new directives" and EXIT immediately (zero cost)
- If directives found → Process and route

**Routing logic**:
1. For each new directive found:
   - Extract topic (e.g., "directive-weekly-knowledge-upload-march-2026")
   - Extract content from `value` field
   - Extract directive_type from first word of topic (e.g., "weekly-knowledge-upload")

2. Query Supabase `agents` table to get list of all agents:
   ```sql
   SELECT agent_name, agent_tag FROM agents WHERE status = 'active'
   ```

3. For each agent, create an agent_request with type='DIRECTIVE':
   ```sql
   INSERT INTO agent_requests (agent_name, request_type, question, context, priority, domain)
   VALUES ('{agent_name}', 'DIRECTIVE', '{directive_topic}', '{directive_content}', 'BATCH', 'company')
   ```

4. Mark directive as delivered:
   ```sql
   UPDATE shared_knowledge 
   SET broadcast_delivered = true
   WHERE topic = '{directive_topic}'
   ```

**No error handling needed**: If an INSERT fails (agent already has pending directive), just continue. Duplicate request detection will filter it on agent's next check.

**Output**: Log count of agents routed to, directive topics processed, and any that were skipped (already delivered).

**Always check before doing work**: Run the early-exit query FIRST. If empty, log and stop. Never assume directives exist.