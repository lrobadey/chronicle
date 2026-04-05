import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonlSessionStore } from './session/jsonlStore';
import type { RejectedEventRecord, SessionStore, TurnRecord, TurnTrace } from './session/types';
import type {
  PendingPrompt,
  PendingPromptData,
  SceneAgenda,
  WorldAgenda,
  WorldState,
} from '../sim/state';
import { normalizeWorldEvent, type WorldEvent } from '../sim/events';
import { checkInvariants } from '../sim/invariants';
import { validateEvent } from '../sim/validate';
import { applyEvents } from '../sim/reducer';
import { buildObservation } from '../sim/views/observe';
import { buildTelemetry } from '../sim/views/telemetry';
import { computeTurnDiff } from '../sim/views/diff';
import { deriveTide } from '../sim/systems/tide';
import { estimateTravel, LONG_TRAVEL_MINUTES } from '../sim/systems/travel';
import { getItemPlacement } from '../sim/spine';
import { distance } from '../sim/utils';
import { OpenAIClient } from '../agents/llm/openaiClient';
import type { LLMClient } from '../agents/llm/types';
import { runGMAgent, type GMFinishTurnInput } from '../agents/gm/gmAgent';
import { runNpcAgent, type NpcAgentOutput } from '../agents/npc/npcAgent';
import { narrateOpening, narrateTurn, type NarratorStyle } from '../agents/narrator/narratorAgent';
import {
  runStaffInterview as runStaffInterviewAgent,
  type StaffInterviewMessage,
  type StaffInterviewResult,
} from '../agents/staffInterview';
import {
  finalizeSpecialistConsultations,
  runSpecialistAgent,
  type SpecialistConsultation,
  type SpecialistType,
} from '../agents/specialists';
import { createIsleOfMarrowWorldVNext } from '../worlds/isle-of-marrow.vnext';
import type { DebugSink } from './debug';
import { emitDebugEvent } from './debug';
import {
  buildGMWorldContext,
  buildRecentTurnDigests,
  buildSpecialistContext,
  buildStaffInterviewContext,
  type StaffInterviewContext,
} from './contextBuilders';
import {
  InvariantViolationError,
  PlayerNotFoundError,
  SessionNotFoundError,
  InputValidationError,
  SpineIntegrityError,
} from './errors';

export interface TurnEngineConfig {
  store?: SessionStore;
  llm?: LLMClient;
  clock?: () => Date;
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
  debug?: { includeTrace?: boolean; onEvent?: DebugSink };
  stream?: {
    onNarrationStart?: (telemetry: ReturnType<typeof buildTelemetry>) => void;
    onNarrationDelta?: (delta: string) => void;
  };
}

