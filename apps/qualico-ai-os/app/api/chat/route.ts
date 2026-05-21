import { NextRequest, NextResponse } from 'next/server';

const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL ||
  'https://qualicobv.app.n8n.cloud/webhook/agent-run';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, broadcast, forceModel, agents } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        broadcast: broadcast ?? false,
        force_model: forceModel,
        agents,
      }),
    });

    if (!n8nResponse.ok) {
      const errText = await n8nResponse.text();
      return NextResponse.json(
        { error: `n8n error: ${n8nResponse.status}`, detail: errText },
        { status: 502 }
      );
    }

    const data = await n8nResponse.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
