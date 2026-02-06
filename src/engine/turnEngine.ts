import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonlSessionStore } from './session/jsonlStore';
import type { SessionStore, TurnRecord, TurnTrace } from './session/types';
import type { WorldState } from '../sim/state';
import type { WorldEvent } from '../sim/events';
import { checkInvariants } from '../sim/invariants';
import { validateEvent } from '../sim/validate';
import { applyEvents } from '../sim/reducer';
import { buildObservation } from '../sim/views/observe';
import { buildTelemetry } from '../sim/views/telemetry';
import { computeTurnDiff } from '../sim/views/diff';
import { OpenAIClient } from '../agents/llm/openaiClient';
import type { LLMClient } from '../agents/llm/types';
import { runGMAgent } from '../agents/gm/gmAgent';
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
  debug?: { includeTrace?: boolean };
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
      finish_turn: async (_input: { summary: string }) => {
        return { ok: true };
      },
    };

    try {
      const gmWorldContext = {
        observation: buildObservation(draft, playerId),
        telemetry: buildTelemetry(draft, playerId),
        playerTranscript: [
          ...turnHistory.map(turn => ({
            turn: turn.turn,
            playerId: turn.playerId,
            playerText: turn.playerText,
          })),
          { turn: nextTurn, playerId, playerText },
        ],
      };
      await runGMAgent({
        apiKey,
        playerText,
        worldContext: gmWorldContext,
        runtime,
        llm: this.llm,
        trace,
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
    const narration = await narrateTurn({
      apiKey,
      style: narratorStyle,
      playerText,
      telemetry: afterTelemetry,
      diff,
      rejectedEvents,
      llm: this.llm,
      onNarrationDelta: stream?.onNarrationDelta,
      trace,
    });

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
