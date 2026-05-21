'use client';

import React from 'react';

interface AgentAvatarProps {
  emoji: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'w-7 h-7 text-sm',
  md: 'w-9 h-9 text-base',
  lg: 'w-12 h-12 text-xl',
};

export default function AgentAvatar({ emoji, name, size = 'md' }: AgentAvatarProps) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`${sizeClasses[size]} rounded-full bg-gray-800 flex items-center justify-center border border-gray-700 flex-shrink-0`}
        title={name}
      >
        <span role="img" aria-label={name}>
          {emoji}
        </span>
      </div>
      <span className="text-sm font-semibold text-gray-200">{name}</span>
    </div>
  );
}
