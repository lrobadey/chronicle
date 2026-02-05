import React from 'react';
import { ChatMessage, Sender } from '../../ui/types/UITypes';

type IconProps = { className?: string };

const PlayerIcon: React.FC<IconProps> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
  </svg>
);

const GMIcon: React.FC<IconProps> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A9.735 9.735 0 006 21a9.707 9.707 0 005.25-1.533.75.75 0 000-1.334v-12a.75.75 0 000-1.334z" />
    <path d="M12.75 4.533A9.707 9.707 0 0118 3a9.735 9.735 0 013.25.555.75.75 0 01.5.707v14.25a.75.75 0 01-1 .707A9.735 9.735 0 0118 21a9.707 9.707 0 01-5.25-1.533.75.75 0 010-1.334v-12a.75.75 0 010-1.334z" />
  </svg>
);

const SystemIcon: React.FC<IconProps> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
  </svg>
);

export interface MessageProps { message: ChatMessage }

const Message: React.FC<MessageProps> = ({ message }) => {
  const isPlayer = message.sender === Sender.Player;
  const isGM = message.sender === Sender.GM;
  const wrapperClasses = `flex items-start gap-3 w-full ${isPlayer ? 'justify-end' : 'justify-start'}`;
  const bubbleClasses = `chat-bubble max-w-xl ${isPlayer ? 'player' : isGM ? 'gm' : 'system'}`;
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
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
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