export interface RunTurnOutput {
  sessionId: string;
  turn: number;
  acceptedEvents: WorldEvent[];
  rejectedEvents: RejectedEventRecord[];
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
    const clock = config.clock || (() => new Date());
    this.worldFactory = config.worldFactory || (() => createIsleOfMarrowWorldVNext({ anchorIso: clock().toISOString() }));
  }

  async initSession(params: {
    sessionId?: string;
    apiKey?: string;
    debug?: { onEvent?: DebugSink };
    stream?: {
      onOpeningStart?: (telemetry: ReturnType<typeof buildTelemetry>) => void;
      onOpeningDelta?: (delta: string) => void;
    };
  }): Promise<InitResult> {
    const { sessionId, apiKey, debug, stream } = params;
    const emit = debug?.onEvent;
    emitDebugEvent(emit, { type: 'init.started', sessionId });
    try {
      const ensured = await this.store.ensureSession(sessionId, this.worldFactory);
      emitDebugEvent(emit, { type: 'init.session_ready', sessionId: ensured.sessionId, created: ensured.created });
      assertNoInvariantIssues(ensured.state, 'Session initialized with invalid world state');
      const telemetry = buildTelemetry(ensured.state, 'player-1');
      stream?.onOpeningStart?.(telemetry);
      const opening = await narrateOpening({
        apiKey,
        telemetry,
        llm: this.llm,
        debug: emit,
        onOpeningDelta: stream?.onOpeningDelta,
      });
      return { sessionId: ensured.sessionId, created: ensured.created, telemetry, opening };
    } catch (error) {
      emitDebugEvent(emit, { type: 'error', stage: 'init', message: error instanceof Error ? error.message : 'unknown' });
      throw error;
    }
  }

  async getTelemetry(sessionId: string, playerId: string) {
    const state = await this.store.loadSession(sessionId);
    if (!state) throw new SessionNotFoundError(sessionId);
    if (!state.actors[playerId]) throw new PlayerNotFoundError(playerId);
    return buildTelemetry(state, playerId);
  }

  async ensureStaffSession(params: { sessionId?: string; playerId: string }) {
    const ensured = await this.store.ensureSession(params.sessionId, this.worldFactory);
    if (!ensured.state.actors[params.playerId]) throw new PlayerNotFoundError(params.playerId);
    assertNoInvariantIssues(ensured.state, 'Session initialized with invalid world state');
    return {
      sessionId: ensured.sessionId,
      created: ensured.created,
      telemetry: buildTelemetry(ensured.state, params.playerId),
    };
  }

  async getStaffInterviewContext(sessionId: string, playerId: string): Promise<StaffInterviewContext> {
    const state = await this.store.loadSession(sessionId);
    if (!state) throw new SessionNotFoundError(sessionId);
    if (!state.actors[playerId]) throw new PlayerNotFoundError(playerId);
    assertNoInvariantIssues(state, 'Session world state is invalid before staff interview');
    const turnHistory = await this.store.loadTurnLog(sessionId);
    return buildStaffInterviewContext({
      sessionId,
      state,
      playerId,
      turnHistory,
    });
  }

  async runStaffInterview(input: {
    sessionId: string;
    playerId: string;
    question: string;
    apiKey?: string;
    conversation?: StaffInterviewMessage[];
  }): Promise<StaffInterviewResult> {
    const context = await this.getStaffInterviewContext(input.sessionId, input.playerId);
    return runStaffInterviewAgent({
      apiKey: input.apiKey,
      question: input.question,
      context,
      conversation: input.conversation,
      llm: this.llm,
    });
  }

  async runTurn(input: RunTurnInput): Promise<RunTurnOutput> {
    const { sessionId, playerId, playerText, apiKey, narratorStyle, debug, stream } = input;
    const emit = debug?.onEvent;
    if (!playerText?.trim()) throw new InputValidationError('playerText is required');

    const state = await this.store.loadSession(sessionId);
    if (!state) throw new SessionNotFoundError(sessionId);
    if (!state.actors[playerId]) throw new PlayerNotFoundError(playerId);
    assertNoInvariantIssues(state, 'Session world state is invalid before turn execution');
    const turnHistory = await this.store.loadTurnLog(sessionId);

    let draft = deepClone(state);
    const nextTurn = draft.meta.turn + 1;
    const acceptedEvents: WorldEvent[] = [];
    const rejectedEvents: RejectedEventRecord[] = [];
    const npcOutputs: NpcAgentOutput[] = [];
    const specialistOutputs: Array<Omit<SpecialistConsultation, 'usedSuggestion' | 'usedCandidateEvents'>> = [];
    const trace: TurnTrace | undefined = debug?.includeTrace ? { toolCalls: [], llmCalls: [] } : undefined;
    draft.meta.turn = nextTurn;
    emitDebugEvent(emit, { type: 'turn.started', sessionId, turn: nextTurn, playerText });

    const applyProposedEvents = (events: WorldEvent[]) => {
      const batch = Array.isArray(events) ? events.map(event => normalizeWorldEvent(event)) : [];
      if (!batch.length) {
        return { ok: true, accepted: acceptedEvents.length, rejected: rejectedEvents.length };
      }

      const stagedAccepted: WorldEvent[] = [];
      let stagedState = deepClone(draft);

      for (const event of batch) {
        const validation = validateEvent(stagedState, event);
        if (!validation.ok) {
          const reason = validation.reason || 'invalid';
          rejectedEvents.push({ event, reason });
          emitDebugEvent(emit, { type: 'event.rejected', event, reason });
          continue;
        }

        const stamped = stampEvent(event, nextTurn);
        try {
          stagedState = applyEvents(stagedState, [stamped]);
        } catch (error) {
          const rejected = toRejectedEvent(stamped, error);
          rejectedEvents.push(rejected);
          emitDebugEvent(emit, { type: 'event.rejected', ...rejected });
          continue;
        }

        stagedAccepted.push(stamped);
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
        const error = new InvariantViolationError(issues[0]?.message || 'Invariant violation', issues);
        for (const event of stagedAccepted) {
          const rejected = toRejectedEvent(event, error);
          rejectedEvents.push(rejected);
          emitDebugEvent(emit, { type: 'event.rejected', ...rejected });
        }
        return { ok: false, accepted: acceptedEvents.length, rejected: rejectedEvents.length };
      }

      acceptedEvents.push(...stagedAccepted);
      for (const event of stagedAccepted) {
        emitDebugEvent(emit, { type: 'event.accepted', event });
      }
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
          debug: emit,
          trace,
        });
        npcOutputs.push(output);
        return output;
      },
      consult_specialist: async (input: { specialistType: SpecialistType; question: string; focus?: string | null }) => {
        const context = buildSpecialistContext({
          state: draft,
          playerId,
          playerText,
          nextTurn,
          turnHistory,
          specialistType: input.specialistType,
        });
        const output = await runSpecialistAgent({
          apiKey,
          specialistType: input.specialistType,
          question: input.question,
          focus: input.focus || undefined,
          context,
          llm: this.llm,
          debug: emit,
          trace,
        });
        specialistOutputs.push({
          specialistType: input.specialistType,
          question: input.question,
          focus: input.focus || undefined,
          output,
        });
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
        const pending = normalizePendingPrompt(input.playerPrompt?.pending);
        if (pending) {
          draft.meta.pendingPrompt = pending;
        }
        applyAgendaUpdates(draft, input.agendaUpdates);
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
        debug: emit,
        llm: this.llm,
        trace,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      emitDebugEvent(emit, { type: 'error', stage: 'gm', message });
      trace?.toolCalls.push({
        tool: 'gm_agent_error',
        input: { playerText },
        output: { error: 'gm_agent_failed', message },
      });

      const rolledBackAccepted = acceptedEvents.splice(0, acceptedEvents.length);
      if (rolledBackAccepted.length) {
        emitDebugEvent(emit, { type: 'event.rollback', events: rolledBackAccepted, reason: 'agent_failure_rollback' });
      }
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
    const recentTurns = buildRecentTurnDigests(draft, turnHistory);
    stream?.onNarrationStart?.(afterTelemetry);
    const narration = await narrateTurn({
      apiKey,
      style: narratorStyle,
      playerText,
      telemetry: afterTelemetry,
      diff,
      recentTurns,
      pendingPrompt: draft.meta.pendingPrompt || null,
      rejectedEvents,
      llm: this.llm,
      debug: emit,
      onNarrationDelta: stream?.onNarrationDelta,
      trace,
    });

    const finalizedSpecialistOutputs = finalizeSpecialistConsultations(specialistOutputs, acceptedEvents);
    if (trace) {
      trace.specialistOutputs = finalizedSpecialistOutputs;
    }

    const record: TurnRecord = {
      sessionId,
      turn: nextTurn,
      atIso: new Date().toISOString(),
      playerId,
      playerText,
      pendingPrompt: draft.meta.pendingPrompt || undefined,
      acceptedEvents,
      rejectedEvents,
      npcOutputs,
      specialistOutputs: finalizedSpecialistOutputs,
      narration,
      telemetry: afterTelemetry,
      trace,
    };

    await this.store.appendTurn(sessionId, record);
    await this.store.saveSnapshot(sessionId, draft);
    emitDebugEvent(emit, { type: 'turn.persisted', sessionId, turn: nextTurn });

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

function toRejectedEvent(event: WorldEvent, error: unknown): RejectedEventRecord {
  if (error instanceof SpineIntegrityError || error instanceof InvariantViolationError) {
    return {
      event,
      reason: `${error.code}:${error.message}`,
      details: error.details,
    };
  }
  return {
    event,
    reason: error instanceof Error ? error.message : 'unknown_error',
  };
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
  const data = normalizePendingPromptData(record.data);
  return { id, kind, question, options, data, createdTurn };
}

function normalizePendingPromptData(value: unknown): PendingPromptData | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const data: PendingPromptData = {};

  if (typeof record.locationId === 'string') {
    data.locationId = record.locationId;
  }
  if (typeof record.estimatedMinutes === 'number' && Number.isFinite(record.estimatedMinutes)) {
    data.estimatedMinutes = record.estimatedMinutes;
  }
  if (typeof record.subject === 'string') {
    data.subject = record.subject;
  }
  if (
    record.area === 'shoreline' ||
    record.area === 'docks' ||
    record.area === 'under_ribs' ||
    record.area === 'around_here'
  ) {
    data.area = record.area;
  }
  if (
    record.direction === 'east' ||
    record.direction === 'west' ||
    record.direction === 'north' ||
    record.direction === 'south'
  ) {
    data.direction = record.direction;
  }

  return Object.keys(data).length ? data : undefined;
}

