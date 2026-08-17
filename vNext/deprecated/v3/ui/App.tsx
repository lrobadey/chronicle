import React, { useState, useCallback, useEffect } from 'react';
import { Message, Tool, WorldStateData } from './types';
import PlayerInput from './components/PlayerInput';
import ConversationHistory from './components/ConversationHistory';
import AgentOrchestrator from './components/AgentOrchestrator';
import ToolsPanel from './components/ToolsPanel';
import WorldState from './components/WorldState';
import ApiKeyInput from './components/ApiKeyInput';
import { reduceWorldState } from './lib/worldReducer';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// --- TOOL METADATA FOR UI ---
const TOOLS_UI: Tool[] = [
  { id: 'query_world', name: 'Query World', description: 'Inspect current location, items, and player state.' },
  { id: 'move_to_position', name: 'Move', description: 'Move the player using coordinates.' },
  { id: 'travel_to_location', name: 'Travel', description: 'Travel to a known location.' },
  { id: 'create_entity', name: 'Create Entity', description: 'Create new entities in the world.' },
];

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [sessionId] = useState(() => `session-${Date.now()}`);
  const [world, setWorld] = useState<WorldStateData>({
    gtwg: {},
    pkg: {},
    ledger: [],
    telemetry: undefined,
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [currentAgent, setCurrentAgent] = useState<'executor' | 'narrator' | null>(null);
  const [newPatch, setNewPatch] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && apiKey) {
      initializeSession();
    }
  }, [apiKey, initialized]);

  const initializeSession = useCallback(async () => {
    try {
      setIsThinking(true);
      setSteps(['Initializing session...']);
      const response = await fetch(`${API_BASE_URL}/api/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, sessionId }),
      });
      if (!response.ok) throw new Error('Failed to initialize session');
      const data = await response.json();
      setWorld((prev) => reduceWorldState(prev, { telemetry: data.telemetry, pkg: data.pkg }));
      setMessages([{ sender: 'gm', text: data.initialNarration }]);
      setInitialized(true);
    } catch (err: any) {
      setMessages([{ sender: 'gm', text: `Error initializing: ${err?.message || String(err)}` }]);
    } finally {
      setIsThinking(false);
      setSteps([]);
    }
  }, [apiKey, sessionId]);

  const handleSend = useCallback(async (text: string) => {
    if (!initialized) return;
    setMessages(prev => [...prev, { sender: 'player', text }]);
    setIsThinking(true);
    setCurrentAgent('executor');
    setSteps(['Analyzing player action...', 'Consulting tools...']);
    setActiveTool(null);
    setNewPatch(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerText: text, apiKey, sessionId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process turn');
      }
      const result = await response.json();
      setCurrentAgent('narrator');
      setSteps(prev => [...prev, 'Narration produced.']);
      setMessages(prev => [...prev, { sender: 'gm', text: result.narration }]);
      setWorld(prev => reduceWorldState(prev, {
        telemetry: result.telemetry,
        pkg: result.pkg,
        patches: result.patches,
      }));
      if (result.patches.length > 0) {
        const lastPatch = result.patches[result.patches.length - 1];
        setNewPatch(lastPatch.note || lastPatch.path);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { sender: 'gm', text: `Error: ${err?.message || String(err)}` }]);
    } finally {
      setIsThinking(false);
      setActiveTool(null);
      setTimeout(() => setCurrentAgent(null), 400);
    }
  }, [apiKey, sessionId, initialized]);

  const activeTools = activeTool ? [activeTool] : [];

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 flex flex-col gap-4">
          <ApiKeyInput apiKey={apiKey} onChange={setApiKey} />
          <AgentOrchestrator steps={steps} isThinking={isThinking} activeTool={activeTool} currentAgent={currentAgent} />
          <ConversationHistory messages={messages} />
          <PlayerInput onSend={handleSend} disabled={!initialized || isThinking} />
        </div>
        <div className="flex flex-col gap-4">
          <ToolsPanel tools={TOOLS_UI} activeTools={activeTools} />
          <WorldState state={world} newPatch={newPatch} />
        </div>
      </div>
    </div>
  );
};

export default App;