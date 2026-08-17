import React, { useCallback, useEffect, useRef, useState } from 'react';
import Message from './Message';
import type { ChatMessage, Sender } from '../types/UITypes';

export interface ChatInterfaceProps {
  onSend: (text: string, onStream: (chunk: string) => void) => Promise<{ narrative: string } | void>;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ onSend }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const current = inputRef.current?.value || '';
    if (!current.trim() || isLoading) return;
    const playerMsg: ChatMessage = { id: Date.now().toString(), sender: Sender.Player, text: current.trim() };
    const loadingMsg: ChatMessage = { id: (Date.now() + 1).toString(), sender: Sender.GM, text: 'The Historian is consulting the records...', isLoading: true };
    setMessages(prev => [...prev, playerMsg, loadingMsg]);
    setUserInput('');
    setIsLoading(true);
    try {
      let streaming = '';
      const res = await onSend(current.trim(), (chunk) => {
        streaming += chunk;
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.isLoading) last.text = streaming;
          return next;
        });
      });
      const gm: ChatMessage = { id: (Date.now() + 2).toString(), sender: Sender.GM, text: res && 'narrative' in res ? (res as any).narrative : streaming };
      setMessages(prev => [...prev.slice(0, -1), gm]);
    } catch (err) {
      const gmErr: ChatMessage = { id: (Date.now() + 2).toString(), sender: Sender.GM, text: 'An error occurred. Please try again.' };
      setMessages(prev => [...prev.slice(0, -1), gmErr]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, onSend]);

  return (
    <div className="flex flex-col h-full w-full card">
      <div className="flex-grow p-4 space-y-6 overflow-y-auto">
        {messages.map(m => <Message key={m.id} message={m} />)}
        <div ref={chatEndRef} />
      </div>
      <div className="p-4" style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-primary)' }}>
        <form onSubmit={handleSend} className="flex items-center space-x-4">
          <input ref={inputRef} type="text" value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder="What do you do?" className="input flex-grow" disabled={isLoading} />
          <button type="submit" disabled={isLoading || !userInput.trim()} className="btn btn-primary" style={{ minWidth: '48px', height: '48px' }}>
            {isLoading ? (<svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>) : (
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatInterface;


