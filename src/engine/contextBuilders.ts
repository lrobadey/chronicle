import type { PendingPrompt, WorldState } from '../sim/state';
import type { WorldEvent } from '../sim/events';
import type {
  RecentTurnDigest,
  RejectedEventRecord,
  TurnSpeechRecord,
  TurnRecord,
  WebHistorySummary,
  WebTranscriptHistory,
  WebTurnCard,
  WebTurnSummary,
} from './session/types';
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

export interface ConversationTranscriptEntry {
  turn: number;
  role: 'opening' | 'player' | 'npc' | 'narrator';
  speakerId?: string;
  speakerName?: string;
  text: string;
  source: 'openingNarration' | 'playerText' | 'npcPublicUtterance' | 'turnNarration' | 'turnSpeech';
}

export interface NPCConversationContext {
  conversationHistory: ConversationTranscriptEntry[];
  olderTurnsSummary?: string;
}

export interface RecentSpeechDigest {
  turn: number;
  speakerActorId: string;
  speakerName: string;
  text: string;
  recipientActorIds: string[];
  recipientNames: string[];
}

export interface GMWorldContext {
  observation: ReturnType<typeof buildObservation>;
  telemetry: ReturnType<typeof buildTelemetry>;
  opening: OpeningRecap | null;
  agendas: WorldState['directorState'];
  pendingPrompt: PendingPrompt | null;
  travelCandidates: Array<{
    id: string;
    name: string;
    aliases?: string[];
    distanceMeters: number;
    estimatedWalkMinutes: number;
    blockedNow: boolean;
    requiresConfirm: boolean;
  }>;
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

export interface OpeningRecap {
  narration: string;
  focalActorId?: string;
  focusLocationId?: string;
  playerQuestion?: string;
}

const RECENT_TURN_LIMIT = 10;
const RECENT_PLAYER_TEXT_MAX_CHARS = 240;
const RECENT_NARRATION_MAX_CHARS = 240;
const RECENT_REASON_MAX_CHARS = 80;
const RECENT_SPEECH_TURN_LIMIT = 6;
const RECENT_SPEECH_ENTRY_LIMIT = 16;
const RECENT_SPEECH_TEXT_MAX_CHARS = 240;

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
        description: location.description,
        tags: location.tags,
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
  const travelCandidates = landmarks
    .map(location => ({
      id: location.id,
      name: location.name,
      aliases: deriveLocationAliases(location.name, location.description, location.tags),
      distanceMeters: location.distanceMeters,
      estimatedWalkMinutes: location.estimatedWalkMinutes,
      blockedNow: location.blockedNow,
      requiresConfirm: location.requiresConfirm,
    }))
    .slice(0, 12);
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
    opening: buildOpeningRecap(state),
    agendas: state.directorState,
    pendingPrompt: params.pendingPrompt,
    travelCandidates,
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

function deriveLocationAliases(name: string, description: string, tags?: string[]): string[] | undefined {
  const aliases = new Set<string>();
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  aliases.add(trimmed);
  const withoutArticle = trimmed.replace(/^(the|a|an)\s+/i, '').trim();
  if (withoutArticle && withoutArticle.toLowerCase() !== trimmed.toLowerCase()) {
    aliases.add(withoutArticle);
  }
  const haystack = `${trimmed} ${description} ${(tags || []).join(' ')}`.toLowerCase();
  if (/\btavern\b/.test(haystack)) aliases.add('tavern');
  if (/\bmarket(?:place)?\b/.test(haystack)) {
    aliases.add('market');
    aliases.add('marketplace');
  }
  if (/\bdocks?\b|\bpiers?\b/.test(haystack)) {
    aliases.add('dock');
    aliases.add('docks');
    aliases.add('pier');
    aliases.add('piers');
  }
  if (/\blanding\b/.test(haystack)) aliases.add('landing');
  return aliases.size > 1 ? [...aliases] : undefined;
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

export function buildOpeningRecap(state: WorldState): OpeningRecap | null {
  const narration = state.meta.openingNarration?.trim();
  if (!narration) return null;
  return {
    narration,
    focalActorId: state.meta.openingSpec?.focalActorId,
    focusLocationId: state.meta.openingSpec?.focusLocationId,
    playerQuestion: state.meta.openingSpec?.playerQuestion,
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
      agendas: state.directorState.scene,
      pendingPrompt: params.pendingPrompt,
      telemetry,
      observation,
      playerText,
      recentTurns,
    };
  }

  return {
    agendas: state.directorState.world,
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

export function buildRecentSpeechDigests(turnHistory: TurnRecord[]): RecentSpeechDigest[] {
  const recentTurns = turnHistory.slice(-RECENT_SPEECH_TURN_LIMIT);
  const digests = recentTurns.flatMap(turn =>
    (turn.turnSpeech || [])
      .map(speech => summarizeSpeechRecord(turn.turn, speech))
      .filter((speech): speech is RecentSpeechDigest => Boolean(speech)),
  );
  return digests.slice(-RECENT_SPEECH_ENTRY_LIMIT);
}

export function buildWebTurnSummary(
  state: WorldState,
  params: {
    acceptedEvents: WorldEvent[];
    rejectedEvents: RejectedEventRecord[];
    diffSummary?: string;
  },
): WebTurnSummary {
  const accepted = params.acceptedEvents.map(event => summarizeAcceptedEvent(state, event));
  const rejected = params.rejectedEvents.map(rejection => summarizeRejectedReason(rejection.reason));
  const diffSummary = params.diffSummary?.trim();
  const headline = diffSummary && diffSummary !== 'No major changes'
    ? diffSummary
    : accepted.length
      ? accepted.slice(0, 2).join(' · ')
      : rejected.length
        ? 'No material change'
        : 'No major changes';
  const outcome: WebTurnSummary['outcome'] = accepted.length
    ? 'progress'
    : rejected.length
      ? 'blocked'
      : 'quiet';

  return {
    headline,
    accepted,
    rejected,
    outcome,
  };
}

export function buildWebTurnCard(state: WorldState, turn: TurnRecord): WebTurnCard {
  return {
    turn: turn.turn,
    atIso: turn.atIso,
    playerText: turn.playerText.trim(),
    narration: turn.narration?.trim() || '',
    summary: buildWebTurnSummary(state, {
      acceptedEvents: turn.acceptedEvents,
      rejectedEvents: turn.rejectedEvents,
    }),
    telemetry: turn.telemetry,
    trace: turn.trace,
  };
}

export function buildWebTranscriptHistory(state: WorldState, turnHistory: TurnRecord[]): WebTranscriptHistory {
  const recentTurns = turnHistory.slice(-RECENT_TURN_LIMIT).map(turn => buildWebTurnCard(state, turn));
  const olderTurns = turnHistory.slice(0, -RECENT_TURN_LIMIT);
  const olderSummary = buildOlderHistorySummary(state, olderTurns);

  return {
    totalTurns: turnHistory.length,
    recentTurns,
    olderSummary,
  };
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

export function buildNPCConversationContext(params: {
  state: WorldState;
  turnHistory: TurnRecord[];
  playerId: string;
  playerText: string;
  nextTurn: number;
}): NPCConversationContext {
  const { state, turnHistory, playerId, playerText, nextTurn } = params;
  const conversationHistory: ConversationTranscriptEntry[] = [];
  const openingNarration = state.meta.openingNarration?.trim();

  if (openingNarration) {
    conversationHistory.push({
      turn: 0,
      role: 'opening',
      speakerName: 'Narrator',
      text: openingNarration,
      source: 'openingNarration',
    });
  }

  for (const turn of turnHistory) {
    pushTranscriptEntry(conversationHistory, {
      turn: turn.turn,
      role: 'player',
      speakerId: turn.playerId,
      speakerName: state.actors[turn.playerId]?.name,
      text: turn.playerText,
      source: 'playerText',
    });

    const speechRecords = (turn.turnSpeech && turn.turnSpeech.length)
      ? turn.turnSpeech
      : (turn.npcOutputs || []).map<TurnSpeechRecord | null>(npcOutput => {
          const text = npcOutput.publicUtterance.trim();
          if (!text) return null;
          const speakerName = state.actors[npcOutput.npcId]?.name || npcOutput.npcId;
          return {
            speakerActorId: npcOutput.npcId,
            speakerName,
            text,
            recipientActorIds: [],
            recipientNames: [],
            source: 'npc_consult',
          };
        }).filter((record): record is TurnSpeechRecord => Boolean(record));

    for (const speech of speechRecords) {
      pushTranscriptEntry(conversationHistory, {
        turn: turn.turn,
        role: speech.speakerActorId === turn.playerId ? 'player' : 'npc',
        speakerId: speech.speakerActorId,
        speakerName: speech.speakerName,
        text: speech.text,
        source: speech.source === 'npc_consult' ? 'npcPublicUtterance' : 'turnSpeech',
      });
    }

    pushTranscriptEntry(conversationHistory, {
      turn: turn.turn,
      role: 'narrator',
      speakerName: 'Narrator',
      text: turn.narration,
      source: 'turnNarration',
    });
  }

  pushTranscriptEntry(conversationHistory, {
    turn: nextTurn,
    role: 'player',
    speakerId: playerId,
    speakerName: state.actors[playerId]?.name,
    text: playerText,
    source: 'playerText',
  });

  return { conversationHistory };
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
    scenePressureCount: state.directorState.scene.pressures.length + state.directorState.scene.immediateTensions.length,
    worldThreadCount: state.directorState.world.activeThreads.length + state.directorState.world.escalationHooks.length,
  };
}

function buildOlderHistorySummary(state: WorldState, olderTurns: TurnRecord[]): WebHistorySummary | undefined {
  if (!olderTurns.length) return undefined;

  return {
    fromTurn: olderTurns[0]!.turn,
    toTurn: olderTurns[olderTurns.length - 1]!.turn,
    turnCount: olderTurns.length,
    headline: `${olderTurns.length} earlier turn${olderTurns.length === 1 ? '' : 's'} led here`,
    highlights: olderTurns.slice(-3).map(turn => {
      const summary = buildWebTurnSummary(state, {
        acceptedEvents: turn.acceptedEvents,
        rejectedEvents: turn.rejectedEvents,
      });
      const prompt = clipText(turn.playerText.trim(), 64);
      return summary.outcome === 'quiet'
        ? `Turn ${turn.turn}: ${prompt}`
        : `Turn ${turn.turn}: ${prompt} -> ${summary.headline}`;
    }),
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

function summarizeSpeechRecord(turn: number, speech: TurnSpeechRecord): RecentSpeechDigest | null {
  const speakerActorId = speech.speakerActorId?.trim();
  const speakerName = speech.speakerName?.trim();
  const text = speech.text?.trim();
  if (!speakerActorId || !speakerName || !text) return null;
  return {
    turn,
    speakerActorId,
    speakerName,
    text: clipText(text, RECENT_SPEECH_TEXT_MAX_CHARS),
    recipientActorIds: speech.recipientActorIds || [],
    recipientNames: speech.recipientNames || [],
  };
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
    case 'AffectItem': {
      const itemName = state.items[event.itemId]?.name || event.itemId;
      switch (event.effect) {
        case 'pick_up':
          return `Picked up ${itemName}`;
        case 'drop':
          return `Dropped ${itemName}`;
        case 'transfer':
          return event.targetActorId
            ? `Transferred ${itemName} to ${state.actors[event.targetActorId]?.name || event.targetActorId}`
            : `Placed ${itemName} nearby`;
        default:
          return `Affected ${itemName}: ${event.effect.replace('_', ' ')}`;
      }
    }
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

function formatExploreArea(area: string): string {
  switch (area) {
    case 'shoreline':
      return 'the shoreline';
    case 'docks':
      return 'the docks';
    case 'under_ribs':
      return 'under the ribs';
    case 'around_here':
      return 'the area';
    default:
      return area.replace(/_/g, ' ');
  }
}

function clipText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function pushTranscriptEntry(
  history: ConversationTranscriptEntry[],
  entry: Omit<ConversationTranscriptEntry, 'text'> & { text?: string },
) {
  const trimmed = entry.text?.trim();
  if (!trimmed) return;
  history.push({
    ...entry,
    text: trimmed,
  });
}
