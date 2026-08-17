import { ChatOpenAI } from '@langchain/openai';
import type { SimpleWorld } from '../state/world';
import type { Patch, ProjectPKGOutput } from '../tools/types';
import { NARRATOR_MODEL, NARRATOR_DEFAULT_STYLE } from '../config';
import { buildTurnTelemetry, type TurnTelemetry } from '../state/telemetry';
import { projectPKGFromGraph } from '../state/pkg';
import { buildFilteredContext, formatFilteredContext } from './context/filter';

export type NarratorStyle = 'lyric' | 'cinematic' | 'michener';

export interface ConversationHistoryEntry {
  playerInput: string;
  gmOutput: string;
  patches: Patch[];
  timestamp: Date;
}

// Structured scene affordances (typed, not prose)
type Affordance =
  | { type: 'inspect_item'; item: string }
  | { type: 'approach_place'; name: string; bearing: string; distanceM: number }
  | { type: 'environment_window'; window: 'tide_falling' | 'tide_rising' }
  | { type: 'practical_need'; need: 'light' | 'shelter' };
const STYLE_PROMPTS: Record<NarratorStyle, string> = {
  lyric:
    'You are the Historian observing a living world. Your perspective is intimate and sensory. Time continues between moments; describe what is present and, in restrained ways, what is in motion or changing—imply possibility without asserting unseen facts. You are telling a story. Keep in mind what surrounds the player: visible items, nearby places, the state of time and tide, what they have encountered. Let these elements naturally shape the narrative. Consider how the situation could evolve or shift organically as moments pass. If addressed directly, you may briefly acknowledge the player. Avoid meta/system talk. Stay consistent with the provided state. Avoid clichés and filler. Do not use stock phrases like "ebb and flow", "turn the tide", "possibility thrums", "prospects", "choices unfurl", or similar abstractions. Prefer concrete nouns and verbs over abstract sentiment. Keep it concise: 3–7 sentences.',
  cinematic:
    'You are the Historian observing a living world. Your perspective is clear and grounded in concrete detail. Time continues between moments; describe what is present and, in restrained ways, what is in motion or changing—imply possibility without asserting unseen facts. You are telling a story. Keep in mind what surrounds the player—visible items, nearby places, time and tide, recent events. Let these elements inform the narrative naturally. Consider how the situation might shift as moments pass. If addressed directly, you may briefly acknowledge the player. Avoid meta/system talk. Stay consistent with the provided state. Avoid over-poetic language and clichés (e.g., "ebb and flow", "turn the tide", "the air hums with possibility"). Prefer specifics. Keep to 3–6 sentences.',
  michener:
    'You are the Historian observing a living world. Your perspective is direct, precise, and attentive to materials and spatial relations. Time continues between moments; describe what is present and, in restrained ways, what is in motion or changing—subtly imply possibility, building on what is known without asserting unseen facts. You are telling a story through an interactive novel. Keep in mind what surrounds the player: visible items, nearby places, time and tide, materials and space. Let these elements shape the narrative. Consider how the situation could evolve organically. If addressed directly, you may briefly acknowledge the player. Avoid meta/system talk. Stay consistent with the provided state. Ban generic abstractions and clichés; report what is there.',
};

const STYLE_TEMPS: Record<NarratorStyle, number> = {
  lyric: 0.95,
  cinematic: 0.875,
  michener: 0.8,
};

const NARRATOR_MODEL_KWARGS = NARRATOR_MODEL === 'gpt-5.1' ? { reasoning_effort: 'low' as const } : undefined;

// Global truth rules to prevent contradictions of GM-provided facts
const NARRATOR_TRUTH_RULES = `
You must treat structured facts from the GM/tool layer as canonical truth.
Do not contradict distances, ETAs, blocked access, player position, time, or tide if provided.
Prefer concrete quantities over vague proximity. If metrics are provided, you may state them plainly.
Never invent new state.
`;

function ledgerTail(world: SimpleWorld, n = 5): string {
  return world.ledger.slice(-n).map((entry) => `- ${entry}`).join('\n') || '- (no recent entries)';
}

