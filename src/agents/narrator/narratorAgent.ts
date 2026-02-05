import type { LLMClient } from '../llm/types';
import { classifyLLMError } from '../llm/errorUtils';
import { NARRATOR_STYLE_PROMPTS } from './prompts';
import type { Telemetry } from '../../sim/views/telemetry';
import type { TurnDiff } from '../../sim/views/diff';

export type NarratorStyle = 'lyric' | 'cinematic' | 'michener';

export interface NarratorParams {
  apiKey?: string;
  model?: string;
  style?: NarratorStyle;
  telemetry: Telemetry;
  diff: TurnDiff;
  llm: LLMClient;
  trace?: {
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

export interface NarratorOpeningParams {
  apiKey?: string;
  model?: string;
  style?: NarratorStyle;
  telemetry: Telemetry;
  llm: LLMClient;
  trace?: NarratorParams['trace'];
}

export async function narrateTurn(params: NarratorParams): Promise<string> {
  const { apiKey, model = 'gpt-5.2', style = 'michener', telemetry, diff, llm, trace } = params;
  if (!apiKey) {
    return fallbackNarration(telemetry, diff);
  }
  try {
    const response = await llm.responsesCreate({
      apiKey,
      model,
      instructions: NARRATOR_STYLE_PROMPTS[style],
      input: JSON.stringify({ telemetry, diff }),
      truncation: 'auto',
      store: true,
    });
    pushLLMTrace(trace, {
      agent: 'narrator',
      responseId: response.id,
      inputItems: 1,
      outputItems: response.output.length,
      toolCalls: response.output.filter(item => item.type === 'function_call').length,
      usage: response.usage,
      status: response.status,
      error: response.error ?? response.incomplete_details,
    });
    return response.output_text?.trim() || fallbackNarration(telemetry, diff);
  } catch (error) {
    pushLLMTrace(trace, {
      agent: 'narrator',
      inputItems: 1,
      status: 'failed',
      error: classifyLLMError(error),
    });
    return fallbackNarration(telemetry, diff);
  }
}

export async function narrateOpening(params: NarratorOpeningParams): Promise<string> {
  const { apiKey, model = 'gpt-5.2', style = 'cinematic', telemetry, llm, trace } = params;
  if (!apiKey) {
    return telemetry.location.description || 'You find yourself in an unfamiliar place.';
  }
  try {
    const response = await llm.responsesCreate({
      apiKey,
      model,
      instructions: 'Write the opening paragraph of a novel. Introduce the player to their surroundings using the provided info. Be cinematic: clear, visual, grounded.',
      input: JSON.stringify({ telemetry }),
      truncation: 'auto',
      store: true,
    });
    pushLLMTrace(trace, {
      agent: 'narrator',
      responseId: response.id,
      inputItems: 1,
      outputItems: response.output.length,
      toolCalls: response.output.filter(item => item.type === 'function_call').length,
      usage: response.usage,
      status: response.status,
      error: response.error ?? response.incomplete_details,
    });
    return response.output_text?.trim() || telemetry.location.description || 'You find yourself in an unfamiliar place.';
  } catch (error) {
    pushLLMTrace(trace, {
      agent: 'narrator',
      inputItems: 1,
      status: 'failed',
      error: classifyLLMError(error),
    });
    return telemetry.location.description || 'You find yourself in an unfamiliar place.';
  }
}

function fallbackNarration(telemetry: Telemetry, diff: TurnDiff): string {
  if (diff.moved) return `You arrive at ${telemetry.location.name}. ${telemetry.location.description}`;
  if (diff.newItems.length) return `You now carry ${diff.newItems.join(', ')}. ${telemetry.location.description}`;
  return telemetry.location.description || 'The moment stretches quietly.';
}

function pushLLMTrace(
  trace: NarratorParams['trace'] | undefined,
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
