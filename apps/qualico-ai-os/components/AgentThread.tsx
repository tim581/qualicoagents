'use client';

import React from 'react';
import { ChatMessage, ComplexityTier } from '../lib/types';
import AgentAvatar from './AgentAvatar';

interface AgentThreadProps {
  message: ChatMessage;
}

const tierColors: Record<ComplexityTier, string> = {
  SIMPLE: 'bg-green-900 text-green-300 border-green-700',
  MEDIUM: 'bg-yellow-900 text-yellow-300 border-yellow-700',
  COMPLEX: 'bg-red-900 text-red-300 border-red-700',
  BROADCAST: 'bg-purple-900 text-purple-300 border-purple-700',
};

const modelLabels: Record<string, string> = {
  claude: '⚡ Claude',
  hermes: '🧠 Hermes',
  'claude-3-haiku': '⚡ Claude Haiku',
  'claude-3-sonnet': '⚡ Claude Sonnet',
  'claude-3-opus': '⚡ Claude Opus',
  'claude-opus-4-5': '⚡ Claude Opus 4.5',
};

function formatModel(model: string): string {
  return modelLabels[model] ?? model;
}

export default function AgentThread({ message }: AgentThreadProps) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-xl bg-indigo-700 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          <p className="text-xs text-indigo-300 mt-1 text-right">
            {new Date(message.timestamp).toLocaleTimeString()}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 mb-6">
      {/* Avatar */}
      <div className="flex-shrink-0 mt-1">
        <div className="w-9 h-9 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-lg">
          {message.agentEmoji ?? '🤖'}
        </div>
      </div>

      {/* Message bubble */}
      <div className="flex-1 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-bold text-gray-200">
            {message.agentName ?? 'AI Agent'}
          </span>
          {message.tier && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full border font-medium ${tierColors[message.tier]}`}
            >
              {message.tier}
            </span>
          )}
          {message.model && (
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full border border-gray-700">
              {formatModel(message.model)}
            </span>
          )}
          {message.tokens && (
            <span className="text-xs text-gray-600">{message.tokens} tokens</span>
          )}
          <span className="text-xs text-gray-600 ml-auto">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        </div>

        {/* Content */}
        <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 border border-gray-700 shadow">
          <p className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}
