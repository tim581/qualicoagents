# Qualico AI OS — Chat UI

A Slack-style multi-agent chat interface for the Qualico AI Orchestrator.

## Features

- 🎯 **Automatic routing** — sends messages to the n8n orchestrator which routes to the best agent
- ⚡ **Claude** — Complex reasoning tasks via Anthropic Claude
- 🧠 **Hermes** — Fast local tasks via Hermes model
- 📡 **Broadcast mode** — send to all agents simultaneously
- 🏷️ **Complexity tier badges** — SIMPLE / MEDIUM / COMPLEX / BROADCAST
- 🌙 **Dark mode** Slack-style UI built with Tailwind CSS

## Setup

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_N8N_WEBHOOK_URL` | n8n orchestrator webhook URL | `https://qualicobv.app.n8n.cloud/webhook/agent-run` |
| `N8N_WEBHOOK_URL` | Server-side n8n URL (used by API route) | Same as above |

## Deploy on Vercel

1. Connect this repo to Vercel
2. Set root directory to `apps/qualico-ai-os`
3. Add env vars:
   - `NEXT_PUBLIC_N8N_WEBHOOK_URL` = `https://qualicobv.app.n8n.cloud/webhook/agent-run`
   - `N8N_WEBHOOK_URL` = `https://qualicobv.app.n8n.cloud/webhook/agent-run`
4. Deploy!

## Architecture

```
Browser → /api/chat (Next.js route) → n8n Orchestrator → Claude / Hermes
```

The API route acts as a proxy to keep the n8n webhook URL server-side (for production, move it to `N8N_WEBHOOK_URL` only).