// Deterministic, telemetry-grounded affordance derivation
function deriveAffordances(telemetry: TurnTelemetry, pkg?: ProjectPKGOutput): Affordance[] {
  const out: Affordance[] = [];

  // Items visible in current location (already player-visible via telemetry)
  if (telemetry.location.items?.length) {
    out.push(
      ...telemetry.location.items.slice(0, 3).map((i) => ({
        type: 'inspect_item' as const,
        item: i.name,
      }))
    );
  }

  // Nearby locations (already filtered + bounded in telemetry)
  if (telemetry.nearbyLocations?.length) {
    out.push(
      ...telemetry.nearbyLocations.slice(0, 3).map((l) => ({
        type: 'approach_place' as const,
        name: l.name,
        bearing: l.bearing || 'nearby',
        distanceM: Math.round(l.distance),
      }))
    );
  }

  // Environmental windows (kept minimal and generic)
  const tidePhase = telemetry.systems?.tide?.phase;
  if (tidePhase === 'falling') out.push({ type: 'environment_window', window: 'tide_falling' });
  if (tidePhase === 'rising') out.push({ type: 'environment_window', window: 'tide_rising' });

  // Practical considerations from time of day
  const hour = telemetry.systems?.time?.currentHour;
  if (typeof hour === 'number' && hour >= 18) out.push({ type: 'practical_need', need: 'light' });

  // Dedupe and cap for clarity and determinism
  const seen = new Set<string>();
  const deduped = out.filter((a) => {
    const key = JSON.stringify(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, 4);
}

export interface RunNarratorTurnParams {
  apiKey?: string;
  playerText: string;
  world: SimpleWorld;
  patches: Patch[];
  stateSummary: any;
  pkg?: ProjectPKGOutput; // Player Knowledge Graph (what the player knows)
  conversationHistory?: ConversationHistoryEntry[]; // optional: full conversation history for context
  priorNarration?: string[]; // deprecated: kept for backward compatibility
  style?: NarratorStyle;
  telemetry?: TurnTelemetry; // NEW: Pass telemetry directly
  reasoning?: NarratorReasoning; // Optional manual reasoning (useful for tests/offline)
}

// Add a new reasoning prompt and function
const REASONING_PROMPT = `
You are the Creative Director analyzing a narrative moment. Your job is to think deeply about:
- What thematic elements are present or emerging?
- What subtle details or sensory moments would enhance immersion?
- How does this moment connect to longer story arcs?
- What emotional tone should be emphasized?
- Are there opportunities for foreshadowing, callbacks, or character development?
- What should the narrator notice that others might miss?

Consider the player's journey, the world's state, and narrative momentum. Think like a director choosing what to emphasize in a scene.

Respond ONLY with compact JSON using this schema:
{
  "thematicFocus": string,
  "detailsToEmphasize": string[],
  "emotionalTone": string,
  "narrativeArcs": string[],
  "sensoryOpportunities": string[],
  "overallDirection": string
}
`;

export interface NarratorReasoning {
  thematicFocus: string;
  detailsToEmphasize: string[];
  emotionalTone: string;
  narrativeArcs: string[];
  sensoryOpportunities: string[];
  overallDirection: string;
}

async function generateNarratorReasoning(params: {
  apiKey: string;
  playerText: string;
  world: SimpleWorld;
  patches: Patch[];
  telemetry: TurnTelemetry;
  conversationHistory?: ConversationHistoryEntry[];
  pkg?: ProjectPKGOutput;
}): Promise<NarratorReasoning> {
  const { apiKey, playerText, patches, telemetry, conversationHistory = [], pkg } = params;

  const llm = new ChatOpenAI({
    apiKey,
    model: NARRATOR_MODEL,
    temperature: 0.35,
    timeout: 30000, // 30 second timeout
    maxRetries: 0,
    ...(NARRATOR_MODEL_KWARGS ? { modelKwargs: NARRATOR_MODEL_KWARGS } : {}),
  });

  const contextParts: string[] = [
    `Player intent: ${playerText}`,
    `Current location: ${telemetry.location.name} — ${telemetry.location.description}`,
    telemetry.nearbyLocations.length
      ? `Nearby locations: ${telemetry.nearbyLocations
          .slice(0, 3)
          .map((loc) => `${loc.name} (~${Math.round(loc.distance)}m ${loc.bearing || ''}`.trim() + ')')
          .join(', ')}`
      : null,
    telemetry.location.items.length
      ? `Visible items: ${telemetry.location.items.map((i) => i.name).join(', ')}`
      : null,
    telemetry.systems?.time
      ? `World time: ${telemetry.systems.time.timeOfDay}, hour ${telemetry.systems.time.currentHour}`
      : null,
    telemetry.systems?.tide ? `Tide: ${telemetry.systems.tide.phase}` : null,
    patches.length ? `Changes this turn: ${patches.map((p) => p.note || p.path).join('; ')}` : null,
    telemetry.ledgerTail.length ? `Ledger tail:\n${telemetry.ledgerTail.map((l) => `- ${l}`).join('\n')}` : null,
    conversationHistory.length
      ? `Recent dialog:\n${conversationHistory
          .slice(-3)
          .map((entry, idx) => `Turn ${idx + 1}: Player "${entry.playerInput}" → Narrator "${entry.gmOutput}"`)
          .join('\n')}`
      : null,
    pkg ? `Player knowledge snapshot: ${JSON.stringify(pkg)}` : null,
  ].filter(Boolean) as string[];

  const content = contextParts.join('\n\n');

  try {
    const res = await llm.invoke([
      { role: 'system', content: NARRATOR_TRUTH_RULES },
      { role: 'system', content: REASONING_PROMPT },
      { role: 'user', content },
    ]);

    const raw = (res?.content as any)?.toString?.() || String(res?.content || '');
    const parsed = parseReasoningJson(raw);
    if (parsed) return parsed;
  } catch (err) {
    console.warn('Narrator reasoning error:', err instanceof Error ? err.message : String(err));
  }

  return deriveHeuristicReasoning(telemetry, playerText, pkg);
}

function parseReasoningJson(raw: string): NarratorReasoning | null {
  const cleaned = raw.trim().replace(/^```json/i, '```').replace(/^```/, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return normalizeReasoning(parsed);
  } catch {
    return null;
  }
}

function normalizeReasoning(input: any): NarratorReasoning {
  const asArray = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v): v is string => Boolean(v))
        .slice(0, 5);
    }
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return [];
  };

  return {
    thematicFocus: typeof input?.thematicFocus === 'string' && input.thematicFocus.trim() ? input.thematicFocus.trim() : 'The present moment',
    detailsToEmphasize: asArray(input?.detailsToEmphasize),
    emotionalTone: typeof input?.emotionalTone === 'string' && input.emotionalTone.trim() ? input.emotionalTone.trim() : 'observant',
    narrativeArcs: asArray(input?.narrativeArcs),
    sensoryOpportunities: asArray(input?.sensoryOpportunities),
    overallDirection:
      typeof input?.overallDirection === 'string' && input.overallDirection.trim()
        ? input.overallDirection.trim()
        : 'Describe what is immediately visible and imply natural consequences.',
  };
}

