import type { ResponseOutputItem } from './types';
import type { SpecialistType } from '../specialists';
import type { TurnTraceLLMCall, TurnTraceToolCall } from '../../engine/session/types';
import { emitDebugEvent, type DebugSink } from '../../engine/debug';

export function isFunctionCallItem(item: ResponseOutputItem): item is {
  type: 'function_call';
  name: string;
  arguments: string;
  call_id?: string;
} {
  return item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string';
}

export function pushLLMTrace(
  trace: { llmCalls?: TurnTraceLLMCall[] } | undefined,
  entry: TurnTraceLLMCall & { specialistType?: SpecialistType },
  startedAtMs?: number,
  debug?: DebugSink | null,
) {
  const sink = debug === null ? undefined : debug ?? readTraceDebugSink(trace);
  let enriched: TurnTraceLLMCall & { specialistType?: SpecialistType } = entry;
  if (entry.reasoningHeadings?.length) {
    enriched = {
      ...enriched,
      reasoningHeadings: entry.reasoningHeadings.map(heading => heading.trim()).filter(Boolean),
    };
  }
  if (typeof startedAtMs === 'number' && typeof enriched.durationMs !== 'number') {
    const endedAtMs = typeof enriched.endedAtMs === 'number' ? enriched.endedAtMs : Date.now();
    enriched = {
      ...enriched,
      startedAtMs: enriched.startedAtMs ?? startedAtMs,
      endedAtMs,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
    };
  }
  emitDebugEvent(sink, {
    type: 'llm.response.received',
    agent: enriched.agent,
    specialistType: enriched.specialistType,
    status: enriched.status,
    responseId: enriched.responseId,
    toolCalls: enriched.toolCalls,
    reasoningHeadings: enriched.reasoningHeadings,
    error: enriched.error,
  });
  if (!trace) return;
  trace.llmCalls = trace.llmCalls || [];
  trace.llmCalls.push(enriched);
}

export function pushToolTrace(
  trace: { toolCalls?: TurnTraceToolCall[] } | undefined,
  entry: Omit<TurnTraceToolCall, 'executionMs'> & { executionMs?: number },
  startedAtMs?: number,
  debug?: DebugSink | null,
) {
  const sink = debug === null ? undefined : debug ?? readTraceDebugSink(trace);
  const executionMs = typeof startedAtMs === 'number'
    ? Math.max(0, Date.now() - startedAtMs)
    : entry.executionMs;
  const enriched = executionMs === undefined ? entry : { ...entry, executionMs };
  emitDebugEvent(sink, {
    type: 'trace.tool.result',
    tool: enriched.tool,
    input: enriched.input,
    output: enriched.output,
    agent: enriched.agent,
    iteration: enriched.iteration,
    callId: enriched.callId,
    callIndex: enriched.callIndex,
    callCount: enriched.callCount,
    stage: enriched.stage,
    executionMs: enriched.executionMs,
    ok: deriveToolResultOk(enriched.output),
  });
  if (!trace) return;
  trace.toolCalls = trace.toolCalls || [];
  trace.toolCalls.push(enriched);
}

function readTraceDebugSink(trace: unknown): DebugSink | undefined {
  const sink = (trace as { debugSink?: unknown } | undefined)?.debugSink;
  return typeof sink === 'function' ? sink as DebugSink : undefined;
}

export function emitTraceToolCalled(
  debug: unknown,
  entry: Omit<TurnTraceToolCall, 'output' | 'executionMs'>,
) {
  const sink = typeof debug === 'function' ? debug as DebugSink : readTraceDebugSink(debug);
  emitDebugEvent(sink, {
    type: 'trace.tool.called',
    tool: entry.tool,
    input: entry.input,
    agent: entry.agent,
    iteration: entry.iteration,
    callId: entry.callId,
    callIndex: entry.callIndex,
    callCount: entry.callCount,
    stage: entry.stage,
  });
}

function deriveToolResultOk(output: unknown): boolean | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const record = output as { ok?: unknown; error?: unknown };
  if (typeof record.ok === 'boolean') return record.ok;
  if (record.error != null) return false;
  return undefined;
}
