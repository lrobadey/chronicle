import type { LLMClient, ResponseInputItem, ResponseOutputItem } from '../llm/types';
import { DEFAULT_MODEL } from '../llm/defaults';
import { classifyLLMError } from '../llm/errorUtils';
import { GM_SYSTEM_PROMPT } from './prompts';
import { GM_TOOL_DEFS } from './tools';
import type { WorldEvent } from '../../sim/events';
import type { PendingPrompt, SceneAgenda, WorldAgenda } from '../../sim/state';
import type { DebugSink } from '../../engine/debug';
import { emitDebugEvent } from '../../engine/debug';
import type { SpecialistType } from '../specialists';

export type GMReasoningEffort = 'low' | 'medium' | 'high';

export interface GMAgendaUpdates {
  scene?: SceneAgenda | null;
  world?: WorldAgenda | null;
}

export interface GMFinishTurnInput {
  summary: string;
  playerPrompt?: {
    pending?: PendingPrompt | null;
    clear?: boolean | null;
  } | null;
  agendaUpdates?: GMAgendaUpdates | null;
}

export interface GMToolRuntime {
  observe_world(input: { perspective: 'gm' | 'player' }): Promise<unknown>;
  consult_npc(input: { npcId: string; topic?: string }): Promise<unknown>;
  consult_specialist(input: { specialistType: SpecialistType; question: string; focus?: string | null }): Promise<unknown>;
  propose_events(input: { events: WorldEvent[] }): Promise<unknown>;
  finish_turn(input: GMFinishTurnInput): Promise<unknown>;
}

export interface GMAgentParams {
  apiKey?: string;
  model?: string;
  gmReasoningEffort?: GMReasoningEffort;
  playerText: string;
  worldContext?: unknown;
  runtime: GMToolRuntime;
  llm: LLMClient;
  maxIterations?: number;
  debug?: DebugSink;
  trace?: {
    toolCalls: Array<{ tool: string; input: unknown; output: unknown }>;
    llmCalls?: Array<{
      agent: 'gm' | 'npc' | 'narrator' | 'specialist';
      responseId?: string;
      previousResponseId?: string;
      inputItems?: number;
      outputItems?: number;
      toolCalls?: number;
      usage?: unknown;
      status?: string;
      error?: unknown;
      specialistType?: SpecialistType;
    }>;
  };
}

