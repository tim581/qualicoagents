'use client';

import React, { useState, useCallback } from 'react';
import { ChatMessage, AgentResponse } from '../lib/types';
import ChatWindow from '../components/ChatWindow';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function agentEmojiFor(agentName?: string, model?: string): string {
  if (agentName?.toLowerCase().includes('claude')) return '⚡';
  if (agentName?.toLowerCase().includes('hermes')) return '🧠';
  if (model?.toLowerCase().includes('claude')) return '⚡';
  if (model?.toLowerCase().includes('hermes')) return '🧠';
  return '🤖';
}

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSend = useCallback(
    async (content: string, options?: { broadcast?: boolean }) => {
      // Add user message immediately
      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            broadcast: options?.broadcast ?? false,
          }),
        });

        if (!res.ok) {
          throw new Error(`Server error: ${res.status}`);
        }

        const data: AgentResponse = await res.json();

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: data.response ?? 'No response received.',
          agentName: data.agentName ?? 'AI Agent',
          agentEmoji: agentEmojiFor(data.agentName, data.model),
          model: data.model,
          tier: data.tier,
          tokens: data.tokens,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err: unknown) {
        const errorMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: `⚠️ Error: ${err instanceof Error ? err.message : 'Unknown error occurred'}`,
          agentName: 'System',
          agentEmoji: '⚠️',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return <ChatWindow messages={messages} onSend={handleSend} loading={loading} />;
}
