import type { PendingPrompt, WorldState } from '../sim/state';
import type { WorldEvent } from '../sim/events';
import type { RecentTurnDigest, TurnRecord } from './session/types';
import { buildObservation } from '../sim/views/observe';
import { buildTelemetry } from '../sim/views/telemetry';
import { deriveTide } from '../sim/systems/tide';
import { estimateTravel, LONG_TRAVEL_MINUTES } from '../sim/systems/travel';
import { getItemPlacement, summarizeItemComponents, type ItemComponentSummary } from '../sim/spine';
import { distance } from '../sim/utils';
import type { SpecialistType } from '../agents/specialists';

export interface PlayerTranscriptEntry {
  turn: number;
  playerId: string;
  playerText: string;
}

export interface GMWorldContext {
  observation: ReturnType<typeof buildObservation>;
  telemetry: ReturnType<typeof buildTelemetry>;
  agendas: WorldState['agendas'];
  pendingPrompt: PendingPrompt | null;
  landmarks: Array<{
    id: string;
    name: string;
    anchor: { x: number; y: number; z?: number };
    terrain: string;
    tideAccess: string;
    radiusCells: number;
    distanceMeters: number;
    shortDescription: string;
    blockedNow: boolean;
    estimatedWalkMinutes: number;
    requiresConfirm: boolean;
  }>;
  nearby: {
    actors: Array<{
      id: string;
      name: string;
      kind: string;
      pos: { x: number; y: number; z?: number };
      distanceMeters: number;
    }>;
    itemsOnGround: Array<{
      id: string;
      name: string;
      pos: { x: number; y: number; z?: number };
      distanceMeters: number;
      components?: ItemComponentSummary;
    }>;
  };
  map: WorldState['map'];
  recentTurns: RecentTurnDigest[];
  playerTranscriptTail: PlayerTranscriptEntry[];
}

export interface OpeningContext {
  isFirstWorldMessage: boolean;
  focusLocation: {
    id: string;
    name: string;
    description: string;
  };
  focalLocal: {
    id: string;
    name: string;
    role: string;
    stance: string;
  } | null;
  openingHook: string;
  playerQuestion: string;
}

const RECENT_TURN_LIMIT = 10;
const RECENT_PLAYER_TEXT_MAX_CHARS = 240;
const RECENT_NARRATION_MAX_CHARS = 240;
const RECENT_REASON_MAX_CHARS = 80;

export interface StaffInterviewHeuristics {
  repeatedClarificationCount: number;
  rejectedEventCount: number;
  noAcceptedTurnCount: number;
  specialistConsultCount: number;
  pendingPromptActive: boolean;
  scenePressureCount: number;
  worldThreadCount: number;
}

export interface StaffInterviewContext extends GMWorldContext {
  sessionId: string;
  playerId: string;
  recentTurnDetails: Array<{
    turn: number;
    playerText: string;
    acceptedEvents: WorldEvent[];
    rejectedEvents: TurnRecord['rejectedEvents'];
    specialistOutputs: NonNullable<TurnRecord['specialistOutputs']>;
  }>;
  heuristics: StaffInterviewHeuristics;
}

