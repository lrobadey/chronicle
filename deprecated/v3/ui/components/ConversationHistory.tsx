
import React from 'react';
import type { Message } from '../types';
import { PlayerIcon, GMIcon } from './Icons';

interface ConversationHistoryProps {
  messages: Message[];
  placeholder?: string;
}

const statusText: Record<NonNullable<Message['status']>, string> = {
  pending: 'Chronicle is thinking…',
  thinking: 'Chronicle is thinking…',
  done: '',
  error: 'Something went wrong.',
};

const ConversationHistory: React.FC<ConversationHistoryProps> = ({ messages, placeholder }) => {
  return (
    <div className="flex flex-col gap-4 p-4 min-h-[420px] max-h-[70vh] overflow-y-auto bg-gray-800/60 rounded-lg border border-gray-700/50">
      {messages.length === 0 ? (
        <p className="text-sm text-gray-400 italic">{placeholder || 'Initializing Chronicle session…'}</p>
      ) : (
        messages.map((msg) => {
          const isPlayer = msg.role === 'player';
          const isError = msg.status === 'error';
          const bubbleColor = isPlayer
            ? 'bg-blue-600/80 border-blue-400/40'
            : isError
            ? 'bg-red-700/70 border-red-400/50'
            : 'bg-purple-700/70 border-purple-400/40';
          const iconBg = isPlayer ? 'bg-blue-500' : 'bg-purple-500';

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${isPlayer ? 'flex-row' : 'flex-row-reverse'}`}
            >
              <div
                className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center shadow-lg ${iconBg}`}
              >
                {isPlayer ? (
                  <PlayerIcon className="w-5 h-5 text-white" />
                ) : (
                  <GMIcon className="w-5 h-5 text-white" />
                )}
              </div>
              <div className={`p-3 rounded-lg border ${bubbleColor} text-gray-100 shadow-md max-w-xl`}>
                {msg.meta?.fallback && (
                  <span className="text-[10px] uppercase tracking-wide text-yellow-300 bg-yellow-900/30 px-1.5 py-0.5 rounded-full mr-2">
                    Deterministic fallback
                  </span>
                )}
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                {msg.status && msg.status !== 'done' && (
                  <p className="text-xs text-gray-300 mt-2 italic">{statusText[msg.status]}</p>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default ConversationHistory;
