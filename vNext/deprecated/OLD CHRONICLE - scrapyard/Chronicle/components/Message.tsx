import React from 'react';
import { MessageSender, type GameMessage } from '../types';
import { PlayerIcon, GMIcon, SystemIcon, LoadingSpinner } from './IconComponents';

interface MessageProps {
  message: GameMessage;
}

const Message: React.FC<MessageProps> = ({ message }) => {
  const isPlayer = message.sender === MessageSender.Player;
  const isGM = message.sender === MessageSender.GM;
  const isSystem = message.sender === MessageSender.SYSTEM;

  const wrapperClasses = `flex items-start gap-3 w-full ${isPlayer ? 'justify-end' : 'justify-start'}`;
  const bubbleClasses = `chat-bubble max-w-xl ${
    isPlayer
      ? 'player'
      : isGM
      ? 'gm'
      : 'system'
  }`;

  const Icon = isPlayer ? PlayerIcon : isGM ? GMIcon : SystemIcon;
  const iconClasses = `w-8 h-8 rounded-full flex-shrink-0 mt-1 ${isPlayer ? 'bg-blue-600' : isGM ? 'bg-teal-500' : 'bg-red-700'}`;

  return (
    <div className="flex flex-col">
      {message.timestamp && isGM && (
        <p className="text-center text-xs mb-2 font-mono uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {message.timestamp}
        </p>
      )}
      <div className={wrapperClasses}>
        {!isPlayer && (
          <div className={iconClasses}>
            <Icon className="w-full h-full p-1" />
          </div>
        )}
        <div className={bubbleClasses}>
          {message.isLoading ? (
            <div className="flex items-center space-x-2" style={{ color: 'var(--text-muted)' }}>
              <LoadingSpinner className="w-5 h-5" />
              <span>{message.text}</span>
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{message.text}</p>
          )}
        </div>
        {isPlayer && (
          <div className={iconClasses}>
            <Icon className="w-full h-full p-1.5" />
          </div>
        )}
      </div>
    </div>
  );
};

export default Message;