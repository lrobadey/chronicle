import type { LLMClient, ResponseInputItem, ResponseOutputItem } from '../llm/types';
import { classifyLLMError } from '../llm/errorUtils';
import { GM_DEBUG_META_PROMPT, GM_SYSTEM_PROMPT } from './prompts';
import { GM_TOOL_DEFS } from './tools';
import type { WorldEvent } from '../../sim/events';
import type { PendingPrompt } from '../../sim/state';

export interface GMFinishTurnInput {
  summary: string;
  playerPrompt?: {
    pending?: PendingPrompt | null;
    clear?: boolean | null;
  } | null;
}

export interface GMToolRuntime {
  observe_world(input: { perspective: 'gm' | 'player' }): Promise<unknown>;
  consult_npc(input: { npcId: string; topic?: string }): Promise<unknown>;
  propose_events(input: { events: WorldEvent[] }): Promise<unknown>;
  finish_turn(input: GMFinishTurnInput): Promise<unknown>;
}

export interface GMAgentParams {
  apiKey?: string;
  model?: string;
  playerText: string;
  worldContext?: unknown;
  runtime: GMToolRuntime;
  llm: LLMClient;
  maxIterations?: number;
  debugMetaMode?: boolean;
  trace?: {
    toolCalls: Array<{ tool: string; input: unknown; output: unknown }>;
    llmCalls?: Array<{
      agent: 'gm' | 'npc' | 'narrator';
      responseId?: string;
      previousResponseId?: string;
      inputItems?: number;
      outputItems?: number;
      toolCalls?: number;
      usage?: unknown;
      status?: string;
      error?: unknown;
    }>;
  };
}

export async function runGMAgent(params: GMAgentParams): Promise<{ finished: boolean }> {
  const { apiKey, model = 'gpt-5.2', playerText, worldContext, runtime, llm, maxIterations = 8, trace, debugMetaMode } = params;

  let previousResponseId: string | undefined;
  let pendingInput: ResponseInputItem[] = [
    { role: 'system', content: safeJSONStringify({ world: worldContext }) },
    { role: 'user', content: playerText },
  ];
  const instructions = debugMetaMode ? `${GM_DEBUG_META_PROMPT}\n\n${GM_SYSTEM_PROMPT}` : GM_SYSTEM_PROMPT;

  if (!apiKey) {
    await runtime.observe_world({ perspective: 'gm' });
    await runtime.finish_turn({ summary: 'No API key; fallback turn' });
    return { finished: true };
  }

  for (let i = 0; i < maxIterations; i++) {
    let response;
    try {
      response = await llm.responsesCreate({
        apiKey,
        model,
        instructions,
        input: pendingInput,
        previous_response_id: previousResponseId,
        tools: GM_TOOL_DEFS,
        truncation: 'auto',
        store: true,
      });
    } catch (error) {
      const classified = classifyLLMError(error);
      pushLLMTrace(trace, {
        agent: 'gm',
        previousResponseId: previousResponseId,
        inputItems: pendingInput.length,
        status: 'failed',
        error: classified,
      });
      throw error;
    }

    const responseItems = response.output || [];
    const toolCalls = responseItems.filter(isFunctionCallItem);
    pushLLMTrace(trace, {
      agent: 'gm',
      responseId: response.id,
      previousResponseId,
      inputItems: pendingInput.length,
      outputItems: responseItems.length,
      toolCalls: toolCalls.length,
      usage: response.usage,
      status: response.status,
      error: response.error ?? response.incomplete_details,
    });

    previousResponseId = response.id || previousResponseId;

    if (!toolCalls.length) {
      await runtime.finish_turn({ summary: response.output_text || 'Turn ended' });
      return { finished: true };
    }

    const nextInput: ResponseInputItem[] = [];

    for (let idx = 0; idx < toolCalls.length; idx++) {
      const call = toolCalls[idx];
      const callId = call.call_id || `missing-call-id-${i}-${idx}`;
      const parsed = parseToolArgs(call.arguments);

      if (parsed.ok === false) {
        const output = { error: 'invalid_tool_arguments', details: parsed.error };
        trace?.toolCalls.push({ tool: call.name, input: call.arguments, output });
        nextInput.push({
          type: 'function_call_output',
          call_id: callId,
          output: safeJSONStringify(output),
        });
        continue;
      }

      const args = parsed.value;

      try {
        if (call.name === 'observe_world') {
          const output = await runtime.observe_world(args as { perspective: 'gm' | 'player' });
          trace?.toolCalls.push({ tool: call.name, input: args, output });
          nextInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: safeJSONStringify(output),
          });
          continue;
        }

        if (call.name === 'consult_npc') {
          const output = await runtime.consult_npc(args as { npcId: string; topic?: string });
          trace?.toolCalls.push({ tool: call.name, input: args, output });
          nextInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: safeJSONStringify(output),
          });
          continue;
        }

        if (call.name === 'propose_events') {
          const output = await runtime.propose_events(args as { events: WorldEvent[] });
          trace?.toolCalls.push({ tool: call.name, input: args, output });
          nextInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: safeJSONStringify(output),
          });
          continue;
        }

        if (call.name === 'finish_turn') {
          const output = await runtime.finish_turn(args as unknown as GMFinishTurnInput);
          trace?.toolCalls.push({ tool: call.name, input: args, output });
          nextInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: safeJSONStringify(output),
          });
          return { finished: true };
        }

        const output = { error: 'unknown_tool', name: call.name };
        trace?.toolCalls.push({ tool: call.name, input: args, output });
        nextInput.push({
          type: 'function_call_output',
          call_id: callId,
          output: safeJSONStringify(output),
        });
      } catch (error) {
        const output = {
          error: 'tool_runtime_error',
          details: classifyLLMError(error),
        };
        trace?.toolCalls.push({ tool: call.name, input: args, output });
        nextInput.push({
          type: 'function_call_output',
          call_id: callId,
          output: safeJSONStringify(output),
        });
      }
    }

    pendingInput = nextInput;
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

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'non_serializable_tool_output' });
  }
}

function isFunctionCallItem(item: ResponseOutputItem): item is {
  type: 'function_call';
  name: string;
  arguments: string;
  call_id?: string;
} {
  return item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string';
}

function pushLLMTrace(
  trace: GMAgentParams['trace'] | undefined,
  entry: {
    agent: 'gm' | 'npc' | 'narrator';
    responseId?: string;
    previousResponseId?: string;
    inputItems?: number;
    outputItems?: number;
    toolCalls?: number;
    usage?: unknown;
    status?: string;
    error?: unknown;
  },
) {
  if (!trace) return;
  trace.llmCalls = trace.llmCalls || [];
  trace.llmCalls.push(entry);
}