export async function runGMAgent(params: GMAgentParams): Promise<{ finished: boolean }> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    gmReasoningEffort = 'low',
    playerText,
    worldContext,
    runtime,
    llm,
    maxIterations = 8,
    debug,
    trace,
  } = params;

  let previousResponseId: string | undefined;
  let pendingInput: ResponseInputItem[] = [
    { role: 'system', content: safeJSONStringify({ world: worldContext }) },
    { role: 'user', content: playerText },
  ];

  if (!apiKey) {
    emitDebugEvent(debug, { type: 'gm.iteration.started', iteration: 1 });
    emitDebugEvent(debug, {
      type: 'tool.called',
      iteration: 1,
      tool: 'observe_world',
      callId: 'fallback-observe-world',
      callIndex: 1,
      callCount: 2,
      input: { perspective: 'gm' },
    });
    const observeOutput = await runtime.observe_world({ perspective: 'gm' });
    emitDebugEvent(debug, {
      type: 'tool.result',
      iteration: 1,
      tool: 'observe_world',
      callId: 'fallback-observe-world',
      callIndex: 1,
      callCount: 2,
      output: observeOutput,
      ok: deriveToolResultOk(observeOutput),
    });
    emitDebugEvent(debug, {
      type: 'tool.called',
      iteration: 1,
      tool: 'finish_turn',
      callId: 'fallback-finish-turn',
      callIndex: 2,
      callCount: 2,
      input: { summary: 'No API key; fallback turn' },
    });
    const finishOutput = await runtime.finish_turn({ summary: 'No API key; fallback turn' });
    emitDebugEvent(debug, {
      type: 'tool.result',
      iteration: 1,
      tool: 'finish_turn',
      callId: 'fallback-finish-turn',
      callIndex: 2,
      callCount: 2,
      output: finishOutput,
      ok: deriveToolResultOk(finishOutput),
    });
    return { finished: true };
  }

  for (let i = 0; i < maxIterations; i++) {
    const iteration = i + 1;
    emitDebugEvent(debug, { type: 'gm.iteration.started', iteration });
    let response;
    try {
      response = await llm.responsesCreate({
        apiKey,
        model,
        reasoning: { effort: gmReasoningEffort },
        instructions: GM_SYSTEM_PROMPT,
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
    emitDebugEvent(debug, {
      type: 'gm.response.received',
      iteration,
      toolCalls: toolCalls.length,
      toolCallCount: toolCalls.length,
      toolCallNames: toolCalls.map(call => call.name),
      status: response.status,
      responseId: response.id,
      error: response.error ?? response.incomplete_details,
    });
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
      const callIndex = idx + 1;
      const callCount = toolCalls.length;
      const parsed = parseToolArgs(call.arguments);
      emitDebugEvent(debug, {
        type: 'tool.called',
        iteration,
        tool: call.name,
        callId,
        callIndex,
        callCount,
        input: parsed.ok ? parsed.value : { raw: call.arguments },
      });

      if (parsed.ok === false) {
        const output = { error: 'invalid_tool_arguments', details: parsed.error };
        trace?.toolCalls.push({ tool: call.name, input: call.arguments, output });
        emitDebugEvent(debug, {
          type: 'tool.result',
          iteration,
          tool: call.name,
          callId,
          callIndex,
          callCount,
          output,
          ok: deriveToolResultOk(output),
        });
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
          emitDebugEvent(debug, {
            type: 'tool.result',
            iteration,
            tool: call.name,
            callId,
            callIndex,
            callCount,
            output,
            ok: deriveToolResultOk(output),
          });
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
          emitDebugEvent(debug, {
            type: 'tool.result',
            iteration,
            tool: call.name,
            callId,
            callIndex,
            callCount,
            output,
            ok: deriveToolResultOk(output),
          });
          nextInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: safeJSONStringify(output),
          });
          continue;
        }

        if (call.name === 'consult_specialist') {
          const output = await runtime.consult_specialist(args as { specialistType: SpecialistType; question: string; focus?: string | null });
          trace?.toolCalls.push({ tool: call.name, input: args, output });
          emitDebugEvent(debug, {
            type: 'tool.result',
            iteration,
            tool: call.name,
            callId,
            callIndex,
            callCount,
            output,
            ok: deriveToolResultOk(output),
          });
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
          emitDebugEvent(debug, {
            type: 'tool.result',
            iteration,
            tool: call.name,
            callId,
            callIndex,
            callCount,
            output,
            ok: deriveToolResultOk(output),
          });
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
          emitDebugEvent(debug, {
            type: 'tool.result',
            iteration,
            tool: call.name,
            callId,
            callIndex,
            callCount,
            output,
            ok: deriveToolResultOk(output),
          });
          nextInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: safeJSONStringify(output),
          });
          return { finished: true };
        }

        const output = { error: 'unknown_tool', name: call.name };
        trace?.toolCalls.push({ tool: call.name, input: args, output });
        emitDebugEvent(debug, {
          type: 'tool.result',
          iteration,
          tool: call.name,
          callId,
          callIndex,
          callCount,
          output,
          ok: deriveToolResultOk(output),
        });
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
        emitDebugEvent(debug, {
          type: 'tool.result',
          iteration,
          tool: call.name,
          callId,
          callIndex,
          callCount,
          output,
          ok: deriveToolResultOk(output),
        });
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

function deriveToolResultOk(output: unknown): boolean | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const record = output as Record<string, unknown>;
  if (typeof record.ok === 'boolean') return record.ok;
  if (typeof record.error === 'string') return false;
  return undefined;
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
    agent: 'gm' | 'npc' | 'narrator' | 'specialist';
    responseId?: string;
    previousResponseId?: string;
    inputItems?: number;
    outputItems?: number;
    toolCalls?: number;
    usage?: unknown;
    status?: string;
    error?: unknown;
    specialistType?: SpecialistType;
  },
) {
  if (!trace) return;
  trace.llmCalls = trace.llmCalls || [];
  trace.llmCalls.push(entry);
}