export function buildGMWorldContext(params: {
  state: WorldState;
  playerId: string;
  playerText: string;
  nextTurn: number;
  turnHistory: TurnRecord[];
  pendingPrompt: PendingPrompt | null;
}): GMWorldContext {
  const { state, playerId, turnHistory } = params;
  const player = state.actors[playerId];
  const observation = buildObservation(state, playerId);
  const telemetry = buildTelemetry(state, playerId);
  const recentTurns = buildRecentTurnDigests(state, turnHistory);
  const tide = deriveTide(state);
  const landmarks = Object.values(state.locations)
    .map(location => {
      const estimate = estimateTravel(state, player.pos, location.anchor, 'walk');
      return {
        id: location.id,
        name: location.name,
        anchor: location.anchor,
        terrain: location.terrain ?? 'unknown',
        tideAccess: location.tideAccess ?? 'always',
        radiusCells: location.radiusCells ?? 0,
        distanceMeters: Math.round(distance(player.pos, location.anchor) * state.map.cellSizeMeters),
        shortDescription: location.description.slice(0, 180),
        blockedNow: tide.blockedLocationIds.includes(location.id),
        estimatedWalkMinutes: estimate.minutes,
        requiresConfirm: estimate.minutes > LONG_TRAVEL_MINUTES,
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 25);
  const nearbyItemsOnGround = Object.values(state.items)
    .flatMap(item => {
      const placement = getItemPlacement(state.spine, item.id);
      if (!placement || placement.type !== 'located_in') return [];
      return [{
        id: item.id,
        name: item.name,
        pos: placement.anchor,
        distanceMeters: Math.round(distance(player.pos, placement.anchor) * state.map.cellSizeMeters),
        components: summarizeItemComponents(state.spine, item.id),
      }];
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 20);
  const nearbyActors = Object.values(state.actors)
    .filter(actor => actor.id !== playerId)
    .map(actor => ({
      id: actor.id,
      name: actor.name,
      kind: actor.kind,
      pos: actor.pos,
      distanceMeters: Math.round(distance(player.pos, actor.pos) * state.map.cellSizeMeters),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 20);

  return {
    observation,
    telemetry,
    agendas: state.agendas,
    pendingPrompt: params.pendingPrompt,
    landmarks,
    nearby: {
      actors: nearbyActors,
      itemsOnGround: nearbyItemsOnGround,
    },
    map: state.map,
    recentTurns,
    playerTranscriptTail: buildPlayerTranscript(turnHistory).slice(-RECENT_TURN_LIMIT),
  };
}

export function buildStaffInterviewContext(params: {
  sessionId: string;
  state: WorldState;
  playerId: string;
  turnHistory: TurnRecord[];
}): StaffInterviewContext {
  const { sessionId, state, playerId, turnHistory } = params;
  const baseContext = buildGMWorldContext({
    state,
    playerId,
    playerText: '',
    nextTurn: state.meta.turn,
    turnHistory,
    pendingPrompt: turnHistory[turnHistory.length - 1]?.pendingPrompt ?? null,
  });
  const recentTurnDetails = turnHistory.slice(-6).map(turn => ({
    turn: turn.turn,
    playerText: summarizeHistoricalPlayerText(turn.playerText),
    acceptedEvents: turn.acceptedEvents,
    rejectedEvents: turn.rejectedEvents,
    specialistOutputs: turn.specialistOutputs || [],
  }));

  return {
    ...baseContext,
    sessionId,
    playerId,
    recentTurnDetails,
    heuristics: summarizeInterviewHeuristics(state, turnHistory),
  };
}

export function buildOpeningContext(state: WorldState): OpeningContext | null {
  const spec = state.meta.openingSpec;
  if (!spec) return null;
  const focusLocation = state.locations[spec.focusLocationId];
  if (!focusLocation) return null;
  const focalActor = state.actors[spec.focalActorId];

  return {
    isFirstWorldMessage: true,
    focusLocation: {
      id: focusLocation.id,
      name: focusLocation.name,
      description: focusLocation.description,
    },
    focalLocal: focalActor
      ? {
          id: focalActor.id,
          name: focalActor.name,
          role: focalActor.tags?.[0]?.replace(/-/g, ' ') || focalActor.persona?.tagline || focalActor.kind,
          stance: focalActor.persona?.voice || 'watchful',
        }
      : null,
    openingHook: spec.hookText,
    playerQuestion: spec.playerQuestion,
  };
}

export function buildSpecialistContext(params: {
  state: WorldState;
  playerId: string;
  playerText: string;
  nextTurn: number;
  turnHistory: TurnRecord[];
  specialistType: SpecialistType;
  pendingPrompt: PendingPrompt | null;
}) {
  const { state, playerId, playerText, nextTurn, turnHistory, specialistType } = params;
  const telemetry = buildTelemetry(state, playerId);
  const observation = buildObservation(state, playerId);
  const recentTurns = buildRecentTurnDigests(state, turnHistory);

  if (specialistType === 'scene') {
    return {
      agendas: state.agendas.scene,
      pendingPrompt: params.pendingPrompt,
      telemetry,
      observation,
      playerText,
      recentTurns,
    };
  }

  return {
    agendas: state.agendas.world,
    pendingPrompt: params.pendingPrompt,
    telemetry,
    worldSnapshot: buildGMWorldContext({
      state,
      playerId,
      playerText,
      nextTurn,
      turnHistory,
      pendingPrompt: params.pendingPrompt,
    }),
    playerText,
    recentTurns,
  };
}

export function buildRecentTurnDigests(state: WorldState, turnHistory: TurnRecord[]): RecentTurnDigest[] {
  return turnHistory.slice(-RECENT_TURN_LIMIT).map(turn => ({
    turn: turn.turn,
    playerText: summarizeHistoricalPlayerText(turn.playerText),
    narration: summarizeNarration(turn.narration),
    accepted: turn.acceptedEvents.map(event => summarizeAcceptedEvent(state, event)),
    rejected: turn.rejectedEvents.map(rejection => summarizeRejectedReason(rejection.reason)),
  }));
}

export function buildPlayerTranscript(
  turnHistory: TurnRecord[],
  nextTurn?: number,
  playerId?: string,
  playerText?: string,
): PlayerTranscriptEntry[] {
  const transcript = turnHistory.map(turn => ({
    turn: turn.turn,
    playerId: turn.playerId,
    playerText: summarizeHistoricalPlayerText(turn.playerText),
  }));

  if (typeof nextTurn === 'number' && typeof playerId === 'string' && typeof playerText === 'string' && playerText.trim()) {
    transcript.push({ turn: nextTurn, playerId, playerText });
  }

  return transcript;
}

function summarizeInterviewHeuristics(state: WorldState, turnHistory: TurnRecord[]): StaffInterviewHeuristics {
  const repeatedClarificationCount = turnHistory.filter(turn => {
    const kind = getTurnPromptKind(turn);
    return kind === 'clarify_target' || kind === 'clarify_explore';
  }).length;

  return {
    repeatedClarificationCount,
    rejectedEventCount: turnHistory.reduce((sum, turn) => sum + turn.rejectedEvents.length, 0),
    noAcceptedTurnCount: turnHistory.filter(turn => turn.acceptedEvents.length === 0).length,
    specialistConsultCount: turnHistory.reduce((sum, turn) => sum + (turn.specialistOutputs?.length || 0), 0),
    pendingPromptActive: Boolean(turnHistory[turnHistory.length - 1]?.pendingPrompt),
    scenePressureCount: state.agendas.scene.pressures.length + state.agendas.scene.immediateTensions.length,
    worldThreadCount: state.agendas.world.activeThreads.length + state.agendas.world.escalationHooks.length,
  };
}

function getTurnPromptKind(turn: TurnRecord): PendingPrompt['kind'] | null {
  if (turn.pendingPrompt?.kind) {
    return turn.pendingPrompt.kind;
  }

  const pending = turn.trace?.toolCalls.find(call => call.tool === 'finish_turn')?.input;
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) return null;
  const playerPrompt = (pending as Record<string, unknown>).playerPrompt;
  if (!playerPrompt || typeof playerPrompt !== 'object' || Array.isArray(playerPrompt)) return null;
  const nestedPending = (playerPrompt as Record<string, unknown>).pending;
  if (!nestedPending || typeof nestedPending !== 'object' || Array.isArray(nestedPending)) return null;
  const kind = (nestedPending as Record<string, unknown>).kind;
  return kind === 'confirm_travel' || kind === 'clarify_target' || kind === 'clarify_explore' ? kind : null;
}

function summarizeHistoricalPlayerText(playerText: string): string {
  return clipText(playerText.trim(), RECENT_PLAYER_TEXT_MAX_CHARS);
}

function summarizeNarration(narration: string | undefined): string | null {
  if (typeof narration !== 'string') return null;
  const trimmed = narration.trim();
  return trimmed ? clipText(trimmed, RECENT_NARRATION_MAX_CHARS) : null;
}

function summarizeAcceptedEvent(state: WorldState, event: WorldEvent): string {
  switch (event.type) {
    case 'TravelToLocation':
      return `Traveled to ${state.locations[event.locationId]?.name || event.locationId}`;
    case 'MoveActor':
      return event.toLocationId
        ? `Moved to ${state.locations[event.toLocationId]?.name || event.toLocationId}`
        : 'Moved to a new position';
    case 'PickUpItem':
      return `Picked up ${state.items[event.itemId]?.name || event.itemId}`;
    case 'DropItem':
      return `Dropped ${state.items[event.itemId]?.name || event.itemId}`;
    case 'TransferItem': {
      const itemName = event.itemId
        ? state.items[event.itemId]?.name || event.itemId
        : event.item?.name || event.item?.id || 'an item';
      if (event.toActorId) {
        const targetName = state.actors[event.toActorId]?.name || event.toActorId;
        return `Transferred ${itemName} to ${targetName}`;
      }
      return `Placed ${itemName} nearby`;
    }
    case 'Speak': {
      const targetName = event.toActorId ? state.actors[event.toActorId]?.name || event.toActorId : null;
      return targetName ? `Spoke to ${targetName}` : 'Spoke aloud';
    }
    case 'AdvanceTime':
      return `${event.minutes} minutes passed`;
    case 'CreateEntity':
      return `Introduced ${event.entity.data.name}`;
    case 'Explore': {
      const subject = typeof (event as { subject?: unknown }).subject === 'string'
        ? String((event as { subject?: string }).subject).trim()
        : '';
      return `Explored ${subject || formatExploreArea(event.area)}`;
    }
    case 'Inspect':
      return `Inspected ${event.subject}`;
    case 'SetFlag':
      return `Updated ${event.key}`;
    default:
      return 'World event';
  }
}

function summarizeRejectedReason(reason: string): string {
  return clipText(reason.trim() || 'invalid', RECENT_REASON_MAX_CHARS);
}

function formatExploreArea(area: 'shoreline' | 'docks' | 'under_ribs' | 'around_here'): string {
  switch (area) {
    case 'shoreline':
      return 'the shoreline';
    case 'docks':
      return 'the docks';
    case 'under_ribs':
      return 'under the ribs';
    case 'around_here':
      return 'the area';
  }
}

function clipText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1).trimEnd()}…`;
}
