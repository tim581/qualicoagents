import { AgentResponse } from './types';

const N8N_WEBHOOK_URL =
  process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL ||
  'https://qualicobv.app.n8n.cloud/webhook/agent-run';

export async function sendToOrchestrator(
  message: string,
  options?: {
    broadcast?: boolean;
    forceModel?: 'claude' | 'hermes';
    agents?: string[];
  }
): Promise<AgentResponse> {
  const res = await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      broadcast: options?.broadcast ?? false,
      force_model: options?.forceModel,
      agents: options?.agents,
    }),
  });

  if (!res.ok) {
    throw new Error(`n8n webhook returned ${res.status}: ${res.statusText}`);
  }

  return res.json();
}
