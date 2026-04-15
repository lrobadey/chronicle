import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonlSessionStore } from './session/jsonlStore';
import type {
  RejectedEventRecord,
  SessionStore,
  TurnRecord,
  TurnTrace,
  WebTranscriptHistory,
  WebTurnSummary,
} from './session/types';
import type {
  PendingPrompt,
  PendingPromptData,
  SceneAgenda,
  WorldAgenda,
  WorldState,
  ActiveThread,
  HeldBeat,
  PendingWorldEvent,
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
import { getItemPlacement, isItemInteractable, isItemVisible, summarizeItemComponents } from '../sim/spine';
import { distance } from '../sim/utils';
import { OpenAIClient } from '../agents/llm/openaiClient';
import type { LLMClient } from '../agents/llm/types';
import { runGMAgent, type GMFinishTurnInput, type GMReasoningEffort } from '../agents/gm/gmAgent';
import { runNpcAgent, type NpcAgentOutput } from '../agents/npc/npcAgent';
import {
  buildNarratorParamsFromSystemsPacket,
  narrateOpening,
  narrateTurn,
  type NarratorStyle,
} from '../agents/narrator/narratorAgent';
import {
  runStaffInterview as runStaffInterviewAgent,
  type StaffInterviewMessage,
  type StaffInterviewResult,
} from '../agents/staffInterview';
import { runSystemsDesignerTask, type SystemsDesignerResultDetail, type SystemsNarratorPacket } from '../agents/council';
import {
  finalizeSpecialistConsultations,
  runSpecialistAgent,
  type SpecialistConsultation,
  type SpecialistType,
} from '../agents/specialists';
import {
  attachResolutionMetadata,
  runMechanicsAgent,
  type MechanicsResolutionRecord,
  type MechanicsResolution,
  type MechanicsWorkerRequest,
} from '../agents/mechanics';
import {
  runScheduleAgent,
  type ScheduleResolutionRecord,
  type ScheduleResolution,
  type ScheduleTaskInput,
} from '../agents/schedule';
import { closeStewardTurn, openStewardTurn } from '../agents/steward';
import { resolveWorldModule } from '../worlds/registry';
import { describeWorldModule, type WorldModule, type WorldPresentation } from '../worlds/types';
import type { DebugSink } from './debug';
import { emitDebugEvent } from './debug';
import {
  buildOpeningContext,
  buildOpeningRecap,
  buildGMWorldContext,
  buildNPCConversationContext,
  buildRecentTurnDigests,
  buildSpecialistContext,
  buildStaffInterviewContext,
  buildWebTranscriptHistory,
  buildWebTurnSummary,
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
  worldResolver?: (worldId?: string) => WorldModule;
}

export interface InitResult {
  sessionId: string;
  created: boolean;
  telemetry: ReturnType<typeof buildTelemetry>;
  opening: string;
  history?: WebTranscriptHistory;
  world: WorldPresentation;
}

export interface RunTurnInput {
  sessionId: string;
  playerId: string;
  playerText: string;
  apiKey?: string;
  gmReasoningEffort?: GMReasoningEffort;
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
  summary?: WebTurnSummary;
  trace?: TurnTrace;
}

export class TurnEngine {
  private store: SessionStore;
  private llm: LLMClient;
  private clock: () => Date;
  private worldResolver: (worldId?: string) => WorldModule;

  constructor(config: TurnEngineConfig = {}) {
    this.store = config.store || new JsonlSessionStore(path.resolve(process.cwd(), 'data/sessions'));
    this.llm = config.llm || new OpenAIClient();
    this.clock = config.clock || (() => new Date());
    this.worldResolver = config.worldResolver || resolveWorldModule;
  }

  async initSession(params: {
    sessionId?: string;
    worldId?: string;
    apiKey?: string;
    debug?: { onEvent?: DebugSink };
    stream?: {
      onOpeningStart?: (telemetry: ReturnType<typeof buildTelemetry>) => void;
      onOpeningDelta?: (delta: string) => void;
    };
  }): Promise<InitResult> {
    const { sessionId, worldId, apiKey, debug, stream } = params;
    const emit = debug?.onEvent;
    emitDebugEvent(emit, { type: 'init.started', sessionId });
    try {
      const ensured = await this.store.ensureSession(sessionId, {
        worldId,
        createWorld: requestedWorldId => this.createWorldState(requestedWorldId),
      });
      const turnHistory = await this.store.loadTurnLog(ensured.sessionId);
      emitDebugEvent(emit, { type: 'init.session_ready', sessionId: ensured.sessionId, created: ensured.created });
      assertNoInvariantIssues(ensured.state, 'Session initialized with invalid world state');
      const telemetry = buildTelemetry(ensured.state, 'player-1');
      const history = buildWebTranscriptHistory(ensured.state, turnHistory);
      const world = this.describeWorldState(ensured.state);
      stream?.onOpeningStart?.(telemetry);
      const opening = await narrateOpening({
        apiKey,
        openingMode: ensured.created ? 'first-world' : 'resume',
        openingContext: ensured.created ? buildOpeningContext(ensured.state) : null,
        telemetry,
        llm: this.llm,
        debug: emit,
        onOpeningDelta: stream?.onOpeningDelta,
      });
      if (ensured.created || !ensured.state.meta.openingNarration?.trim()) {
        ensured.state.meta.openingNarration = opening;
        if (ensured.created) {
          await this.store.saveInitialState(ensured.sessionId, ensured.state);
        }
        await this.store.saveSnapshot(ensured.sessionId, ensured.state);
      }
      return { sessionId: ensured.sessionId, created: ensured.created, telemetry, opening, history, world };
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

  async ensureStaffSession(params: { sessionId?: string; worldId?: string; playerId: string }) {
    const ensured = await this.store.ensureSession(params.sessionId, {
      worldId: params.worldId,
      createWorld: requestedWorldId => this.createWorldState(requestedWorldId),
    });
    if (!ensured.state.actors[params.playerId]) throw new PlayerNotFoundError(params.playerId);
    assertNoInvariantIssues(ensured.state, 'Session initialized with invalid world state');
    return {
      sessionId: ensured.sessionId,
      created: ensured.created,
      telemetry: buildTelemetry(ensured.state, params.playerId),
    };
  }

  private createWorldState(worldId?: string): WorldState {
    return this.worldResolver(worldId).createWorld({ anchorIso: this.clock().toISOString() });
  }

  private describeWorldState(state: WorldState): WorldPresentation {
    return describeWorldModule(this.worldResolver(state.meta.worldId));
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
    const { sessionId, playerId, playerText, apiKey, gmReasoningEffort, narratorStyle, debug, stream } = input;
    const emit = debug?.onEvent;
    if (!playerText?.trim()) throw new InputValidationError('playerText is required');

    const state = await this.store.loadSession(sessionId);
    if (!state) throw new SessionNotFoundError(sessionId);
    if (!state.actors[playerId]) throw new PlayerNotFoundError(playerId);
    assertNoInvariantIssues(state, 'Session world state is invalid before turn execution');
    const turnHistory = await this.store.loadTurnLog(sessionId);

    const incomingPendingPrompt: PendingPrompt | undefined =
      state.meta.pendingPrompt ?? turnHistory[turnHistory.length - 1]?.pendingPrompt ?? undefined;
    let currentPendingPrompt: PendingPrompt | undefined = incomingPendingPrompt;

    let draft = deepClone(state);
    const nextTurn = draft.meta.turn + 1;
    const acceptedEvents: WorldEvent[] = [];
    const rejectedEvents: RejectedEventRecord[] = [];
    const npcOutputs: NpcAgentOutput[] = [];
    const specialistOutputs: Array<Omit<SpecialistConsultation, 'usedSuggestion' | 'usedCandidateEvents'>> = [];
    const mechanicsResolutions = new Map<string, MechanicsResolutionRecord>();
    let activeMechanicsResolutionId: string | null = null;
    const scheduleResolutions = new Map<string, ScheduleResolutionRecord>();
    let activeScheduleResolutionId: string | null = null;
    let systemsNarratorPacket: SystemsNarratorPacket | null = null;
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
        const validation = validateEvent(stagedState, event, currentPendingPrompt);
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
          currentPendingPrompt?.id === stamped.confirmId
        ) {
          currentPendingPrompt = undefined;
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

    const requiresMechanicsReview = (events: WorldEvent[]) => {
      if (!activeMechanicsResolutionId) return false;
      return events.some(event => isSimpleMechanicsEvent(event));
    };

    const buildMechanicsRequest = (input: {
      playerText?: string | null;
      objective?: string | null;
      focus?: string | null;
      pendingPrompt?: PendingPrompt | null;
    }): MechanicsWorkerRequest => {
      const gmWorldContext = buildGMWorldContext({
        state: draft,
        playerId,
        playerText,
        nextTurn,
        turnHistory,
        pendingPrompt: currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
      });

      return {
        playerText: typeof input.playerText === 'string' && input.playerText.trim() ? input.playerText : playerText,
        objective: typeof input.objective === 'string' && input.objective.trim() ? input.objective.trim() : undefined,
        focus: typeof input.focus === 'string' && input.focus.trim() ? input.focus.trim() : undefined,
        pendingPrompt: normalizePendingPrompt(input.pendingPrompt) || currentPendingPrompt || draft.meta.pendingPrompt || null,
        telemetry: gmWorldContext.telemetry,
        travelCandidates: gmWorldContext.travelCandidates,
        nearby: gmWorldContext.nearby,
        landmarks: gmWorldContext.landmarks,
        observation: gmWorldContext.observation,
        localAffordances: buildMechanicsLocalAffordances(draft, playerId),
      };
    };

    const pushMechanicsTrace = (resolution: MechanicsResolution) => {
      if (!trace) return;
      trace.mechanicsResolutions = trace.mechanicsResolutions || [];
      trace.mechanicsResolutions.push(resolution);
      if (resolution.debug) {
        trace.mechanicsDebug = trace.mechanicsDebug || [];
        trace.mechanicsDebug.push(resolution.debug);
      }
    };

    const applyApprovedMechanicsResolution = (resolution: MechanicsResolution) => {
      const result = applyProposedEvents(resolution.candidateEvents || []);
      if (resolution.pendingPrompt) {
        draft.meta.pendingPrompt = resolution.pendingPrompt;
        currentPendingPrompt = resolution.pendingPrompt;
      }
      return result;
    };

    const pendingPromptResolution = resolvePendingPromptReply(currentPendingPrompt, playerText, playerId);
    if (pendingPromptResolution) {
      if (trace) {
        trace.toolCalls.push({
          tool: 'resolve_pending_prompt',
          input: {
            playerText,
            pendingPrompt: currentPendingPrompt,
          },
          output: {
            handled: pendingPromptResolution.handled,
            clearPrompt: pendingPromptResolution.clearPrompt,
            events: pendingPromptResolution.events,
          },
        });
      }

      if (pendingPromptResolution.clearPrompt) {
        delete draft.meta.pendingPrompt;
      }
      if (pendingPromptResolution.events.length) {
        applyProposedEvents(pendingPromptResolution.events);
      }
      if (pendingPromptResolution.clearPrompt && !draft.meta.pendingPrompt) {
        currentPendingPrompt = undefined;
      }
    } else {
      const stewardWorldContext = buildGMWorldContext({
        state: draft,
        playerId,
        playerText,
        nextTurn,
        turnHistory,
        pendingPrompt: currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
      });
      const stewardResult = openStewardTurn({
        playerText,
        directorState: draft.directorState,
        worldContext: stewardWorldContext,
        pendingPrompt: currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
        telemetry: stewardWorldContext.telemetry,
        turnNumber: nextTurn,
      });

      emitDebugEvent(emit, {
        type: 'tool.called',
        iteration: 0,
        tool: 'open_steward_turn',
        callId: 'steward-open-turn',
        callIndex: 1,
        callCount: 1,
        input: {
          playerText,
          turnNumber: nextTurn,
          pendingPrompt: currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
        },
      });
      emitDebugEvent(emit, {
        type: 'tool.result',
        iteration: 0,
        tool: 'open_steward_turn',
        callId: 'steward-open-turn',
        callIndex: 1,
        callCount: 1,
        output: stewardResult,
        ok: true,
      });
      if (trace) {
        trace.toolCalls.push({
          tool: 'open_steward_turn',
          input: {
            playerText,
            turnNumber: nextTurn,
            pendingPrompt: currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
          },
          output: stewardResult,
        });
      }

      const hasActivePendingPrompt = Boolean(currentPendingPrompt ?? draft.meta.pendingPrompt);
      let handledBySteward = false;
      if (!hasActivePendingPrompt && stewardResult.turnPlan.deterministicOwner === 'mechanics') {
        const request = buildMechanicsRequest({});
        emitDebugEvent(emit, {
          type: 'tool.called',
          iteration: 0,
          tool: 'steward_preflight_mechanics',
          callId: 'steward-preflight-mechanics',
          callIndex: 1,
          callCount: 1,
          input: request,
        });
        const deterministicDraft = await runMechanicsAgent({
          apiKey: undefined,
          request,
          llm: this.llm,
          debug: emit,
          trace,
        });
        const deterministicResolution = attachResolutionMetadata(
          deterministicDraft,
          createRuntimeId(),
          request.pendingPrompt,
          nextTurn,
        );
        emitDebugEvent(emit, {
          type: 'tool.result',
          iteration: 0,
          tool: 'steward_preflight_mechanics',
          callId: 'steward-preflight-mechanics',
          callIndex: 1,
          callCount: 1,
          output: deterministicResolution,
          ok: deterministicResolution.debug?.selectedModel === 'deterministic',
        });
        if (trace) {
          trace.toolCalls.push({
            tool: 'steward_preflight_mechanics',
            input: request,
            output: deterministicResolution,
          });
        }

        if (deterministicResolution.debug?.selectedModel === 'deterministic') {
          pushMechanicsTrace(deterministicResolution);
          const result = applyApprovedMechanicsResolution(deterministicResolution);
          handledBySteward = result.ok;
        }
      }

      if (!hasActivePendingPrompt && !handledBySteward && stewardResult.councilTasks.length) {
        const councilResults = [];
        for (const packet of stewardResult.councilTasks) {
          if (packet.task.domain !== 'systems') {
            continue;
          }
          const systemsTask = packet.task as typeof packet.task & { domain: 'systems' };
          const callId = `council-${packet.task.taskId}`;
          emitDebugEvent(emit, {
            type: 'tool.called',
            iteration: 0,
            tool: 'dispatch_council_task',
            callId,
            callIndex: 1,
            callCount: stewardResult.councilTasks.length,
            input: packet,
          });

          const startedAt = Date.now();
          const result = await runSystemsDesignerTask(systemsTask, {
            apiKey,
            llm: this.llm,
            turnNumber: nextTurn,
          });
          const councilPacket = {
            result,
            executionMs: Date.now() - startedAt,
          };
          councilResults.push(councilPacket);

          emitDebugEvent(emit, {
            type: 'tool.result',
            iteration: 0,
            tool: 'dispatch_council_task',
            callId,
            callIndex: 1,
            callCount: stewardResult.councilTasks.length,
            output: councilPacket,
            ok: result.confidence > 0,
          });
          trace?.toolCalls.push({
            tool: 'dispatch_council_task',
            input: packet,
            output: councilPacket,
          });

          const detail = (result.detail || null) as SystemsDesignerResultDetail | null;
          if (detail?.mechanicsResolution) {
            pushMechanicsTrace(detail.mechanicsResolution);
          }
        }

        emitDebugEvent(emit, {
          type: 'tool.called',
          iteration: 0,
          tool: 'close_steward_turn',
          callId: 'steward-close-turn',
          callIndex: 1,
          callCount: 1,
          input: {
            turnPlan: stewardResult.turnPlan,
            councilResults,
          },
        });
        const closeResult = closeStewardTurn({
          turnPlan: stewardResult.turnPlan,
          councilResults,
          directorState: draft.directorState,
        });
        emitDebugEvent(emit, {
          type: 'tool.result',
          iteration: 0,
          tool: 'close_steward_turn',
          callId: 'steward-close-turn',
          callIndex: 1,
          callCount: 1,
          output: closeResult,
          ok: closeResult.handled,
        });
        trace?.toolCalls.push({
          tool: 'close_steward_turn',
          input: {
            turnPlan: stewardResult.turnPlan,
            councilResults,
          },
          output: closeResult,
        });

        if (closeResult.handled) {
          const acceptedBefore = acceptedEvents.length;
          const result = applyProposedEvents(closeResult.proposedEvents);
          const acceptedDelta = acceptedEvents.length - acceptedBefore;
          const readOnlySystemsTurn = closeResult.proposedEvents.length === 0;
          handledBySteward = readOnlySystemsTurn ? result.ok : result.ok && acceptedDelta === closeResult.proposedEvents.length;
          if (handledBySteward && closeResult.narratorHandoff.kind === 'systems_v1') {
            systemsNarratorPacket = closeResult.narratorHandoff.packet;
          } else if (!handledBySteward && trace) {
            trace.toolCalls.push({
              tool: 'steward_fallback_to_gm',
              input: {
                turnPlan: stewardResult.turnPlan,
              },
              output: {
                reason: closeResult.proposedEvents.length > 0
                  ? 'systems_events_rejected_or_unapplied'
                  : closeResult.fallbackReason || 'steward_requested_gm_fallback',
              },
            });
          }
        } else if (trace) {
          trace.toolCalls.push({
            tool: 'steward_fallback_to_gm',
            input: {
              turnPlan: stewardResult.turnPlan,
            },
            output: {
              reason: closeResult.fallbackReason || 'steward_requested_gm_fallback',
            },
          });
        }
      }

      if (handledBySteward) {
        // Steward-owned deterministic mechanics already committed the turn state.
      } else {

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
          const npcConversation = buildNPCConversationContext({
            state: draft,
            turnHistory,
            playerId,
            playerText,
            nextTurn,
          });
          const output = await runNpcAgent({
            apiKey,
            npcId: npc.id,
            persona: { name: npc.name, tagline: npc.persona.tagline, background: npc.persona.background, voice: npc.persona.voice, goals: npc.persona.goals },
            observation,
            conversationHistory: npcConversation.conversationHistory,
            olderTurnsSummary: npcConversation.olderTurnsSummary,
            currentTurn: { turn: nextTurn, playerId },
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
            pendingPrompt: currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
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
          if (requiresMechanicsReview(input.events || [])) {
            const active = mechanicsResolutions.get(activeMechanicsResolutionId!);
            return {
              ok: false,
              error: 'mechanics_review_required',
              resolutionId: activeMechanicsResolutionId,
              summary: active?.resolution.summary,
            };
          }
          const result = applyProposedEvents(input.events || []);
          return { ok: true, ...result };
        },
        resolve_mechanics: async (input: {
          playerText?: string | null;
          objective?: string | null;
          focus?: string | null;
          pendingPrompt?: PendingPrompt | null;
        }) => {
          const request = buildMechanicsRequest(input);
          const draftResolution = await runMechanicsAgent({
            apiKey,
            request,
            llm: this.llm,
            debug: emit,
            trace,
          });
          const resolutionId = createRuntimeId();
          const resolution = attachResolutionMetadata(
            draftResolution,
            resolutionId,
            request.pendingPrompt,
            nextTurn,
          );
          mechanicsResolutions.set(resolutionId, { request, resolution, revisionCount: 0 });
          activeMechanicsResolutionId = resolutionId;
          pushMechanicsTrace(resolution);
          const { debug: _debug, ...resolutionForGM } = resolution;
          return resolutionForGM;
        },
        review_mechanics_resolution: async (input: {
          resolutionId: string;
          action: 'approve' | 'revise' | 'reject';
          feedback?: string | null;
        }) => {
          const cached = mechanicsResolutions.get(input.resolutionId);
          if (!cached) {
            return { ok: false, error: 'mechanics_resolution_not_found', resolutionId: input.resolutionId };
          }

          if (input.action === 'approve') {
            const result = applyApprovedMechanicsResolution(cached.resolution);
            mechanicsResolutions.delete(input.resolutionId);
            if (activeMechanicsResolutionId === input.resolutionId) {
              activeMechanicsResolutionId = null;
            }
            return {
              ok: result.ok,
              status: 'approved',
              resolutionId: input.resolutionId,
              accepted: result.accepted,
              rejected: result.rejected,
              summary: cached.resolution.summary,
            };
          }

          if (input.action === 'reject') {
            mechanicsResolutions.delete(input.resolutionId);
            if (activeMechanicsResolutionId === input.resolutionId) {
              activeMechanicsResolutionId = null;
            }
            return { ok: true, status: 'rejected', resolutionId: input.resolutionId };
          }

          const feedback = typeof input.feedback === 'string' ? input.feedback.trim() : '';
          if (!feedback) {
            return { ok: false, error: 'revision_feedback_required', resolutionId: input.resolutionId };
          }

          const MAX_REVISIONS = 2;
          if (cached.revisionCount >= MAX_REVISIONS) {
            mechanicsResolutions.delete(input.resolutionId);
            if (activeMechanicsResolutionId === input.resolutionId) {
              activeMechanicsResolutionId = null;
            }
            return { ok: true, status: 'rejected', resolutionId: input.resolutionId, reason: 'max_revisions_exceeded' };
          }

          const revisedDraft = await runMechanicsAgent({
            apiKey,
            request: {
              ...cached.request,
              revisionFeedback: feedback,
              previousDraft: {
                interpretation: cached.resolution.interpretation,
                summary: cached.resolution.summary,
                candidateEvents: cached.resolution.candidateEvents,
                confidence: cached.resolution.confidence,
              },
            },
            llm: this.llm,
            debug: emit,
            trace,
          });
          const nextResolutionId = createRuntimeId();
          const resolution = attachResolutionMetadata(
            revisedDraft,
            nextResolutionId,
            cached.request.pendingPrompt,
            nextTurn,
          );
          pushMechanicsTrace(resolution);
          mechanicsResolutions.delete(input.resolutionId);
          mechanicsResolutions.set(nextResolutionId, {
            request: {
              ...cached.request,
              revisionFeedback: feedback,
              previousDraft: {
                interpretation: cached.resolution.interpretation,
                summary: cached.resolution.summary,
                candidateEvents: cached.resolution.candidateEvents,
                confidence: cached.resolution.confidence,
              },
            },
            resolution,
            revisionCount: cached.revisionCount + 1,
          });
          activeMechanicsResolutionId = nextResolutionId;
          const { debug: _debug, ...resolutionForGM } = resolution;
          return {
            ok: true,
            status: 'revised',
            previousResolutionId: input.resolutionId,
            resolution: resolutionForGM,
          };
        },
        schedule_task: async (input: { task: string; actorId?: string | null; timeHint?: string | null }) => {
          const actor = input.actorId ? draft.actors[input.actorId] : undefined;
          const { deriveTime } = await import('../sim/systems/time');
          const timeInfo = deriveTime(draft);

          // Build named timepoints from the current day
          const currentDay = Math.floor(draft.systems.time.elapsedMinutes / 1440);
          const dayStartMinutes = currentDay * 1440;
          const namedTimepoints: Record<string, number> = {
            dawn: dayStartMinutes + 6 * 60,
            noon: dayStartMinutes + 12 * 60,
            dusk: dayStartMinutes + 18 * 60,
            midnight: dayStartMinutes + 24 * 60,
            tomorrow_dawn: dayStartMinutes + 30 * 60,
            tomorrow_noon: dayStartMinutes + 36 * 60,
          };

          const h = timeInfo.currentHour;
          const m = draft.systems.time.elapsedMinutes % 60;
          const ampm = h < 12 ? 'AM' : 'PM';
          const h12 = h % 12 === 0 ? 12 : h % 12;
          const clockDisplay = `Day ${timeInfo.currentDay}, ${h12}:${String(m).padStart(2, '0')} ${ampm}`;

          const scheduleInput: ScheduleTaskInput = {
            task: input.timeHint ? `${input.task} (timing hint: ${input.timeHint})` : input.task,
            actorId: input.actorId || undefined,
            actorName: actor?.name,
            currentElapsedMinutes: draft.systems.time.elapsedMinutes,
            worldTimeContext: {
              clockDisplay,
              currentDayIndex: currentDay,
              namedTimepoints,
            },
            existingSchedule: actor?.schedule?.entries.map(e => ({
              id: e.id,
              label: e.label,
              atHour: e.atHour,
            })),
            pendingProcessesForActor: input.actorId
              ? draft.systems.scheduledProcesses
                  .filter(p => {
                    const payload = p.payload;
                    return (
                      typeof payload === 'object' &&
                      payload !== null &&
                      'actorId' in payload &&
                      payload.actorId === input.actorId
                    );
                  })
                  .map(p => ({ id: p.id, label: p.label, dueAtMinutes: p.dueAtMinutes }))
              : undefined,
          };

          const resolution = await runScheduleAgent({
            apiKey,
            input: scheduleInput,
            llm: this.llm,
          });

          scheduleResolutions.set(resolution.id, { input: scheduleInput, resolution, revisionCount: 0 });
          activeScheduleResolutionId = resolution.id;

          const { ...resolutionForGM } = resolution;
          return resolutionForGM;
        },

        review_schedule_resolution: async (input: {
          scheduleResolutionId: string;
          action: 'approve' | 'revise' | 'reject';
          feedback?: string | null;
        }): Promise<unknown> => {
          const cached = scheduleResolutions.get(input.scheduleResolutionId);
          if (!cached) {
            return { ok: false, error: 'schedule_resolution_not_found', resolutionId: input.scheduleResolutionId };
          }

          if (input.action === 'approve') {
            // Apply all events from the resolution through propose_events validation
            const result = applyProposedEvents(cached.resolution.events as WorldEvent[]);
            scheduleResolutions.delete(input.scheduleResolutionId);
            if (activeScheduleResolutionId === input.scheduleResolutionId) {
              activeScheduleResolutionId = null;
            }
            return { ok: result.ok, status: 'approved', resolutionId: input.scheduleResolutionId, ...result };
          }

          if (input.action === 'reject') {
            scheduleResolutions.delete(input.scheduleResolutionId);
            if (activeScheduleResolutionId === input.scheduleResolutionId) {
              activeScheduleResolutionId = null;
            }
            return { ok: true, status: 'rejected', resolutionId: input.scheduleResolutionId };
          }

          // revise
          if (!input.feedback?.trim()) {
            return { ok: false, error: 'feedback_required_for_revision' };
          }
          const MAX_REVISIONS = 2;
          if (cached.revisionCount >= MAX_REVISIONS) {
            scheduleResolutions.delete(input.scheduleResolutionId);
            if (activeScheduleResolutionId === input.scheduleResolutionId) {
              activeScheduleResolutionId = null;
            }
            return { ok: true, status: 'rejected', resolutionId: input.scheduleResolutionId, reason: 'max_revisions_exceeded' };
          }

          const revisedResolution = await runScheduleAgent({
            apiKey,
            input: {
              ...cached.input,
              revisionFeedback: input.feedback,
              previousDraft: cached.resolution,
            },
            llm: this.llm,
          });

          const nextResolutionId = revisedResolution.id;
          scheduleResolutions.delete(input.scheduleResolutionId);
          scheduleResolutions.set(nextResolutionId, {
            input: cached.input,
            resolution: revisedResolution,
            revisionCount: cached.revisionCount + 1,
          });
          activeScheduleResolutionId = nextResolutionId;
          return {
            ok: true,
            status: 'revised',
            previousResolutionId: input.scheduleResolutionId,
            resolution: revisedResolution,
          };
        },

        finish_turn: async (input: GMFinishTurnInput) => {
          if (activeMechanicsResolutionId) {
            const active = mechanicsResolutions.get(activeMechanicsResolutionId);
            return {
              ok: false,
              error: 'mechanics_review_required',
              resolutionId: activeMechanicsResolutionId,
              summary: active?.resolution.summary,
            };
          }
          const clear = input.playerPrompt?.clear === true;
          if (clear) {
            delete draft.meta.pendingPrompt;
            currentPendingPrompt = undefined;
          }
          const pending = normalizePendingPrompt(input.playerPrompt?.pending);
          if (pending) {
            draft.meta.pendingPrompt = pending;
            currentPendingPrompt = pending;
          }
          applyAgendaUpdates(draft, input.agendaUpdates);
          applyDirectorUpdates(draft, input.directorUpdates, nextTurn);
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
          pendingPrompt: currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
        });
        await runGMAgent({
          apiKey,
          gmReasoningEffort,
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
        currentPendingPrompt = incomingPendingPrompt;
        if (currentPendingPrompt) {
          draft.meta.pendingPrompt = currentPendingPrompt;
        } else {
          delete draft.meta.pendingPrompt;
        }
      }
      }
    }

    assertNoInvariantIssues(draft, 'Session world state failed post-turn invariant checks');

    const beforeTelemetry = buildTelemetry(state, playerId);
    const afterTelemetry = buildTelemetry(draft, playerId);
    const diff = computeTurnDiff(beforeTelemetry, afterTelemetry, acceptedEvents);
    const summary = buildWebTurnSummary(draft, {
      acceptedEvents,
      rejectedEvents,
      diffSummary: diff.summary,
    });
    const recentTurns = buildRecentTurnDigests(draft, turnHistory);
    stream?.onNarrationStart?.(afterTelemetry);
    const narration = await narrateTurn(
      systemsNarratorPacket
        ? buildNarratorParamsFromSystemsPacket({
            packet: systemsNarratorPacket,
            apiKey,
            style: narratorStyle,
            telemetry: afterTelemetry,
            diff,
            recentTurns,
            opening: buildOpeningRecap(draft),
            pendingPrompt: draft.meta.pendingPrompt || null,
            rejectedEvents,
            llm: this.llm,
            debug: emit,
            onNarrationDelta: stream?.onNarrationDelta,
            trace,
          })
        : {
            apiKey,
            style: narratorStyle,
            playerText,
            telemetry: afterTelemetry,
            diff,
            recentTurns,
            opening: buildOpeningRecap(draft),
            pendingPrompt: draft.meta.pendingPrompt || null,
            rejectedEvents,
            llm: this.llm,
            debug: emit,
            onNarrationDelta: stream?.onNarrationDelta,
            trace,
          },
    );

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
      summary,
      trace,
    };
  }
}

function stampEvent(event: WorldEvent, turn: number): WorldEvent {
  return {
    ...event,
    meta: {
      id: createRuntimeId(),
      turn,
      by: 'gm',
      actorId: event.type === 'AdvanceTime' ? undefined : 'actorId' in event ? event.actorId : undefined,
    },
  };
}

function createRuntimeId(): string {
  try {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to node:crypto helper.
  }
  return randomUUID();
}

function isSimpleMechanicsEvent(event: WorldEvent): boolean {
  return (
    event.type === 'MoveActor' ||
    event.type === 'PickUpItem' ||
    event.type === 'DropItem' ||
    event.type === 'AffectItem' ||
    event.type === 'TravelToLocation' ||
    event.type === 'Explore' ||
    event.type === 'Inspect' ||
    event.type === 'AdvanceTime' ||
    event.type === 'TransferItem'
  );
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildMechanicsLocalAffordances(state: WorldState, playerId: string) {
  const player = state.actors[playerId];
  const carriedItems = player.inventory
    .filter(itemId => isItemVisible(state.spine, itemId))
    .map(itemId => ({
      id: itemId,
      name: state.items[itemId]?.name || itemId,
      components: summarizeItemComponents(state.spine, itemId),
    }));

  const nearbyItems = Object.values(state.items)
    .flatMap(item => {
      if (!isItemVisible(state.spine, item.id) || !isItemInteractable(state.spine, item.id)) return [];
      const placement = getItemPlacement(state.spine, item.id);
      if (!placement || placement.type !== 'located_in') return [];
      const distanceMeters = Math.round(distance(player.pos, placement.anchor) * state.map.cellSizeMeters);
      if (distanceMeters > 120) return [];
      return [{
        id: item.id,
        name: item.name,
        distanceMeters,
        portable: state.spine.entities[item.id]?.components.physical?.anchored !== true,
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
      distanceMeters: Math.round(distance(player.pos, actor.pos) * state.map.cellSizeMeters),
      inventory: actor.inventory
        .filter(itemId => isItemVisible(state.spine, itemId))
        .slice(0, 8)
        .map(itemId => ({
          id: itemId,
          name: state.items[itemId]?.name || itemId,
        })),
    }))
    .filter(actor => actor.distanceMeters <= 200)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 12);

  return {
    carriedItems,
    nearbyItems,
    nearbyActors,
    // Offer/service state is not first-class yet, so keep derivation conservative.
    obviousOffers: [] as Array<{
      kind: 'item' | 'service';
      actorId: string;
      actorName: string;
      summary: string;
      itemId?: string;
      itemName?: string;
    }>,
  };
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
  if (typeof record.area === 'string' && record.area.trim()) {
    data.area = record.area.trim();
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

function resolvePendingPromptReply(
  pendingPrompt: PendingPrompt | undefined,
  playerText: string,
  playerId: string,
): { handled: 'confirm_travel_yes' | 'confirm_travel_no'; clearPrompt: boolean; events: WorldEvent[] } | null {
  if (!pendingPrompt || pendingPrompt.kind !== 'confirm_travel') return null;
  const reply = classifyPromptReply(playerText);
  if (!reply) return null;

  if (reply === 'no') {
    return {
      handled: 'confirm_travel_no',
      clearPrompt: true,
      events: [],
    };
  }

  const locationId = typeof pendingPrompt.data?.locationId === 'string' ? pendingPrompt.data.locationId : null;
  if (!locationId) return null;
  return {
    handled: 'confirm_travel_yes',
    clearPrompt: false,
    events: [{
      type: 'TravelToLocation',
      actorId: playerId,
      locationId,
      pace: 'walk',
      confirmId: pendingPrompt.id,
      note: `Travel confirmed to ${locationId}.`,
    }],
  };
}

function classifyPromptReply(playerText: string): 'yes' | 'no' | null {
  const normalized = playerText
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const affirmative = new Set(['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay', 'do it', 'go ahead', 'confirm']);
  const negative = new Set(['no', 'n', 'nope', 'nah', 'cancel', 'stop', 'never mind', 'dont', "don't"]);

  if (affirmative.has(normalized)) return 'yes';
  if (negative.has(normalized)) return 'no';
  return null;
}

function applyAgendaUpdates(state: WorldState, updates: GMFinishTurnInput['agendaUpdates']) {
  if (!updates || typeof updates !== 'object') return;
  const scene = normalizeSceneAgenda(updates.scene);
  if (scene) {
    state.directorState.scene = scene;
  }
  const world = normalizeWorldAgenda(updates.world);
  if (world) {
    state.directorState.world = world;
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

function applyDirectorUpdates(
  state: WorldState,
  updates: GMFinishTurnInput['directorUpdates'],
  currentTurn: number,
) {
  if (!updates || typeof updates !== 'object') return;

  if (Array.isArray(updates.threadUpdates)) {
    for (const patch of updates.threadUpdates) {
      if (!patch || typeof patch !== 'object' || typeof patch.id !== 'string') continue;
      if ('remove' in patch && patch.remove === true) {
        state.directorState.activeThreads = state.directorState.activeThreads.filter(t => t.id !== patch.id);
        continue;
      }
      const existing = state.directorState.activeThreads.find(t => t.id === patch.id);
      if (!existing) continue;
      if (typeof patch.pressure === 'number') existing.pressure = Math.max(0, Math.min(1, patch.pressure));
      if (patch.status === 'rising' || patch.status === 'stable' || patch.status === 'cooling') existing.status = patch.status;
      existing.lastUpdatedTurn = currentTurn;
    }
  }

  if (Array.isArray(updates.newThreads)) {
    for (const raw of updates.newThreads) {
      if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) continue;
      const thread: ActiveThread = {
        id: randomUUID(),
        name: raw.name.trim(),
        pressure: typeof raw.pressure === 'number' ? Math.max(0, Math.min(1, raw.pressure)) : 0.5,
        status: (raw.status === 'rising' || raw.status === 'stable' || raw.status === 'cooling') ? raw.status : 'stable',
        domain: typeof raw.domain === 'string' && raw.domain.trim() ? raw.domain.trim() : undefined,
        createdTurn: currentTurn,
        lastUpdatedTurn: currentTurn,
      };
      state.directorState.activeThreads.push(thread);
    }
  }

  if (Array.isArray(updates.addHeldBeats)) {
    for (const raw of updates.addHeldBeats) {
      if (!raw || typeof raw !== 'object' || typeof raw.note !== 'string' || !raw.note.trim()) continue;
      const beat: HeldBeat = {
        id: randomUUID(),
        note: raw.note.trim(),
        releaseConditions: Array.isArray(raw.releaseConditions)
          ? raw.releaseConditions.filter((c: unknown) => typeof c === 'string').map((c: string) => c.trim()).filter(Boolean)
          : undefined,
        createdTurn: currentTurn,
      };
      state.directorState.heldBeats.push(beat);
    }
  }

  if (Array.isArray(updates.removeHeldBeats)) {
    const ids = new Set(updates.removeHeldBeats.filter((id: unknown) => typeof id === 'string'));
    if (ids.size) {
      state.directorState.heldBeats = state.directorState.heldBeats.filter(b => !ids.has(b.id));
    }
  }

  if (Array.isArray(updates.addPendingEvents)) {
    for (const raw of updates.addPendingEvents) {
      if (!raw || typeof raw !== 'object' || typeof raw.summary !== 'string' || !raw.summary.trim()) continue;
      const event: PendingWorldEvent = {
        id: randomUUID(),
        summary: raw.summary.trim(),
        dueTurn: typeof raw.dueTurn === 'number' ? raw.dueTurn : undefined,
        pressure: typeof raw.pressure === 'number' ? Math.max(0, Math.min(1, raw.pressure)) : undefined,
        domain: typeof raw.domain === 'string' && raw.domain.trim() ? raw.domain.trim() : undefined,
        createdTurn: currentTurn,
      };
      state.directorState.pendingWorldEvents.push(event);
    }
  }

  if (Array.isArray(updates.removePendingEvents)) {
    const ids = new Set(updates.removePendingEvents.filter((id: unknown) => typeof id === 'string'));
    if (ids.size) {
      state.directorState.pendingWorldEvents = state.directorState.pendingWorldEvents.filter(e => !ids.has(e.id));
    }
  }
}