function deriveHeuristicReasoning(telemetry: TurnTelemetry, playerText: string, pkg?: ProjectPKGOutput): NarratorReasoning {
  const locationName = telemetry.location.name || 'the current space';
  const thematicFocus = `Anchor the scene in ${locationName} and the player’s immediate concerns.`;
  const describedDetails = telemetry.location.description?.split('.').map((s) => s.trim()).filter(Boolean) || [];
  const itemNames = telemetry.location.items.map((i) => i.name);
  const sensoryOpportunities: string[] = [];
  if (telemetry.systems?.time) sensoryOpportunities.push(`Use ${telemetry.systems.time.timeOfDay} light/time cues`);
  if (telemetry.systems?.tide) sensoryOpportunities.push(`Reference the ${telemetry.systems.tide.phase} tide`);
  if (itemNames.length) sensoryOpportunities.push(`Highlight visible item(s): ${itemNames.slice(0, 2).join(', ')}`);

  const emotionalTone = /attack|danger|fight|run|escape|hide/i.test(playerText) ? 'tense' : 'curious';

  const narrativeArcs =
    pkg?.knownLocations
      ?.filter((loc) => loc.visited)
      .slice(-2)
      .map((loc) => `Recall time at ${loc.name}`) || [];

  return {
    thematicFocus,
    detailsToEmphasize: [...describedDetails.slice(0, 2), ...itemNames.slice(0, 1)],
    emotionalTone,
    narrativeArcs,
    sensoryOpportunities,
    overallDirection: `Describe the player’s position, what’s changing nearby, and suggest organic next steps toward ${telemetry.nearbyLocations[0]?.name || 'nearby landmarks'}.`,
  };
}

