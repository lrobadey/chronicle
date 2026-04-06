import type { LLMClient } from '../llm/types';
import { DEFAULT_MODEL } from '../llm/defaults';
import { classifyLLMError } from '../llm/errorUtils';
import { NARRATOR_STYLE_PROMPTS } from './prompts';
import type { Telemetry } from '../../sim/views/telemetry';
import type { TurnDiff } from '../../sim/views/diff';
import type { PendingPrompt } from '../../sim/state';
import type { DebugSink } from '../../engine/debug';
import { emitDebugEvent } from '../../engine/debug';
import type { OpeningContext, OpeningRecap } from '../../engine/contextBuilders';
import type { RecentTurnDigest } from '../../engine/session/types';
import type { SpecialistType } from '../specialists';

export type NarratorStyle = 'lyric' | 'cinematic' | 'michener';
export type OpeningMode = 'first-world' | 'resume';

export interface NarratorParams {
  apiKey?: string;
  model?: string;
  style?: NarratorStyle;
  playerText: string;
  telemetry: Telemetry;
  diff: TurnDiff;
  recentTurns: RecentTurnDigest[];
  opening?: OpeningRecap | null;
  pendingPrompt?: PendingPrompt | null;
  rejectedEvents?: Array<{ reason: string; event?: unknown }>;
  llm: LLMClient;
  onNarrationDelta?: (delta: string) => void;
  debug?: DebugSink;
  trace?: {
    llmCalls?: Array<{
      agent: 'gm' | 'npc' | 'narrator' | 'specialist' | 'mechanics';
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

export interface NarratorOpeningParams {
  apiKey?: string;
  model?: string;
  style?: NarratorStyle;
  telemetry: Telemetry;
  openingMode?: OpeningMode;
  openingContext?: OpeningContext | null;
  llm: LLMClient;
  onOpeningDelta?: (delta: string) => void;
  debug?: DebugSink;
  trace?: NarratorParams['trace'];
}

export async function narrateTurn(params: NarratorParams): Promise<string> {
  const { apiKey, model = DEFAULT_MODEL, style = 'michener', playerText, telemetry, diff, recentTurns, opening = null, pendingPrompt, rejectedEvents, llm, onNarrationDelta, debug, trace } = params;
  emitDebugEvent(debug, { type: 'narrator.started', phase: 'turn', style });
  if (pendingPrompt?.question?.trim()) {
    const question = pendingPrompt.question.trim();
    onNarrationDelta?.(question);
    emitDebugEvent(debug, { type: 'narrator.completed', phase: 'turn', text: question });
    return question;
  }
  if (!apiKey) {
    const fallback = fallbackNarration(playerText, telemetry, diff, rejectedEvents);
    onNarrationDelta?.(fallback);
    emitDebugEvent(debug, { type: 'narrator.completed', phase: 'turn', text: fallback });
    return fallback;
  }
  try {
    let streamedText = '';
    const response = await llm.responsesCreate({
      apiKey,
      model,
      stream: true,
      onOutputTextDelta: delta => {
        streamedText += delta;
        onNarrationDelta?.(delta);
      },
      instructions: NARRATOR_STYLE_PROMPTS[style],
      input: JSON.stringify({
        attemptedAction: playerText,
        opening,
        recentTurns,
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
    const rendered = response.output_text?.trim() || streamedText.trim() || fallbackNarration(playerText, telemetry, diff, rejectedEvents);
    if (!response.output_text?.trim() && !streamedText.trim()) {
      onNarrationDelta?.(rendered);
    }
    emitDebugEvent(debug, { type: 'narrator.completed', phase: 'turn', text: rendered });
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
    emitDebugEvent(debug, { type: 'narrator.completed', phase: 'turn', text: fallback });
    return fallback;
  }
}

export async function narrateOpening(params: NarratorOpeningParams): Promise<string> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    style = 'cinematic',
    telemetry,
    openingMode = 'resume',
    openingContext = null,
    llm,
    onOpeningDelta,
    debug,
    trace,
  } = params;
  emitDebugEvent(debug, { type: 'narrator.started', phase: 'opening', style });
  if (!apiKey) {
    const fallback = fallbackOpening(telemetry, openingMode, openingContext);
    onOpeningDelta?.(fallback);
    emitDebugEvent(debug, { type: 'narrator.completed', phase: 'opening', text: fallback });
    return fallback;
  }
  try {
    let streamedText = '';
    const response = await llm.responsesCreate({
      apiKey,
      model,
      stream: true,
      onOutputTextDelta: delta => {
        streamedText += delta;
        onOpeningDelta?.(delta);
      },
      instructions: openingInstructions(openingMode),
      input: JSON.stringify({ openingMode, telemetry, openingContext }),
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
    const rendered = response.output_text?.trim() || streamedText.trim() || fallbackOpening(telemetry, openingMode, openingContext);
    if (!response.output_text?.trim() && !streamedText.trim()) {
      onOpeningDelta?.(rendered);
    }
    emitDebugEvent(debug, { type: 'narrator.completed', phase: 'opening', text: rendered });
    return rendered;
  } catch (error) {
    pushLLMTrace(trace, {
      agent: 'narrator',
      inputItems: 1,
      status: 'failed',
      error: classifyLLMError(error),
    });
    const fallback = fallbackOpening(telemetry, openingMode, openingContext);
    onOpeningDelta?.(fallback);
    emitDebugEvent(debug, { type: 'narrator.completed', phase: 'opening', text: fallback });
    return fallback;
  }
}

function openingInstructions(openingMode: OpeningMode): string {
  if (openingMode === 'first-world') {
    return [
      'You are the Chronicle GM speaking directly to the player in a James Michener-inspired voice: grounded, observant, quietly vivid.',
      'Write the absolute first message for a newly created world.',
      'Treat the player as a new arrival at early morning light.',
      'Anchor the scene at the docks or landing.',
      'Foreground exactly one local already in motion and show that local reacting to the tide-linked routine or anomaly supplied in openingContext.',
      'Leave the player with one clear immediate question to pursue, phrased in-world rather than as a menu.',
      'Use the provided telemetry and openingContext as truth. You may add non-critical atmosphere, but do not invent new game-relevant facts beyond them.',
      'Avoid generic abstractions. Favor concrete nouns and verbs. Keep it to one short paragraph.',
    ].join(' ');
  }

  return 'You are the Chronicle GM speaking directly to the player in a James Michener-inspired voice: grounded, observant, quietly vivid. Write a brief opening paragraph that reorients the player to their current surroundings using the provided telemetry. You may add non-critical atmosphere consistent with what is already known, but do not invent new game-relevant facts. Avoid generic abstractions; favor concrete nouns and verbs.';
}

function fallbackNarration(
  playerText: string,
  telemetry: Telemetry,
  diff: TurnDiff,
  rejectedEvents?: Array<{ reason: string; event?: unknown }>,
): string {
  if (diff.moved) return `You arrive at ${telemetry.location.name}. ${telemetry.location.description}`;
  if (diff.newItems.length) return `You now carry ${diff.newItems.join(', ')}. ${telemetry.location.description}`;
  if (diff.newClues?.length) return `You learn ${diff.newClues.join('; ')}. ${telemetry.location.description}`;
  if (diff.timeDeltaMinutes > 0) return `${diff.timeDeltaMinutes} minutes pass. ${telemetry.location.description}`;
  const attempted = formatAttemptedAction(playerText);
  const rejectionSuffix = rejectedEvents?.length
    ? ` (${rejectedEvents[0]?.reason || 'no_effect'})`
    : '';
  return `${attempted}, but nothing significant changes${rejectionSuffix}. ${telemetry.location.description || 'The moment stretches quietly.'}`;
}

function fallbackOpening(
  telemetry: Telemetry,
  openingMode: OpeningMode,
  openingContext: OpeningContext | null,
): string {
  if (openingMode === 'first-world' && openingContext) {
    return `You come in at first light at ${openingContext.focusLocation.name}, where ${telemetry.location.description.toLowerCase()} ${openingContext.openingHook} ${openingContext.playerQuestion}`;
  }

  return telemetry.location.description || 'You find yourself in an unfamiliar place.';
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
    agent: 'gm' | 'npc' | 'narrator' | 'specialist' | 'mechanics';
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
