# Hub Router — RETIRED

**Status**: RETIRED March 2026

The hub webhook routing system has been replaced with a simpler Supabase-native architecture.

## What replaced it

Agents now communicate by reading and writing directly to Supabase `shared_knowledge` table.
No routing. No retries. No webhooks between agents.

See: `/agent/home/protocol-agent-v3-supabase-native.md`

## If this subagent is called

Do nothing. Log "Hub retired — no routing needed" and exit.
