export type ComplexityTier = 'SIMPLE' | 'MEDIUM' | 'COMPLEX' | 'BROADCAST';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentName?: string;
  agentEmoji?: string;
  model?: string;
  tier?: ComplexityTier;
  tokens?: number;
  timestamp: Date;
}

export interface AgentResponse {
  response: string;
  model: string;
  tier: ComplexityTier;
  tokens: number;
  agentName?: string;
  status: 'success' | 'error';
}
