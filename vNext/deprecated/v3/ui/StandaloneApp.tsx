// This file has been renamed to StandaloneApp.tsx to avoid confusion
// with the main App.tsx that connects to the API server.
// This version runs the game entirely in the browser.

import React, { useCallback, useState } from 'react';
import ApiKeyInput from './components/ApiKeyInput';
// import { createSimpleWorld, type SimpleWorld } from '../state/world';
import { createSimpleWorld, type SimpleWorld } from '../state/world';
import { createToolRuntime } from '../tools/index';
import type { Patch } from '../tools/types';
import { applyPatches } from '../state/arbiter';
import { runGMAgentTurn } from '../agents/gm';
import { narrateSimple } from '../agents/narrator';
import { DEFAULT_GM_MODEL, getDefaultOpenAIApiKey } from '../config';

const cloneWorld = (world: SimpleWorld): SimpleWorld => JSON.parse(JSON.stringify(world));

const StandaloneApp: React.FC = () => {
  const [world, setWorld] = useState<SimpleWorld>(createSimpleWorld());
  const [log, setLog] = useState<string[]>([]);
  const [messages, setMessages] = useState<{ role: 'player' | 'gm'; text: string }[]>([]);
  const [conversationHistory, setConversationHistory] = useState<{ playerInput: string; gmOutput: string }[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [apiKey, setApiKey] = useState(() => getDefaultOpenAIApiKey() ?? '');
  const [model, setModel] = useState(DEFAULT_GM_MODEL);
  const [gmSteps, setGmSteps] = useState<any[]>([]);
  const [toolStatus, setToolStatus] = useState<Record<string, 'idle' | 'running' | 'done'>>({
    query_world: 'idle',
    apply_patches: 'idle',
    project_pkg: 'idle',
  });

  const onSend = useCallback(async (text: string) => {
    if (!text.trim() || isThinking || !apiKey.trim()) return;
    setMessages((m) => [...m, { role: 'player', text }]);
    setIsThinking(true);
    setGmSteps([]);
    try {
      let shadowWorld = cloneWorld(world);
      const runtime = createToolRuntime(() => shadowWorld, (w) => { shadowWorld = w; });
      const gm = await runGMAgentTurn({
        apiKey: apiKey.trim(),
        model,
        runtime,
        playerText: text,
        world,
        conversationHistory: conversationHistory.slice(-5),
        onEvent: (e) => {
          if (e.type === 'tool_start') {
            const name = String(e.tool);
            setToolStatus((s) => ({ ...s, [name]: 'running' }));
            setGmSteps((steps) => [...steps, { type: 'tool_start', tool: name, input: e.input }]);
          } else if (e.type === 'tool_end') {
            const name = String(e.tool);
            setToolStatus((s) => ({ ...s, [name]: 'done' }));
            setGmSteps((steps) => [...steps, { type: 'tool_end', tool: name, output: e.output }]);
          } else if (e.type === 'llm_token') {
            setGmSteps((steps) => {
              const last = steps[steps.length - 1];
              if (last && last.type === 'llm_tokens') {
                return [...steps.slice(0, -1), { ...last, text: last.text + e.token }];
              }
              return [...steps, { type: 'llm_tokens', text: e.token }];
            });
          }
        },
      });

      setGmSteps(gm.intermediateSteps ?? []);
      setLog((logs) => [...logs, `GM ${gm.usedFallback ? '(fallback)' : ''} patches: ${gm.result.patches.length}`]);

      let finalWorld = world;
      if (gm.usedFallback) {
        if (gm.result.patches.length) {
          finalWorld = applyPatches(world, gm.result.patches as Patch[], 'GM fallback patch');
          setWorld(finalWorld);
        }
      } else {
        finalWorld = shadowWorld;
        setWorld(finalWorld);
      }

      const narration = narrateSimple(text, finalWorld, gm.result.patches as Patch[], gm.result.stateSummary);
      setMessages((m) => [...m, { role: 'gm', text: narration }]);
      setConversationHistory((hist) => {
        const next = [...hist, { playerInput: text, gmOutput: narration }];
        if (next.length > 20) next.splice(0, next.length - 20);
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((logs) => [...logs, `GM error: ${message}`]);
      setMessages((m) => [...m, { role: 'gm', text: `GM error: ${message}` }]);
    } finally {
      setIsThinking(false);
      // Reset tool status back to idle after turn completes
      setToolStatus({ query_world: 'idle', apply_patches: 'idle', project_pkg: 'idle' });
    }
  }, [apiKey, conversationHistory, isThinking, model, world]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Chronicle v3 (Standalone)</h1>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="md:w-1/2">
            <ApiKeyInput apiKey={apiKey} onChange={setApiKey} />
          </div>
          <div className="md:w-1/2 flex items-end gap-2">
            <label className="flex flex-col text-sm w-full">
              <span className="mb-1 text-gray-300">GM Model</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100"
              >
                <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
              </select>
            </label>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 flex flex-col gap-2">
            <div className="border border-gray-700 rounded p-3 h-64 overflow-auto bg-gray-800">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'player' ? 'text-blue-300' : 'text-green-300'}>
                  <strong>{m.role === 'player' ? 'You' : 'GM'}:</strong> {m.text}
                </div>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                const value = String(data.get('t') || '').trim();
                if (value) onSend(value);
                (e.currentTarget.elements.namedItem('t') as HTMLInputElement).value = '';
              }}
            >
              <input
                name="t"
                placeholder="Type a command…"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2"
                disabled={isThinking || !apiKey.trim()}
              />
              <button className="bg-indigo-600 px-4 py-2 rounded" disabled={isThinking || !apiKey.trim()}>
                Send
              </button>
            </form>
          </div>
          <div className="flex flex-col gap-2">
            <div className="border border-gray-700 rounded p-3 bg-gray-800">
              <h2 className="font-semibold mb-2">World</h2>
              <div>Location: {world.locations[world.player.location]?.name}</div>
              <div>Inventory: {world.player.inventory.map((i) => i.name).join(', ') || 'empty'}</div>
            </div>
            <div className="border border-gray-700 rounded p-3 bg-gray-800">
              <h2 className="font-semibold mb-2">Tools</h2>
              {(['query_world','apply_patches','project_pkg'] as const).map((t) => (
                <div key={t} className="flex items-center justify-between text-sm mb-1">
                  <div className="text-gray-300">{t}</div>
                  <div className={
                    toolStatus[t] === 'running'
                      ? 'px-2 py-0.5 rounded bg-amber-600 text-white'
                      : toolStatus[t] === 'done'
                      ? 'px-2 py-0.5 rounded bg-emerald-600 text-white'
                      : 'px-2 py-0.5 rounded bg-gray-700 text-gray-200'
                  }>
                    {toolStatus[t] === 'running' ? 'running' : toolStatus[t] === 'done' ? 'done' : 'idle'}
                  </div>
                </div>
              ))}
            </div>
            <div className="border border-gray-700 rounded p-3 bg-gray-800 h-40 overflow-auto">
              <h2 className="font-semibold mb-2">Ledger</h2>
              {world.ledger.map((entry, i) => (
                <div key={i} className="text-sm text-gray-300">{entry}</div>
              ))}
            </div>
            <div className="border border-gray-700 rounded p-3 bg-gray-800 h-40 overflow-auto">
              <h2 className="font-semibold mb-2">GM Trace</h2>
              {gmSteps.length > 0 ? (
                gmSteps.map((step, index) => (
                  <div key={index} className="mb-2 text-xs text-gray-300">
                    <div className="text-indigo-300">Step {index + 1}</div>
                    {'action' in step ? <div>Action: {JSON.stringify(step.action)}</div> : null}
                    {'observation' in step ? <div>Observation: {String(step.observation)}</div> : null}
                    {step.type === 'tool_start' ? <div>Tool start: {step.tool}</div> : null}
                    {step.type === 'tool_end' ? <div>Tool end: {step.tool}</div> : null}
                    {step.type === 'llm_tokens' ? <div className="text-gray-400">{step.text}</div> : null}
                  </div>
                ))
              ) : (
                <div className="text-xs text-gray-500">No GM steps yet.</div>
              )}
              {log.map((entry, i) => (
                <div key={`log-${i}`} className="text-xs text-gray-500">{entry}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StandaloneApp;
