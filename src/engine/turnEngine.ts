import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonlSessionStore } from './session/jsonlStore';
import type { SessionStore, TurnRecord, TurnTrace } from './session/types';
import type { PendingPrompt, WorldState } from '../sim/state';
import type { WorldEvent } from '../sim/events';
import { checkInvariants } from '../sim/invariants';
import { validateEvent } from '../sim/validate';
import { applyEvents } from '../sim/reducer';
import { buildObservation } from '../sim/views/observe';
import { buildTelemetry } from '../sim/views/telemetry';
import { computeTurnDiff } from '../sim/views/diff';
import { deriveTide } from '../sim/systems/tide';
import { estimateTravel, LONG_TRAVEL_MINUTES } from '../sim/systems/travel';
import { distance } from '../sim/utils';
import { OpenAIClient } from '../agents/llm/openaiClient';
import type { LLMClient } from '../agents/llm/types';
import { runGMAgent, type GMFinishTurnInput } from '../agents/gm/gmAgent';
import { runNpcAgent, type NpcAgentOutput } from '../agents/npc/npcAgent';
import { narrateOpening, narrateTurn, type NarratorStyle } from '../agents/narrator/narratorAgent';
import { createIsleOfMarrowWorldVNext } from '../worlds/isle-of-marrow.vnext';
import {
  InvariantViolationError,
  PlayerNotFoundError,
  SessionNotFoundError,
  InputValidationError,
} from './errors';

export interface TurnEngineConfig {
  store?: SessionStore;
  llm?: LLMClient;
  worldFactory?: (worldId?: string) => WorldState;
}

export interface InitResult {
  sessionId: string;
  created: boolean;
  telemetry: ReturnType<typeof buildTelemetry>;
  opening: string;
}

export interface RunTurnInput {
  sessionId: string;
  playerId: string;
  playerText: string;
  apiKey?: string;
  narratorStyle?: NarratorStyle;
  debug?: { includeTrace?: boolean; metaMode?: boolean };
  stream?: { onNarrationDelta?: (delta: string) => void };
}

export interface RunTurnOutput {
  sessionId: string;
  turn: number;
  acceptedEvents: WorldEvent[];
  rejectedEvents: Array<{ event: WorldEvent; reason: string }>;
  telemetry: ReturnType<typeof buildTelemetry>;
  narration: string;
  trace?: TurnTrace;
}

export class TurnEngine {
  private store: SessionStore;
  private llm: LLMClient;
  private worldFactory: (worldId?: string) => WorldState;

  constructor(config: TurnEngineConfig = {}) {
    this.store = config.store || new JsonlSessionStore(path.resolve(process.cwd(), 'data/sessions'));
    this.llm = config.llm || new OpenAIClient();
    this.worldFactory = config.worldFactory || (() => createIsleOfMarrowWorldVNext());
  }

  async initSession(params: { sessionId?: string; apiKey?: string; stream?: { onOpeningDelta?: (delta: string) => void } }): Promise<InitResult> {
    const { sessionId, apiKey, stream } = params;
    const ensured = await this.store.ensureSession(sessionId, this.worldFactory);
    assertNoInvariantIssues(ensured.state, 'Session initialized with invalid world state');
    const telemetry = buildTelemetry(ensured.state, 'player-1');
    const opening = await narrateOpening({ apiKey, telemetry, llm: this.llm, onOpeningDelta: stream?.onOpeningDelta });
    return { sessionId: ensured.sessionId, created: ensured.created, telemetry, opening };
  }

  async getTelemetry(sessionId: string, playerId: string) {
    const state = await this.store.loadSession(sessionId);
    if (!state) throw new SessionNotFoundError(sessionId);
    if (!state.actors[playerId]) throw new PlayerNotFoundError(playerId);
    return buildTelemetry(state, playerId);
  }