export function reasoningToGuidance(reasoning?: NarratorReasoning): string | null {
  if (!reasoning) return null;
  const lines = [
    reasoning.thematicFocus ? `Theme: ${reasoning.thematicFocus}` : null,
    reasoning.emotionalTone ? `Tone: ${reasoning.emotionalTone}` : null,
    reasoning.detailsToEmphasize.length ? `Details: ${reasoning.detailsToEmphasize.join(', ')}` : null,
    reasoning.sensoryOpportunities.length ? `Sensory: ${reasoning.sensoryOpportunities.join(', ')}` : null,
    reasoning.narrativeArcs.length ? `Arcs: ${reasoning.narrativeArcs.join(', ')}` : null,
    reasoning.overallDirection ? `Direction: ${reasoning.overallDirection}` : null,
  ].filter(Boolean) as string[];

  if (!lines.length) return null;
  return `Narrative guidance:\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

export async function runNarratorTurn(params: RunNarratorTurnParams): Promise<string> {
  const { 
    apiKey, 
    playerText, 
    world, 
    patches, 
    stateSummary, 
    pkg, 
    conversationHistory = [], 
    priorNarration = [], 
    style = NARRATOR_DEFAULT_STYLE,
    telemetry: providedTelemetry,
    reasoning: providedReasoning,
  } = params;

  if (!apiKey) {
    return narrateFallback(playerText, world, patches, stateSummary);
  }

  // Use provided telemetry or build it
  const telemetry = providedTelemetry || buildTurnTelemetry(world);

  // And keep it flowing directly from telemetry setup to canonical facts extraction

  // Extract canonical facts from stateSummary/patches for grounding
  const canonical: string[] = [];
  try {
    const ss = stateSummary || {};
    const travel = ss.travel || ss.lastTravel || ss.travelResult;
    if (travel) {
      const dist = travel.distanceMeters ?? travel.distance ?? travel.meters;
      const etaS = travel.etaSeconds ?? (typeof travel.travelTimeMinutes === 'number' ? Math.round(travel.travelTimeMinutes * 60) : undefined);
      const dest = travel.toName || travel.destinationName || travel.destination || travel.to || travel.locationId;
      const parts: string[] = [];
      if (Number.isFinite(dist)) parts.push(`distance: ${Math.round(dist)}m${dest ? ` to ${dest}` : ''}`);
      if (Number.isFinite(etaS)) parts.push(`eta: ${Math.round(etaS)}s`);
      if (parts.length) canonical.push(parts.join(', '));
    }
  } catch {}

  const llm = new ChatOpenAI({
    apiKey,
    model: NARRATOR_MODEL,
    temperature: STYLE_TEMPS[style],
    timeout: 30000, // 30 second timeout
    maxRetries: 0,
    ...(NARRATOR_MODEL_KWARGS ? { modelKwargs: NARRATOR_MODEL_KWARGS } : {}),
  });

  // Format conversation history
  const formatConversationHistory = (history: ConversationHistoryEntry[]): string => {
    if (history.length === 0) return '';
    return history.map((entry, idx) => {
      return `Turn ${idx + 1}:\nPlayer: ${entry.playerInput}\nNarrator: ${entry.gmOutput}`;
    }).join('\n\n');
  };

  const conversationContext = conversationHistory.length > 0 
    ? formatConversationHistory(conversationHistory)
    : (priorNarration.length > 0 ? `Recent narration:\n${priorNarration.map((s) => `- ${s}`).join('\n')}` : null);

  // Build context using telemetry as single source of truth
  let filteredNarratorContext: string | null = null;
  try {
    const filtered = buildFilteredContext({
      telemetry,
      pkg,
      options: { mode: 'narrator', maxChars: 2200 },
    });
    filteredNarratorContext = formatFilteredContext(filtered);
  } catch (err) {
    console.warn('Narrator context filter failed; using fallback telemetry context:', err);
  }

  const fallbackTelemetryContext = [
    `Turn ${telemetry.turn}`,
    `Location: ${telemetry.location.name}`,
    `Description: ${telemetry.location.description}`,
    `Position: (${telemetry.player.position.x.toFixed(1)}, ${telemetry.player.position.y.toFixed(1)}${telemetry.player.position.z !== undefined ? `, ${telemetry.player.position.z.toFixed(1)}` : ''})`,
    telemetry.location.items.length > 0 ? `Visible items: ${telemetry.location.items.map((i) => i.name).join(', ')}` : null,
    telemetry.nearbyLocations.length > 0 ? `Nearby: ${telemetry.nearbyLocations.map((l) => `${l.name} (${l.bearing}, ~${Math.round(l.distance)}m)`).join(', ')}` : null,
    telemetry.systems?.time ? `Time: ${telemetry.systems.time.timeOfDay}, hour ${telemetry.systems.time.currentHour}` : null,
    telemetry.systems?.tide ? `Tide: ${telemetry.systems.tide.phase}${telemetry.systems.tide.blocked.length > 0 ? ` (blocked: ${telemetry.systems.tide.blocked.join(', ')})` : ''}` : null,
  ].filter(Boolean).join('\n');

  const telemetryContext = filteredNarratorContext ?? fallbackTelemetryContext;

  // Derive scene context from telemetry (structured, not instructions)
  const affordances = deriveAffordances(telemetry, pkg);
  const sceneContext = affordances.length
    ? `Scene context (typed):\n${JSON.stringify(affordances)}`
    : null;

  let reasoning: NarratorReasoning | undefined = providedReasoning;
  if (!reasoning && apiKey) {
    try {
      reasoning = await generateNarratorReasoning({
        apiKey,
        playerText,
        world,
        patches,
        telemetry,
        conversationHistory,
        pkg,
      });
    } catch (err) {
      console.warn('Failed to build narrator reasoning:', err instanceof Error ? err.message : String(err));
    }
  }
  const reasoningContext = reasoningToGuidance(reasoning);

  const content = [
    // 1. ESTABLISH THE SCENE first - where are we, what's around
    `Telemetry:\n${telemetryContext}`,
    
    // 2. GROUND TRUTH/CONSTRAINTS immediately after - what can't be contradicted
    // This frames everything else. If Harbor Dock is 28m away, that should 
    // shape how you describe distance, movement, visibility, etc.
    canonical.length ? `Canonical facts (must not be contradicted):\n- ${canonical.join('\n- ')}` : null,
    
    // 3. CURRENT ACTION - what the player just did/said
    `Player: ${playerText}`,
    
    // 4. WHAT CHANGED - immediate consequences of the action
    `Changes this turn: ${JSON.stringify(patches)}`,
    
    // 5. WHAT'S POSSIBLE - scene affordances/options
    sceneContext,
    
    // 6. WHAT THEY KNOW - player's perspective/knowledge
    pkg ? `Player Knowledge: ${JSON.stringify(pkg)}` : null,
    
    // 7. HISTORICAL CONTEXT - what happened before (for continuity)
    conversationContext ? `Conversation history:\n${conversationContext}` : null,
    `Recent events:\n${telemetry.ledgerTail.map((s) => `- ${s}`).join('\n')}`,
    reasoningContext,
  ]
    .filter((line) => line !== null)
    .join('\n\n');

  try {
    const res = await llm.invoke([
      { role: 'system', content: NARRATOR_TRUTH_RULES },
      { role: 'system', content: STYLE_PROMPTS[style] },
      { role: 'user', content },
    ]);

    const text = (res?.content as any)?.toString?.() || String(res?.content || '');
    return text.trim();
  } catch (err) {
    console.error('Narrator LLM error:', err instanceof Error ? err.message : String(err));
    return narrateFallback(playerText, world, patches, stateSummary);
  }
}

export function narrateFallback(playerText: string, world: SimpleWorld, patches: Patch[], stateSummary: any): string {
  const loc = world.locations[world.player.location];
  const desc = loc?.description || '';
  const hasChange = patches?.length > 0;

  if (/look|survey|glance|observe/i.test(playerText)) {
    return `You steady your breath and take it in: ${desc}`;
  }

  if (hasChange) {
    const note = (patches[patches.length - 1] as any)?.note;
    return (note ? `${note} ` : '') + `${desc}`.trim();
  }

  return `Nothing obvious shifts, yet the moment stretches with quiet potential. ${desc}`.trim();
}

// Keep backward compatibility
export function narrateSimple(playerText: string, world: SimpleWorld, patches: Patch[], stateSummary: any): string {
  return narrateFallback(playerText, world, patches, stateSummary);
}

// Special prompt for initial world-building narration - always cinematic style
const INITIAL_NARRATION_PROMPT = 
  'You are beginning a story. This is the opening of a novel—write it like the opening paragraph of a novel. Introduce the player to the broader world as well as their surroundings using the info you are given. Use cinematic style: clear, visual, grounded in concrete sensory details. Set the scene.';

export interface GenerateInitialNarrationParams {
  apiKey?: string;
  world: SimpleWorld;
  style?: NarratorStyle;
}

/**
 * Generates an initial world-building paragraph when the CLI starts.
 * This establishes the scene and atmosphere before the player's first action.
 */
export async function generateInitialNarration(params: GenerateInitialNarrationParams): Promise<string> {
  const { apiKey, world } = params; // style parameter ignored - always cinematic for initial narration

  if (!apiKey) {
    // Fallback: use location description as opening
    const loc = world.locations[world.player.location];
    const desc = loc?.description || 'You find yourself in an unfamiliar place.';
    return desc;
  }

  const telemetry = buildTurnTelemetry(world);
  const pkg = projectPKGFromGraph(world);

  const llm = new ChatOpenAI({
    apiKey,
    model: NARRATOR_MODEL,
    temperature: STYLE_TEMPS['cinematic'], // Always use cinematic temperature for initial narration
    timeout: 30000, // 30 second timeout to prevent hanging
    maxRetries: 0, // Don't retry on failure
    ...(NARRATOR_MODEL_KWARGS ? { modelKwargs: NARRATOR_MODEL_KWARGS } : {}),
  });

  // Build context using telemetry
  const telemetryContext = [
    `Location: ${telemetry.location.name}`,
    `Description: ${telemetry.location.description}`,
    `Position: (${telemetry.player.position.x.toFixed(1)}, ${telemetry.player.position.y.toFixed(1)}${telemetry.player.position.z !== undefined ? `, ${telemetry.player.position.z.toFixed(1)}` : ''})`,
    telemetry.location.items.length > 0 ? `Visible items: ${telemetry.location.items.map((i) => i.name).join(', ')}` : null,
    telemetry.nearbyLocations.length > 0 ? `Nearby: ${telemetry.nearbyLocations.map((l) => `${l.name} (${l.bearing}, ~${Math.round(l.distance)}m)`).join(', ')}` : null,
    telemetry.systems?.time ? `Time: ${telemetry.systems.time.timeOfDay}, hour ${telemetry.systems.time.currentHour}` : null,
    telemetry.systems?.tide ? `Tide: ${telemetry.systems.tide.phase}${telemetry.systems.tide.blocked.length > 0 ? ` (blocked: ${telemetry.systems.tide.blocked.join(', ')})` : ''}` : null,
  ].filter(Boolean).join('\n');

  // Derive scene affordances
  const affordances = deriveAffordances(telemetry, pkg);
  const sceneContext = affordances.length
    ? `Scene context (typed):\n${JSON.stringify(affordances)}`
    : null;

  const content = [
    'This is the opening scene. The player is arriving or the scene is beginning.',
    `Telemetry:\n${telemetryContext}`,
    sceneContext,
    pkg ? `Player Knowledge: ${JSON.stringify(pkg)}` : null,
    `Recent events:\n${telemetry.ledgerTail.map((s) => `- ${s}`).join('\n')}`,
  ]
    .filter((line) => line !== null)
    .join('\n\n');

  try {
    const res = await llm.invoke([
      { role: 'system', content: NARRATOR_TRUTH_RULES },
      { role: 'system', content: INITIAL_NARRATION_PROMPT }, // Always cinematic for initial narration
      { role: 'user', content },
    ]);

    const text = (res?.content as any)?.toString?.() || String(res?.content || '');
    return text.trim();
  } catch (err) {
    console.error('Initial narration LLM error:', err instanceof Error ? err.message : String(err));
    // Fallback to location description
    const loc = world.locations[world.player.location];
    return loc?.description || 'You find yourself in an unfamiliar place.';
  }
}