function applyAgendaUpdates(state: WorldState, updates: GMFinishTurnInput['agendaUpdates']) {
  if (!updates || typeof updates !== 'object') return;
  const scene = normalizeSceneAgenda(updates.scene);
  if (scene) {
    state.agendas.scene = scene;
  }
  const world = normalizeWorldAgenda(updates.world);
  if (world) {
    state.agendas.world = world;
  }
}

function normalizeSceneAgenda(value: unknown): SceneAgenda | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pressures = normalizeStringArray(record.pressures);
  const unresolvedBeats = normalizeStringArray(record.unresolvedBeats);
  const immediateTensions = normalizeStringArray(record.immediateTensions);
  if (!pressures || !unresolvedBeats || !immediateTensions) return null;
  return {
    currentFocus: typeof record.currentFocus === 'string' && record.currentFocus.trim() ? record.currentFocus.trim() : undefined,
    pressures,
    unresolvedBeats,
    immediateTensions,
  };
}

function normalizeWorldAgenda(value: unknown): WorldAgenda | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const activeThreads = normalizeStringArray(record.activeThreads);
  const introductionOpportunities = normalizeStringArray(record.introductionOpportunities);
  const escalationHooks = normalizeStringArray(record.escalationHooks);
  if (!activeThreads || !introductionOpportunities || !escalationHooks) return null;
  return {
    activeThreads,
    introductionOpportunities,
    escalationHooks,
  };
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
  return normalized;
}
