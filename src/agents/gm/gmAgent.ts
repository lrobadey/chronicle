import type { LLMClient, ResponseInputItem } from '../llm/types';
import { GM_SYSTEM_PROMPT } from './prompts';
import { GM_TOOL_DEFS } from './tools';
import type { WorldEvent } from '../../sim/events';

export interface GMToolRuntime {
  observe_world(input: { perspective: 'gm' | 'player' }): Promise<unknown>;
  consult_npc(input: { npcId: string; topic?: string }): Promise<unknown>;
  propose_events(input: { events: WorldEvent[] }): Promise<unknown>;
  finish_turn(input: { summary: string }): Promise<unknown>;
}

export interface GMAgentParams {
  apiKey?: string;
  model?: string;
  playerText: string;
  runtime: GMToolRuntime;
  llm: LLMClient;
  maxIterations?: number;
  trace?: { toolCalls: Array<{ tool: string; input: unknown; output: unknown }> };
}

export async function runGMAgent(params: GMAgentParams): Promise<{ finished: boolean }> {
  const { apiKey, model = 'gpt-5.2', playerText, runtime, llm, maxIterations = 8, trace } = params;
  let input: ResponseInputItem[] = [
    { role: 'user', content: playerText },
  ];

  if (!apiKey) {
    await runtime.observe_world({ perspective: 'gm' });
    await runtime.finish_turn({ summary: 'No API key; fallback turn' });
    return { finished: true };
  }

  for (let i = 0; i < maxIterations; i++) {
    const response = await llm.responsesCreate({
      apiKey,
      model,
      instructions: GM_SYSTEM_PROMPT,
      input,
      tools: GM_TOOL_DEFS,
    });

    input = input.concat(response.output as ResponseInputItem[]);

    const toolCalls = response.output.filter(isFunctionCallItem);

    if (!toolCalls.length) {
      await runtime.finish_turn({ summary: response.output_text || 'Turn ended' });
      return { finished: true };
    }

    for (let idx = 0; idx < toolCalls.length; idx++) {
      const call = toolCalls[idx];
      const callId = call.call_id || `missing-call-id-${i}-${idx}`;
      const parsed = parseToolArgs(call.arguments);

      if (parsed.ok === false) {
        const output = { error: 'invalid_tool_arguments', details: parsed.error };
        trace?.toolCalls.push({ tool: call.name, input: call.arguments, output });
        input.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify(output) });
        continue;
      }

      const args = parsed.value;
      try {
        if (call.name === 'observe_world') {
          const output = await runtime.observe_world(args as { perspective: 'gm' | 'player' });
          trace?.toolCalls.push({ tool: call.name, input: args, output });
          input.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify(output) });
          continue;
        }

        if (call.name === 'consult_npc') {
          const output = await runtime.consult_npc(args as { npcId: string; topic?: string });
          trace?.toolCalls.push({ tool: call.name, input: args, output });
          input.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify(output) });
          continue;
        }

        if (call.name === 'propose_events') {
          const output = await runtime.propose_events(args as { events: WorldEvent[] });
          trace?.toolCalls.push({ tool: call.name, input: args, output });
          input.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify(output) });
          continue;
        }

        if (call.name === 'finish_turn') {
          const output = await runtime.finish_turn(args as { summary: string });
          trace?.toolCalls.push({ tool: call.name, input: args, output });
          input.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify(output) });
          return { finished: true };
        }

        const output = { error: 'unknown_tool', name: call.name };
        trace?.toolCalls.push({ tool: call.name, input: args, output });
        input.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify(output) });
      } catch (error) {
        const output = { error: 'tool_runtime_error', message: error instanceof Error ? error.message : 'unknown_error' };
        trace?.toolCalls.push({ tool: call.name, input: args, output });
        input.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify(output) });
      }
    }
  }

  await runtime.finish_turn({ summary: 'Max iterations reached' });
  return { finished: false };
}

function parseToolArgs(value: string | undefined): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!value || !value.trim()) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'arguments_must_be_json_object' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'arguments_parse_failed' };
  }
}

function isFunctionCallItem(item: Record<string, unknown>): item is { type: 'function_call'; name: string; arguments: string; call_id?: string } {
  return item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string';
}
