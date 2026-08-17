/**
 * Chronicle v4 - GM Agent
 * 
 * Simplified OpenAI-native GM implementation.
 * No LangChain, direct SDK calls, streaming support.
 */

import OpenAI from 'openai';
import crypto from 'crypto';
import type { World } from '../core/world';
import type { Patch } from '../core/arbiter';
import { GM_SYSTEM_PROMPT, buildGMContext } from './prompts';
import { TOOL_DEFINITIONS, createToolRuntime, dispatchTool, type ToolRuntime } from './tools';

// ============================================================================
// TYPES
// ============================================================================

export interface GMResult {
  patches: Patch[];
  stateSummary: Record<string, unknown>;
}

export interface GMTurnParams {
  apiKey?: string;
  model?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  world: World;
  playerText: string;
  runtime: ToolRuntime;
  maxIterations?: number;
  onEvent?: (event: GMEvent) => void;
}

export interface GMTurnResult {
  result: GMResult;
  intermediateSteps: unknown[];
  usedFallback: boolean;
}

export type GMEvent =
  | { type: 'llm_start' }
  | { type: 'llm_thought'; token: string }
  | { type: 'llm_token'; token: string }
  | { type: 'llm_end' }
  | { type: 'tool_start'; tool: string; input: unknown }
  | { type: 'tool_end'; tool: string; output: unknown }
  | { type: 'error'; message: string };

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export async function runGMTurn(params: GMTurnParams): Promise<GMTurnResult> {
  const { apiKey, model = 'gpt-5.2', reasoningEffort = 'medium', world, playerText, runtime, maxIterations = 8, onEvent } = params;

  // No API key = deterministic fallback
  if (!apiKey) {
    const result = runFallback(playerText, world);
    return { result, intermediateSteps: [], usedFallback: true };
  }

  const client = new OpenAI({ apiKey });
  const turnSeed = generateSeed(world.meta?.seed, (world.meta?.turn || 0) + 1);
  const context = buildGMContext(world);
  
  const systemPrompt = `${GM_SYSTEM_PROMPT}\n\nCurrent State:\n${context}`;
  
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: playerText },
  ];

  const intermediateSteps: unknown[] = [];

  // Tool calling loop
  for (let iter = 0; iter < maxIterations; iter++) {
    onEvent?.({ type: 'llm_start' });

    const response = await client.chat.completions.create({
      model,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      seed: parseInt(turnSeed.slice(0, 8), 16),
      stream: true,
      // @ts-ignore - reasoning_effort is new
      reasoning_effort: reasoningEffort,
    });

    // Accumulate streaming response
    let content = '';
    const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;

      // Reasoning content (Thinking)
      // @ts-ignore - reasoning_content is new in streaming deltas
      if (delta?.reasoning_content) {
        // @ts-ignore
        const thought = delta.reasoning_content;
        onEvent?.({ type: 'llm_thought', token: thought });
      }
      
      if (delta?.content) {
        content += delta.content;
        onEvent?.({ type: 'llm_token', token: delta.content });
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index === undefined) continue;
          
          const existing = toolCalls.get(tc.index) || { id: '', name: '', args: '' };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.args += tc.function.arguments;
          toolCalls.set(tc.index, existing);
        }
      }
    }

    onEvent?.({ type: 'llm_end' });

    // Process tool calls
    if (toolCalls.size > 0) {
      const assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: 'assistant',
        content: content || null,
        tool_calls: Array.from(toolCalls.values()).map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      };
      messages.push(assistantMessage);

      for (const tc of toolCalls.values()) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.args || '{}');
        } catch {
          args = {};
        }

        onEvent?.({ type: 'tool_start', tool: tc.name, input: args });
        
        let result: unknown;
        try {
          result = await dispatchTool(tc.name, args, runtime);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          onEvent?.({ type: 'error', message: `Tool ${tc.name} failed: ${msg}` });
          result = { error: msg };
        }

        onEvent?.({ type: 'tool_end', tool: tc.name, output: result });
        intermediateSteps.push({ tool: tc.name, input: args, output: result });

        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: tc.id,
        });
      }
      continue;
    }

    // No tool calls = final response
    if (content.trim()) {
      try {
        const parsed = parseGMResponse(content);
        const turn = (world.meta?.turn || 0) + 1;
        
        // Add provenance to patches
        const patchesWithProvenance = parsed.patches.map(p => ({
          ...p,
          by: 'GM',
          turn,
          seed: turnSeed,
        }));

        return {
          result: { patches: patchesWithProvenance, stateSummary: parsed.stateSummary },
          intermediateSteps,
          usedFallback: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onEvent?.({ type: 'error', message: `Parse failed: ${msg}` });
      }
    }
  }

  // Max iterations reached
  onEvent?.({ type: 'error', message: 'Max iterations reached' });
  const result = runFallback(playerText, world);
  return { result, intermediateSteps, usedFallback: true };
}

// ============================================================================
// HELPERS
// ============================================================================

function generateSeed(worldSeed: string | undefined, turn: number): string {
  const base = worldSeed || 'default';
  return crypto.createHash('sha256').update(`${base}-turn-${turn}`).digest('hex').slice(0, 16);
}

function parseGMResponse(text: string): GMResult {
  // Strip code fences if present
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1];
  
  // Find JSON object
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.slice(start, end + 1);
  }

  const parsed = JSON.parse(cleaned);
  return {
    patches: Array.isArray(parsed.patches) ? parsed.patches : [],
    stateSummary: parsed.stateSummary || {},
  };
}

function runFallback(playerText: string, world: World): GMResult {
  const text = playerText.toLowerCase();
  const patches: Patch[] = [];

  // Simple pattern matching for basic actions
  if (text.includes('look') || text.includes('examine')) {
    // No state change for look
  } else if (text.includes('take') || text.includes('pick up')) {
    const loc = world.locations[world.player.location];
    if (loc?.items?.length) {
      const item = loc.items[0];
      patches.push({
        op: 'set',
        path: '/player/inventory',
        value: [...world.player.inventory, item],
        note: `Took ${item.name}`,
      });
    }
  }

  return {
    patches,
    stateSummary: {
      location: world.player.location,
      inventoryCount: world.player.inventory.length + patches.length,
    },
  };
}

// ============================================================================
// CONVENIENCE FACTORY
// ============================================================================

export function createGMRuntime(world: World): { runtime: ToolRuntime; getWorld: () => World } {
  let currentWorld = JSON.parse(JSON.stringify(world)) as World;
  
  const runtime = createToolRuntime(
    () => currentWorld,
    (w) => { currentWorld = w; }
  );

  return { runtime, getWorld: () => currentWorld };
}