  async runTurn(input: RunTurnInput): Promise<RunTurnOutput> {
    const { sessionId, playerId, playerText, apiKey, narratorStyle, debug, stream } = input;
    if (!playerText?.trim()) throw new InputValidationError('playerText is required');

    const state = await this.store.loadSession(sessionId);
    if (!state) throw new SessionNotFoundError(sessionId);
    if (!state.actors[playerId]) throw new PlayerNotFoundError(playerId);
    assertNoInvariantIssues(state, 'Session world state is invalid before turn execution');
    const turnHistory = await this.store.loadTurnLog(sessionId);

    let draft = deepClone(state);
    const nextTurn = draft.meta.turn + 1;
    const acceptedEvents: WorldEvent[] = [];
    const rejectedEvents: Array<{ event: WorldEvent; reason: string }> = [];
    const npcOutputs: NpcAgentOutput[] = [];
    const trace: TurnTrace | undefined = debug?.includeTrace ? { toolCalls: [], llmCalls: [] } : undefined;
    let gmSummary: string | null = null;
    draft.meta.turn = nextTurn;

    const applyProposedEvents = (events: WorldEvent[]) => {
      const batch = Array.isArray(events) ? events : [];
      if (!batch.length) {
        return { ok: true, accepted: acceptedEvents.length, rejected: rejectedEvents.length };
      }

      const stagedAccepted: WorldEvent[] = [];
      let stagedState = deepClone(draft);

      for (const event of batch) {
        const validation = validateEvent(stagedState, event);
        if (!validation.ok) {
          rejectedEvents.push({ event, reason: validation.reason || 'invalid' });
          continue;
        }

        const stamped = stampEvent(event, nextTurn);
        stagedAccepted.push(stamped);
        stagedState = applyEvents(stagedState, [stamped]);
        if (
          stamped.type === 'TravelToLocation' &&
          typeof stamped.confirmId === 'string' &&
          stagedState.meta.pendingPrompt?.id === stamped.confirmId
        ) {
          delete stagedState.meta.pendingPrompt;
        }
      }

      if (!stagedAccepted.length) {
        return { ok: true, accepted: acceptedEvents.length, rejected: rejectedEvents.length };
      }

      const issues = checkInvariants(stagedState);
      if (issues.length) {
        for (const event of stagedAccepted) {
          rejectedEvents.push({ event, reason: `invariant_violation:${issues[0].message}` });
        }
        return { ok: false, accepted: acceptedEvents.length, rejected: rejectedEvents.length };
      }

      acceptedEvents.push(...stagedAccepted);
      draft = stagedState;
      return { ok: true, accepted: acceptedEvents.length, rejected: rejectedEvents.length };
    };

    const runtime = {
      observe_world: async (input: { perspective: 'gm' | 'player' }) => {
        return input.perspective === 'player'
          ? buildTelemetry(draft, playerId)
          : buildObservation(draft, playerId);
      },
      consult_npc: async (input: { npcId: string; topic?: string }) => {
        const npc = draft.actors[input.npcId];
        if (!npc || npc.kind !== 'npc' || !npc.persona) {
          return { error: 'npc_not_found' };
        }
        const observation = buildObservation(draft, playerId);
        const output = await runNpcAgent({
          apiKey,
          npcId: npc.id,
          persona: { name: npc.name, tagline: npc.persona.tagline, background: npc.persona.background, voice: npc.persona.voice, goals: npc.persona.goals },
          observation,
          playerText,
          llm: this.llm,
          trace,
        });
        npcOutputs.push(output);
        return output;
      },
      propose_events: async (input: { events: WorldEvent[] }) => {
        const result = applyProposedEvents(input.events || []);
        return { ok: true, ...result };
      },
      finish_turn: async (input: GMFinishTurnInput) => {
        const clear = input.playerPrompt?.clear === true;
        if (clear) {
          delete draft.meta.pendingPrompt;
        }
        const summaryText = input.summary?.trim();
        if (summaryText) {
          gmSummary = summaryText;
        }
        const pending = normalizePendingPrompt(input.playerPrompt?.pending);
        if (pending) {
          draft.meta.pendingPrompt = pending;
        }
        return { ok: true };
      },
    };

    try {
      const gmWorldContext = buildGMWorldContext({
        state: draft,
        playerId,
        playerText,
        nextTurn,
        turnHistory,
      });
      await runGMAgent({
        apiKey,
        playerText,
        worldContext: gmWorldContext,
        runtime,
        llm: this.llm,
        trace,
        debugMetaMode: debug?.metaMode === true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      trace?.toolCalls.push({
        tool: 'gm_agent_error',
        input: { playerText },
        output: { error: 'gm_agent_failed', message },
      });

      const rolledBackAccepted = acceptedEvents.splice(0, acceptedEvents.length);
      for (const event of rolledBackAccepted) {
        rejectedEvents.push({ event, reason: 'agent_failure_rollback' });
      }

      draft = deepClone(state);
      draft.meta.turn = nextTurn;
    }

    assertNoInvariantIssues(draft, 'Session world state failed post-turn invariant checks');

    const beforeTelemetry = buildTelemetry(state, playerId);
    const afterTelemetry = buildTelemetry(draft, playerId);
    const diff = computeTurnDiff(beforeTelemetry, afterTelemetry, acceptedEvents);
    const gmSummaryText = gmSummary?.trim();
    const narration = debug?.metaMode && gmSummaryText
      ? gmSummaryText
      : await narrateTurn({
          apiKey,
          style: narratorStyle,
          playerText,
          telemetry: afterTelemetry,
          diff,
          pendingPrompt: draft.meta.pendingPrompt || null,
          rejectedEvents,
          llm: this.llm,
          onNarrationDelta: stream?.onNarrationDelta,
          trace,
        });
    if (debug?.metaMode && gmSummaryText) {
      stream?.onNarrationDelta?.(gmSummaryText);
    }

    const record: TurnRecord = {
      sessionId,
      turn: nextTurn,
      atIso: new Date().toISOString(),
      playerId,
      playerText,
      acceptedEvents,
      rejectedEvents,
      npcOutputs,
      narration,
      telemetry: afterTelemetry,
      trace,
    };

    await this.store.appendTurn(sessionId, record);
    await this.store.saveSnapshot(sessionId, draft);

    return {
      sessionId,
      turn: nextTurn,
      acceptedEvents,
      rejectedEvents,
      telemetry: afterTelemetry,
      narration,
      trace,
    };
  }
}

function stampEvent(event: WorldEvent, turn: number): WorldEvent {
  return {
    ...event,
    meta: {
      id: randomUUID(),
      turn,
      by: 'gm',
      actorId: event.type === 'AdvanceTime' ? undefined : 'actorId' in event ? event.actorId : undefined,
    },
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertNoInvariantIssues(state: WorldState, message: string) {
  const issues = checkInvariants(state);
  if (issues.length) {
    throw new InvariantViolationError(message, issues);
  }
}

function normalizePendingPrompt(value: unknown): PendingPrompt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  const kind = record.kind;
  const question = typeof record.question === 'string' ? record.question : '';
  const createdTurn = typeof record.createdTurn === 'number' ? record.createdTurn : NaN;
  if (!id || !question || Number.isNaN(createdTurn)) return null;
  if (kind !== 'confirm_travel' && kind !== 'clarify_target' && kind !== 'clarify_explore') return null;
  const options = Array.isArray(record.options)
    ? record.options
        .filter(option => option && typeof option === 'object')
        .map(option => {
          const entry = option as Record<string, unknown>;
          return {
            key: typeof entry.key === 'string' ? entry.key : '',
            label: typeof entry.label === 'string' ? entry.label : '',
          };
        })
        .filter(option => option.key && option.label)
    : undefined;
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : undefined;
  return { id, kind, question, options, data, createdTurn };
}

function buildGMWorldContext(params: {
  state: WorldState;
  playerId: string;
  playerText: string;
  nextTurn: number;
  turnHistory: TurnRecord[];
}) {
  const { state, playerId, playerText, nextTurn, turnHistory } = params;
  const player = state.actors[playerId];
  const observation = buildObservation(state, playerId);
  const telemetry = buildTelemetry(state, playerId);
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
      if (item.location.kind !== 'ground') return [];
      return [{
        id: item.id,
        name: item.name,
        pos: item.location.pos,
        distanceMeters: Math.round(distance(player.pos, item.location.pos) * state.map.cellSizeMeters),
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
    pendingPrompt: state.meta.pendingPrompt || null,
    landmarks,
    nearby: {
      actors: nearbyActors,
      itemsOnGround: nearbyItemsOnGround,
    },
    map: state.map,
    playerTranscript: [
      ...turnHistory.map(turn => ({
        turn: turn.turn,
        playerId: turn.playerId,
        playerText: turn.playerText,
      })),
      { turn: nextTurn, playerId, playerText },
    ],
  };
}
