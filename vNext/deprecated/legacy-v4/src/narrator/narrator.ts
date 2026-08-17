/**
 * Chronicle v4 - Narrator
 * 
 * Generates prose from world state changes.
 * Simplified context, kept style options.
 */

import OpenAI from 'openai';
import type { World } from '../core/world';
import type { Patch } from '../core/arbiter';
import type { Telemetry } from '../core/systems';
import { buildTelemetry } from '../core/systems';

// ============================================================================
// TYPES
// ============================================================================

export type NarratorStyle = 'lyric' | 'cinematic' | 'michener';

export interface NarratorParams {
  apiKey?: string;
  model?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  world: World;
  playerText: string;
  patches: Patch[];
  style?: NarratorStyle;
  telemetry?: Telemetry;
}

// ============================================================================
// STYLE PROMPTS
// ============================================================================

const STYLE_PROMPTS: Record<NarratorStyle, string> = {
  lyric: `You are the Historian observing a living world. Your perspective is intimate and sensory. 
Describe what is present, what is in motion. Imply possibility without asserting unseen facts.
Prefer concrete nouns and verbs over abstract sentiment. Keep it concise: 3-7 sentences.`,
  
  cinematic: `You are the Historian observing a living world. Your perspective is clear and grounded in concrete detail.
Describe what is present and what is changing. Use cinematic style: visual, specific, grounded.
Keep to 3-6 sentences.`,
  
  michener: `You are the Historian observing a living world. Your perspective is direct and attentive to materials and spatial relations.
Describe what is there. Report the present, imply the possible.
Ban generic abstractions. Keep to 3-5 sentences.`,
};

const STYLE_TEMPS: Record<NarratorStyle, number> = {
  lyric: 0.95,
  cinematic: 0.85,
  michener: 0.75,
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export async function narrate(params: NarratorParams): Promise<string> {
  const { apiKey, model = 'gpt-5.2', reasoningEffort = 'none', world, playerText, patches, style = 'michener' } = params;

  // No API key = fallback
  if (!apiKey) {
    return narrateFallback(world, playerText, patches);
  }

  const telemetry = params.telemetry || buildTelemetry(world);
  const context = buildNarratorContext(telemetry, playerText, patches);

  const client = new OpenAI({ apiKey });
  
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: STYLE_PROMPTS[style] },
        { role: 'user', content: context },
      ],
      temperature: STYLE_TEMPS[style],
      // @ts-ignore
      max_completion_tokens: 300,
      // @ts-ignore - reasoning_effort is new
      reasoning_effort: reasoningEffort,
    });

    return response.choices[0]?.message?.content?.trim() || narrateFallback(world, playerText, patches);
  } catch (err) {
    console.error('Narrator error:', err instanceof Error ? err.message : err);
    return narrateFallback(world, playerText, patches);
  }
}

// ============================================================================
// CONTEXT BUILDER (Simplified)
// ============================================================================

function buildNarratorContext(telemetry: Telemetry, playerText: string, patches: Patch[]): string {
  const loc = telemetry.location;
  const player = telemetry.player;
  const time = telemetry.time;
  const weather = telemetry.weather;

  const lines: string[] = [
    `Location: ${loc.name}`,
    `Description: ${loc.description}`,
    `Position: (${player.position.x.toFixed(0)}, ${player.position.y.toFixed(0)})`,
  ];

  if (loc.items.length) {
    lines.push(`Visible items: ${loc.items.map(i => i.name).join(', ')}`);
  }

  if (telemetry.nearbyLocations.length) {
    const nearby = telemetry.nearbyLocations.slice(0, 3).map(l => 
      `${l.name} (${l.bearing || 'nearby'}, ~${Math.round(l.distance)}m)`
    ).join(', ');
    lines.push(`Nearby: ${nearby}`);
  }

  if (time) {
    lines.push(`Time: ${time.timeOfDay}, hour ${time.currentHour}`);
  }

  if (weather) {
    lines.push(`Weather: ${weather.type}, ${weather.temperatureC}°C`);
  }

  lines.push(`\nPlayer: ${playerText}`);

  if (patches.length) {
    const changes = patches.map(p => p.note || p.path).join('; ');
    lines.push(`Changes: ${changes}`);
  }

  lines.push(`\nRecent events:\n${telemetry.ledgerTail.map(e => `- ${e}`).join('\n')}`);

  return lines.join('\n');
}

// ============================================================================
// FALLBACK
// ============================================================================

function narrateFallback(world: World, playerText: string, patches: Patch[]): string {
  const loc = world.locations[world.player.location];
  const desc = loc?.description || 'You are somewhere unfamiliar.';
  
  if (/look|observe|glance/i.test(playerText)) {
    return `You take it in: ${desc}`;
  }

  if (patches.length) {
    const lastNote = patches[patches.length - 1]?.note;
    return lastNote ? `${lastNote}. ${desc}` : desc;
  }

  return `The moment stretches quietly. ${desc}`;
}

// ============================================================================
// INITIAL NARRATION
// ============================================================================

export async function generateInitialNarration(params: {
  apiKey?: string;
  model?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  world: World;
}): Promise<string> {
  const { apiKey, model = 'gpt-5.2', reasoningEffort = 'none', world } = params;

  if (!apiKey) {
    return world.locations[world.player.location]?.description || 'You find yourself in an unfamiliar place.';
  }

  const telemetry = buildTelemetry(world);
  const context = buildNarratorContext(telemetry, 'The scene begins.', []);

  const client = new OpenAI({ apiKey });

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { 
          role: 'system', 
          content: 'You are beginning a story. Write the opening paragraph of a novel. Introduce the player to their surroundings using the provided info. Be cinematic: clear, visual, grounded in sensory detail.' 
        },
        { role: 'user', content: context },
      ],
      temperature: 0.85,
      // @ts-ignore
      max_completion_tokens: 400,
      // @ts-ignore - reasoning_effort is new
      reasoning_effort: reasoningEffort,
    });

    return response.choices[0]?.message?.content?.trim() || 
      world.locations[world.player.location]?.description || 
      'You find yourself in an unfamiliar place.';
  } catch {
    return world.locations[world.player.location]?.description || 'You find yourself in an unfamiliar place.';
  }
}

