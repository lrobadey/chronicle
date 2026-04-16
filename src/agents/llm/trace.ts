import type { ResponseOutputItem } from './types';
import type { SpecialistType } from '../specialists';
import type { TurnTraceLLMCall } from '../../engine/session/types';

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
