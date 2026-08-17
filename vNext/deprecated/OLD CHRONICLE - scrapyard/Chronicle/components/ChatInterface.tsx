import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSender, type GameState, type GameMessage, type AIResponse, type WeatherState } from '../types';
import { sendMessageToAI, mergeChangesWithState } from '../services/geminiService';
import Message from './Message';
import { PaperAirplaneIcon, LoadingSpinner } from './IconComponents';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface ChatInterfaceProps {
  initialGameState: GameState;
  onGameStateUpdate: (newState: GameState) => void;
  weatherState?: WeatherState | null;
  // If provided, ChatInterface will post to this endpoint instead of using Gemini
  agentEndpointUrl?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ initialGameState, onGameStateUpdate, weatherState, agentEndpointUrl }) => {
  const [messages, setMessages] = useLocalStorage<GameMessage[]>('ai-story-messages', []);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentGameState, setCurrentGameState] = useState<GameState>(initialGameState);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // On mount, check for and display the opening narrative if chat is empty
    const openingNarrative = window.localStorage.getItem('ai-story-opening-narrative');
    if (openingNarrative && messages.length === 0) {
      setMessages([{
        id: 'opening-narrative',
        sender: MessageSender.GM,
        text: openingNarrative,
        timestamp: initialGameState.worldTime,
      }]);
      // Clean up so it doesn't show up again on refresh
      window.localStorage.removeItem('ai-story-opening-narrative');
    }
  }, []); // Run only once on mount

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setCurrentGameState(initialGameState);
  }, [initialGameState]);

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    // Get the current input value directly from the DOM
    const currentInputValue = inputRef.current?.value || '';
    console.log('Send button clicked!', { userInput: userInput.trim(), currentInputValue, isLoading });
    
    if (!currentInputValue.trim()) {
      console.log('Early return: currentInputValue is empty');
      return;
    }
    if (isLoading) {
      console.log('Early return: isLoading is true');
      return;
    }

    // Capture the input value before clearing it
    const inputText = currentInputValue.trim();

    const playerMessage: GameMessage = {
      id: Date.now().toString(),
      sender: MessageSender.Player,
      text: inputText,
    };

    const loadingMessage: GameMessage = {
      id: (Date.now() + 1).toString(),
      sender: MessageSender.GM,
      text: 'The Historian is consulting the records...',
      isLoading: true,
    };

    setMessages(prev => [...prev, playerMessage, loadingMessage]);
    setUserInput('');
    setIsLoading(true);

    try {
      if (agentEndpointUrl) {
        const isStream = agentEndpointUrl.endsWith('/stream');
        // Minimal agent call: POST { message }
        if (isStream) {
          const resp = await fetch(agentEndpointUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: playerMessage.text }),
          });
          if (!resp.ok || !resp.body) {
            const errText = await resp.text().catch(() => '');
            throw new Error(errText || `Agent error ${resp.status}`);
          }
          const reader = resp.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
              if (part.startsWith('data: ')) {
                const payload = part.slice(6);
                try {
                  const json = JSON.parse(payload);
                  if (typeof json.narrative === 'string') {
                    setMessages(prev => {
                      const newMessages = [...prev];
                      const last = newMessages[newMessages.length - 1];
                      if (last && last.isLoading) {
                        last.text = json.narrative;
                      }
                      return newMessages;
                    });
                  }
                } catch {}
              }
            }
          }
          // Finalize the loading bubble as a normal GM message
          setMessages(prev => {
            const newMessages = [...prev];
            const last = newMessages[newMessages.length - 1];
            if (last && last.isLoading) {
              last.isLoading = false;
            }
            return newMessages;
          });
          setCurrentGameState(currentGameState);
          onGameStateUpdate(currentGameState);
        } else {
          const resp = await fetch(agentEndpointUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: playerMessage.text }),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err?.error || `Agent error ${resp.status}`);
          }
          const data = await resp.json();
          const narrative = typeof data?.narrative === 'string' ? data.narrative : JSON.stringify(data);
          const gmResponse: GameMessage = {
            id: (Date.now() + 2).toString(),
            sender: MessageSender.GM,
            text: narrative,
            timestamp: currentGameState.worldTime,
          };
          setMessages(prev => [...prev.slice(0, -1), gmResponse]);
          setCurrentGameState(currentGameState);
          onGameStateUpdate(currentGameState);
        }
      } else {
        console.log('Calling sendMessageToAI...');
        let streamingText = '';
        const response: AIResponse = await sendMessageToAI(
          currentGameState,
          playerMessage.text,
          weatherState,
          (chunk) => {
            streamingText += chunk;
            // Update the loading message with streaming text
            setMessages(prev => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.isLoading) {
                lastMessage.text = streamingText;
              }
              return newMessages;
            });
          }
        );
        console.log('AI response received:', response);
        
        const gmResponse: GameMessage = {
          id: (Date.now() + 2).toString(),
          sender: MessageSender.GM,
          text: response.narrative,
          timestamp: currentGameState.worldTime, // Use current world time
        };

        setMessages(prev => [...prev.slice(0, -1), gmResponse]);

        // Handle response changes
        let updatedState;
        if (response.changes) {
          // New format - merge changes
          updatedState = mergeChangesWithState(currentGameState, response.changes);
        } else {
          // Fallback - no changes
          updatedState = currentGameState;
        }

        setCurrentGameState(updatedState);
        onGameStateUpdate(updatedState);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      const errorMessage: GameMessage = {
        id: (Date.now() + 2).toString(),
        sender: MessageSender.GM,
        text: 'The records flicker for a moment, and the timeline holds its breath. (An error occurred. Please try again or rephrase your action.)',
      };

      setMessages(prev => [...prev.slice(0, -1), errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [currentGameState, onGameStateUpdate, setMessages]);

  return (
    <div className="flex flex-col h-full w-full card">
      <div className="flex-grow p-4 space-y-6 overflow-y-auto">
        {messages.map((msg) => (
          <Message key={msg.id} message={msg} />
        ))}
        <div ref={chatEndRef} />
      </div>
      <div className="p-4" style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-primary)' }}>
        <form onSubmit={handleSend} className="flex items-center space-x-4">
          <input
            ref={inputRef}
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="What do you do?"
            className="input flex-grow"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !userInput.trim()}
            className="btn btn-primary"
            style={{ minWidth: '48px', height: '48px' }}
          >
            {isLoading ? (
              <LoadingSpinner className="w-6 h-6" />
            ) : (
              <PaperAirplaneIcon className="w-6 h-6" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatInterface;