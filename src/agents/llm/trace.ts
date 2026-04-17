import type { ResponseOutputItem } from './types';
import type { SpecialistType } from '../specialists';
import type { TurnTraceLLMCall, TurnTraceToolCall } from '../../engine/session/types';

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
) {
  if (!trace) return;
  trace.llmCalls = trace.llmCalls || [];
  trace.llmCalls.push(entry);
}

export function pushToolTrace(
  trace: { toolCalls?: TurnTraceToolCall[] } | undefined,
  entry: Omit<TurnTraceToolCall, 'executionMs'> & { executionMs?: number },
  startedAtMs?: number,
) {
  if (!trace) return;
  trace.toolCalls = trace.toolCalls || [];
  const executionMs = typeof startedAtMs === 'number'
    ? Math.max(0, Date.now() - startedAtMs)
    : entry.executionMs;
  trace.toolCalls.push(executionMs === undefined ? entry : { ...entry, executionMs });
}
