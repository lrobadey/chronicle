import type { ResponseOutputItem } from './types';
import type { SpecialistType } from '../specialists';

export function isFunctionCallItem(item: ResponseOutputItem): item is {
  type: 'function_call';
  name: string;
  arguments: string;
  call_id?: string;
} {
  return item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string';
}

export function pushLLMTrace(
  trace: { llmCalls?: any[] } | undefined,
  entry: {
    agent: 'gm' | 'steward' | 'legacy_gm' | 'observer' | 'npc' | 'narrator' | 'specialist' | 'mechanics' | 'schedule' | 'staff_interview';
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
