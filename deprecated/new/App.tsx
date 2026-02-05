import React, { useState, useCallback } from 'react';
import { Message, Tool, WorldStateData } from './types';
import PlayerInput from './components/PlayerInput';
import ConversationHistory from './components/ConversationHistory';
import AgentOrchestrator from './components/AgentOrchestrator';
import ToolsPanel from './components/ToolsPanel';
import WorldState from './components/WorldState';
import ApiKeyInput from './components/ApiKeyInput';
import { runGmTurn } from './agents/gmOrchestrator';

// --- INITIAL GAME STATE ---
const INITIAL_WORLD_STATE: WorldStateData = {
  gtwg: {
    player: { id: 'player1', location: 'glade', health: 100 },
    locations: {
      'glade': {
        name: "Silent Glade",
        description: "A quiet, mossy clearing bathed in soft light. A path leads north into the woods. A strange, humming rock sits in the center, covered in faint, glowing runes.",
        exits: { north: 'path' },
        items: []
      },
      'path': {
        name: "Forest Path",
        description: "A well-trodden path surrounded by ancient trees. To the south is the glade, and to the north you see the warm glow of a building.",
        exits: { south: 'glade', north: 'tavern' },
        items: []
      },
      'tavern': {
        name: "Weary Dragon Inn",
        description: "A cozy tavern filled with the scent of stew and ale. The innkeeper, a burly dwarf named Balin, is cleaning a mug behind the bar. A rusty key hangs on a hook on the wall.",
        exits: { south: 'path' },
        items: [{ id: 'key', name: 'a rusty key', isTaken: false }]
      }
    },
  },
  pkg: {
    player: { id: 'player1', location: 'glade' },
    known_locations: ['glade'],
    inventory: [],
  },
  ledger: ['tick: 0 - World initialized.'],
};

// --- TOOL METADATA FOR UI ---
const TOOLS_UI: Tool[] = [
  { id: 'query_world_state', name: 'Query World State', description: 'Inspect locations, items, player status to understand before acting.' },
  { id: 'update_world_state', name: 'Update World State', description: 'Apply state changes via JSON pointer with a ledger note.' },
];

function applyJsonPointer(root: any, path: string, value: any) {
  if (!path.startsWith('/')) throw new Error('Path must start with "/"');
  const parts = path.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = root as any;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] === undefined) current[key] = {};
    current = current[key];
  }
  const last = parts[parts.length - 1];
  current[last] = value;
}

function safeParseJSON(maybe: any) {
  if (typeof maybe !== 'string') return maybe;
  try { return JSON.parse(maybe); } catch { return maybe; }
}

const MODEL = 'gpt-5';

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [world, setWorld] = useState<WorldStateData>(INITIAL_WORLD_STATE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [currentAgent, setCurrentAgent] = useState<'executor' | 'narrator' | null>(null);
  const [newPatch, setNewPatch] = useState<string | null>(null);

  const execTool = useCallback(async (name: string, args: any) => {
    if (name === 'query_world_state') {
      const query: string = (args?.query ?? '').toString().toLowerCase();
      const locationId = world.gtwg.player.location;
      const location = (world.gtwg.locations as any)[locationId];
      const response = {
        player: world.gtwg.player,
        currentLocation: {
          id: locationId,
          name: location?.name,
          description: location?.description,
          exits: location?.exits,
          items: location?.items,
        },
        inventory: world.pkg.inventory,
        knownLocations: world.pkg.known_locations,
        queryEcho: query,
      };
      return response;
    }
    if (name === 'update_world_state') {
      const path: string = args?.path;
      const value = safeParseJSON(args?.value);
      const description: string = args?.description ?? 'State updated.';
      const next = JSON.parse(JSON.stringify(world));
      applyJsonPointer(next, path, value);
      next.ledger = [...next.ledger, description];
      setWorld(next);
      setNewPatch(description);
      return { ok: true, description };
    }
    return { ok: false, error: `Unknown tool ${name}` };
  }, [world]);

  const handleSend = useCallback(async (text: string) => {
    setMessages(prev => [...prev, { sender: 'player', text }]);
    setIsThinking(true);
    setCurrentAgent('executor');
    setSteps(prev => [...prev, 'Analyzing player action...', 'Consulting tools as needed...']);
    setActiveTool(null);
    setNewPatch(null);
    try {
      const result = await runGmTurn({
        apiKey,
        model: MODEL,
        world,
        playerText: text,
        execTool,
        maxIters: 6,
        onTool: (toolName) => {
          setActiveTool(toolName);
          setSteps(prev => [...prev, `Using tool: ${toolName}`]);
        }
      });
      setCurrentAgent('narrator');
      setSteps(prev => [...prev, 'Narration produced.']);
      const narration = result.narration || '';
      setMessages(prev => [...prev, { sender: 'gm', text: narration }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { sender: 'gm', text: `Error: ${err?.message || String(err)}` }]);
    } finally {
      setIsThinking(false);
      setActiveTool(null);
      setTimeout(() => setCurrentAgent(null), 400);
    }
  }, [apiKey, world, execTool]);

  const activeTools = activeTool ? [activeTool] : [];

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 flex flex-col gap-4">
          <ApiKeyInput apiKey={apiKey} onChange={setApiKey} />
          <AgentOrchestrator steps={steps} isThinking={isThinking} activeTool={activeTool} currentAgent={currentAgent} />
          <ConversationHistory messages={messages} />
          <PlayerInput onSend={handleSend} disabled={!apiKey || isThinking} />
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


