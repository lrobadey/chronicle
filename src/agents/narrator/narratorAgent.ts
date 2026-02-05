import type { LLMClient } from '../llm/types';
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
}

export interface NarratorOpeningParams {
  apiKey?: string;
  model?: string;
  style?: NarratorStyle;
  telemetry: Telemetry;
  llm: LLMClient;
}

export async function narrateTurn(params: NarratorParams): Promise<string> {
  const { apiKey, model = 'gpt-5.2', style = 'michener', telemetry, diff, llm } = params;
  if (!apiKey) {
    return fallbackNarration(telemetry, diff);
  }
  const response = await llm.responsesCreate({
    apiKey,
    model,
    instructions: NARRATOR_STYLE_PROMPTS[style],
    input: JSON.stringify({ telemetry, diff }),
  });
  return response.output_text?.trim() || fallbackNarration(telemetry, diff);
}

export async function narrateOpening(params: NarratorOpeningParams): Promise<string> {
  const { apiKey, model = 'gpt-5.2', style = 'cinematic', telemetry, llm } = params;
  if (!apiKey) {
    return telemetry.location.description || 'You find yourself in an unfamiliar place.';
  }
  const response = await llm.responsesCreate({
    apiKey,
    model,
    instructions: 'Write the opening paragraph of a novel. Introduce the player to their surroundings using the provided info. Be cinematic: clear, visual, grounded.',
    input: JSON.stringify({ telemetry }),
  });
  return response.output_text?.trim() || telemetry.location.description || 'You find yourself in an unfamiliar place.';
}

function fallbackNarration(telemetry: Telemetry, diff: TurnDiff): string {
  if (diff.moved) return `You arrive at ${telemetry.location.name}. ${telemetry.location.description}`;
  if (diff.newItems.length) return `You now carry ${diff.newItems.join(', ')}. ${telemetry.location.description}`;
  return telemetry.location.description || 'The moment stretches quietly.';
}
