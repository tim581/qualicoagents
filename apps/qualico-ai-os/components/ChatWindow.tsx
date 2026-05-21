'use client';

import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '../lib/types';
import AgentThread from './AgentThread';
import MessageInput from './MessageInput';

interface Agent {
  id: string;
  name: string;
  emoji: string;
  description: string;
}

const AGENTS: Agent[] = [
  { id: 'orchestrator', name: 'Orchestrator', emoji: '🎯', description: 'Routes to best agent' },
  { id: 'claude', name: 'Claude', emoji: '⚡', description: 'Complex reasoning' },
  { id: 'hermes', name: 'Hermes', emoji: '🧠', description: 'Fast local tasks' },
  { id: 'broadcast', name: 'Broadcast', emoji: '📡', description: 'All agents respond' },
];

interface ChatWindowProps {
  messages: ChatMessage[];
  onSend: (message: string, options?: { broadcast?: boolean }) => void;
  loading: boolean;
}

export default function ChatWindow({ messages, onSend, loading }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-indigo-400 tracking-tight">⚙️ Qualico AI OS</h1>
          <p className="text-xs text-gray-500 mt-0.5">Multi-Agent Orchestrator</p>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest px-2 mb-2">
            Agents
          </p>
          {AGENTS.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-800 cursor-pointer transition-colors group"
            >
              <span className="text-xl">{agent.emoji}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-200 truncate">{agent.name}</p>
                <p className="text-xs text-gray-500 truncate">{agent.description}</p>
              </div>
            </div>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-600">
          <p>n8n Orchestrator</p>
          <p className="truncate text-gray-700">qualicobv.app.n8n.cloud</p>
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="border-b border-gray-800 px-6 py-3 flex items-center gap-3 bg-gray-950">
          <span className="text-2xl">🎯</span>
          <div>
            <h2 className="font-semibold text-gray-100">AI Orchestrator</h2>
            <p className="text-xs text-gray-500">Automatically routes to the best agent</p>
          </div>
          {loading && (
            <div className="ml-auto flex items-center gap-2 text-xs text-indigo-400">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Thinking…
            </div>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-600">
              <p className="text-4xl mb-3">🤖</p>
              <p className="text-lg font-medium text-gray-500">Start a conversation</p>
              <p className="text-sm mt-1">
                Your message will be routed to the best available agent automatically.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <AgentThread key={msg.id} message={msg} />
          ))}

          {/* Loading placeholder */}
          {loading && (
            <div className="flex gap-3 mb-6">
              <div className="w-9 h-9 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
                <svg className="animate-spin h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-gray-400">AI Agent</span>
                  <span className="text-xs text-gray-600">processing…</span>
                </div>
                <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 border border-gray-700 w-48">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <MessageInput onSend={onSend} disabled={loading} />
      </div>
    </div>
  );
}
