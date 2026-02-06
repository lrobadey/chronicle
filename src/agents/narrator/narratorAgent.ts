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
  playerText: string;
  telemetry: Telemetry;
  diff: TurnDiff;
  rejectedEvents?: Array<{ reason: string; event?: unknown }>;
  llm: LLMClient;
  onNarrationDelta?: (delta: string) => void;
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
  onOpeningDelta?: (delta: string) => void;
  trace?: NarratorParams['trace'];
}

export async function narrateTurn(params: NarratorParams): Promise<string> {
  const { apiKey, model = 'gpt-5.2', style = 'michener', playerText, telemetry, diff, rejectedEvents, llm, onNarrationDelta, trace } = params;
  if (!apiKey) {
    const fallback = fallbackNarration(playerText, telemetry, diff, rejectedEvents);
    onNarrationDelta?.(fallback);
    return fallback;
  }
  try {
    const response = await llm.responsesCreate({
      apiKey,
      model,
      stream: true,
      onOutputTextDelta: onNarrationDelta,
      instructions: NARRATOR_STYLE_PROMPTS[style],
      input: JSON.stringify({
        attemptedAction: playerText,
        telemetry,
        diff,
        rejectedEventReasons: (rejectedEvents || []).map(rejection => rejection.reason),
      }),
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
    const rendered = response.output_text?.trim() || fallbackNarration(playerText, telemetry, diff, rejectedEvents);
    if (!response.output_text?.trim()) {
      onNarrationDelta?.(rendered);
    }
    return rendered;
  } catch (error) {
    pushLLMTrace(trace, {
      agent: 'narrator',
      inputItems: 1,
      status: 'failed',
      error: classifyLLMError(error),
    });
    const fallback = fallbackNarration(playerText, telemetry, diff, rejectedEvents);
    onNarrationDelta?.(fallback);
    return fallback;
  }
}

export async function narrateOpening(params: NarratorOpeningParams): Promise<string> {
  const { apiKey, model = 'gpt-5.2', style = 'cinematic', telemetry, llm, onOpeningDelta, trace } = params;
  if (!apiKey) {
    const fallback = telemetry.location.description || 'You find yourself in an unfamiliar place.';
    onOpeningDelta?.(fallback);
    return fallback;
  }
  try {
    const response = await llm.responsesCreate({
      apiKey,
      model,
      stream: true,
      onOutputTextDelta: onOpeningDelta,
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
    const rendered = response.output_text?.trim() || telemetry.location.description || 'You find yourself in an unfamiliar place.';
    if (!response.output_text?.trim()) {
      onOpeningDelta?.(rendered);
    }
    return rendered;
  } catch (error) {
    pushLLMTrace(trace, {
      agent: 'narrator',
      inputItems: 1,
      status: 'failed',
      error: classifyLLMError(error),
    });
    const fallback = telemetry.location.description || 'You find yourself in an unfamiliar place.';
    onOpeningDelta?.(fallback);
    return fallback;
  }
}

function fallbackNarration(
  playerText: string,
  telemetry: Telemetry,
  diff: TurnDiff,
  rejectedEvents?: Array<{ reason: string; event?: unknown }>,
): string {
  if (diff.moved) return `You arrive at ${telemetry.location.name}. ${telemetry.location.description}`;
  if (diff.newItems.length) return `You now carry ${diff.newItems.join(', ')}. ${telemetry.location.description}`;
  if (diff.timeDeltaMinutes > 0) return `${diff.timeDeltaMinutes} minutes pass. ${telemetry.location.description}`;
  const attempted = formatAttemptedAction(playerText);
  const rejectionSuffix = rejectedEvents?.length
    ? ` (${rejectedEvents[0]?.reason || 'no_effect'})`
    : '';
  return `${attempted}, but nothing significant changes${rejectionSuffix}. ${telemetry.location.description || 'The moment stretches quietly.'}`;
}

function formatAttemptedAction(playerText: string): string {
  const trimmed = playerText.trim();
  if (!trimmed) return 'You pause';
  if (/^i\s+/i.test(trimmed)) return `You ${trimmed.slice(2).trim()}`;
  if (/^you\s+/i.test(trimmed)) return trimmed[0].toUpperCase() + trimmed.slice(1);
  return `You try to ${trimmed}`;
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
