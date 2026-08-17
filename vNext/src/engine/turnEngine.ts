import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonlSessionStore } from './session/jsonlStore';
import type {
  CouncilArtifactRecord,
  RejectedEventRecord,
  SessionStore,
  TurnSpeechRecord,
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
import { deriveTime } from '../sim/systems/time';
import { estimateTravel, LONG_TRAVEL_MINUTES } from '../sim/systems/travel';
import { getItemPlacement, isItemInteractable, isItemVisible, summarizeItemComponents } from '../sim/spine';
import { distance } from '../sim/utils';
import { OpenAIClient } from '../agents/llm/openaiClient';
import type { LLMClient } from '../agents/llm/types';
import { pushToolTrace } from '../agents/llm/trace';
import {
  runGMAgent,
  type GMFinishTurnInput,
  type GMAgendaUpdates,
  type GMDirectorUpdates,
  type GMReasoningEffort,
} from '../agents/gm/gmAgent';
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
import {
  runCharacterDesignerTask,
  runSystemsDesignerTask,
  runWorldDesignerTask,
  type SystemsDesignerResultDetail,
  type SystemsNarratorPacket,
} from '../agents/council';
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
  type ScheduleResolution,
  type ScheduleResolutionRecord,
  type ScheduleTaskInput,
} from '../agents/schedule';
import {
  runStewardAgent,
  openStewardTurn,
  closeStewardTurn,
  type LegacyGMProposal,
  type StewardFinishTurnInput,
  type StewardMemoryUpdate,
  type StewardReasoningEffort,
} from '../agents/steward';
import type { CouncilToStewardPacket } from '../agents/hierarchy/packets';
import type { CouncilDomain, CouncilResult, CouncilTask } from '../agents/hierarchy/types';
import { classifyPromptReply } from '../agents/hierarchy/promptReply';
import { resolveWorldModule } from '../worlds/registry';
import { describeWorldModule, type WorldModule, type WorldPresentation } from '../worlds/types';
import type { DebugSink } from './debug';
import { emitDebugEvent } from './debug';
import {
    buildOpeningContext,
    buildOpeningRecap,
    buildCharacterDesignerContext,
    buildGMWorldContext,
    buildStewardContext,
    buildStewardRoutingSummary,
    buildSystemsDesignerContext,
    buildWorldDesignerContext,
    buildNPCConversationContext,
  buildRecentSpeechDigests,
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
  stewardReasoningEffort?: StewardReasoningEffort;
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

      const cachedOpening = !ensured.created ? ensured.state.meta.openingNarration?.trim() || null : null;
      if (cachedOpening) {
        return { sessionId: ensured.sessionId, created: false, telemetry, opening: cachedOpening, history, world };
      }

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
      ensured.state.meta.openingNarration = opening;
      if (ensured.created) {
        await this.store.saveInitialState(ensured.sessionId, ensured.state);
      }
      await this.store.saveSnapshot(ensured.sessionId, ensured.state);
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
    const {
      sessionId,
      playerId,
      playerText,
      apiKey,
      gmReasoningEffort,
      stewardReasoningEffort,
      narratorStyle,
      debug,
      stream,
    } = input;
    const turnStartedAt = Date.now();
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
    const councilArtifacts: CouncilArtifactRecord[] = [];
    const npcOutputs: NpcAgentOutput[] = [];
    const turnSpeech: TurnSpeechRecord[] = [];
    const specialistOutputs: Array<Omit<SpecialistConsultation, 'usedSuggestion' | 'usedCandidateEvents'>> = [];
    let systemsNarratorPacket: SystemsNarratorPacket | null = null;
    const trace: TurnTrace | undefined = debug?.includeTrace ? { toolCalls: [], llmCalls: [], debugSink: emit } as TurnTrace : undefined;
    draft.meta.turn = nextTurn;
    emitDebugEvent(emit, { type: 'turn.started', sessionId, turn: nextTurn, playerText });
    const orchestrationStartedAt = Date.now();

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
        const speech = buildTurnSpeechFromEvent(draft, event);
        if (speech) {
          turnSpeech.push(speech);
        }
      }
      for (const event of stagedAccepted) {
        emitDebugEvent(emit, { type: 'event.accepted', event });
      }
      draft = stagedState;
      return { ok: true, accepted: acceptedEvents.length, rejected: rejectedEvents.length };
    };

    const buildActiveGMWorldContext = (
      pendingPrompt: PendingPrompt | null = currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
    ) => buildGMWorldContext({
      state: draft,
      playerId,
      playerText,
      nextTurn,
      turnHistory,
      pendingPrompt,
    });

    const buildMechanicsRequest = (input: {
      playerText?: string | null;
      objective?: string | null;
      focus?: string | null;
      pendingPrompt?: PendingPrompt | null;
    }): MechanicsWorkerRequest => {
      const gmWorldContext = buildActiveGMWorldContext();

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

    const buildScheduleTaskInput = (input: {
      task: string;
      actorId?: string | null;
      timeHint?: string | null;
      revisionFeedback?: string;
      previousDraft?: ScheduleTaskInput['previousDraft'];
    }): ScheduleTaskInput => {
      const actorId = typeof input.actorId === 'string' && input.actorId.trim() ? input.actorId.trim() : undefined;
      const actor = actorId ? draft.actors[actorId] : undefined;
      const time = deriveTime(draft);
      const absoluteTime = new Date(time.absoluteIso);
      const currentMinutesOfDay = absoluteTime.getUTCHours() * 60 + absoluteTime.getUTCMinutes();

      return {
        task: input.task,
        actorId,
        actorName: actor?.name,
        currentElapsedMinutes: draft.systems.time.elapsedMinutes,
        worldTimeContext: {
          clockDisplay: `Day ${time.currentDay}, ${formatClockDisplay(currentMinutesOfDay)}`,
          currentDayIndex: time.currentDay - 1,
          namedTimepoints: {
            dawn: 480,
            noon: 720,
            dusk: 1080,
            midnight: 0,
          },
        },
        existingSchedule: actor?.schedule?.entries.map(entry => ({
          id: entry.id,
          label: entry.label,
          atHour: entry.atHour,
        })),
        pendingProcessesForActor: actorId
          ? draft.systems.scheduledProcesses
              .filter(process => process.id.includes(actorId) || process.payload.actorId === actorId)
              .map(process => ({
                id: process.id,
                label: process.label,
                dueAtMinutes: process.dueAtMinutes,
              }))
          : undefined,
        timeHint: typeof input.timeHint === 'string' && input.timeHint.trim() ? input.timeHint.trim() : undefined,
        revisionFeedback: input.revisionFeedback,
        previousDraft: input.previousDraft,
      };
    };

    const buildCouncilContextBundle = (
      pendingPrompt: PendingPrompt | null = currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
    ) => {
      const baseParams = {
        state: draft,
        playerId,
        playerText,
        nextTurn,
        turnHistory,
        pendingPrompt,
      };
      const systemsBase = buildSystemsDesignerContext(baseParams);
      return {
        routingSummary: buildStewardRoutingSummary(baseParams),
        characterContext: buildCharacterDesignerContext(baseParams),
        worldDesignerContext: buildWorldDesignerContext(baseParams),
        systemsContext: {
          ...systemsBase,
          localAffordances: buildMechanicsLocalAffordances(draft, playerId),
          mechanicsRequest: buildMechanicsRequest({
            playerText,
            pendingPrompt,
          }),
        },
      };
    };

    const dispatchCouncilTask = async (
      packet: { task: CouncilTask<CouncilDomain> },
    ): Promise<CouncilToStewardPacket<CouncilDomain>> => {
      const startedAt = Date.now();
      let result: CouncilResult<CouncilDomain>;
      switch (packet.task.domain) {
        case 'character':
          result = await runCharacterDesignerTask(packet.task as CouncilTask<'character'>, {
            apiKey,
            llm: this.llm,
            turnNumber: nextTurn,
            trace,
          });
          break;
        case 'world':
          result = await runWorldDesignerTask(packet.task as CouncilTask<'world'>, {
            apiKey,
            llm: this.llm,
            turnNumber: nextTurn,
            trace,
          });
          break;
        case 'systems':
        default:
          result = await runSystemsDesignerTask(packet.task as CouncilTask<'systems'>, {
            apiKey,
            llm: this.llm,
            turnNumber: nextTurn,
            trace,
          });
          break;
      }
      pushToolTrace(trace, {
        tool: 'dispatch_council_task',
        input: {
          taskId: packet.task.taskId,
          domain: packet.task.domain,
          directive: packet.task.directive,
          priority: packet.task.priority,
          context: packet.task.context,
        },
        output: {
          taskId: result.taskId,
          domain: result.domain,
          summary: result.summary,
          proposedEvents: result.proposedEvents,
          proposedEventCount: result.proposedEvents.length,
          detail: result.detail,
          confidence: result.confidence,
          warnings: result.warnings,
        },
        stage: 'council_dispatch',
      }, startedAt);
      return {
        result,
        executionMs: Date.now() - startedAt,
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

    const scheduleResolutionForGM = (resolution: ScheduleResolution) => ({
      scheduleResolutionId: resolution.id,
      status: resolution.status,
      rationale: resolution.rationale,
      confidence: resolution.confidence,
      events: resolution.events,
      clarificationNeeded: resolution.clarificationNeeded,
    });

    const effectiveStewardReasoningEffort = stewardReasoningEffort ?? gmReasoningEffort ?? 'low';
    let pendingLegacyArtifacts: null | {
      proposal: LegacyGMProposal;
      npcOutputs: NpcAgentOutput[];
      turnSpeech: TurnSpeechRecord[];
      specialistOutputs: Array<Omit<SpecialistConsultation, 'usedSuggestion' | 'usedCandidateEvents'>>;
    } = null;

    const buildStewardFinishInputFromLegacyProposal = (proposal: LegacyGMProposal): StewardFinishTurnInput => ({
      summary: proposal.summary,
      candidateEvents: proposal.candidateEvents,
      playerPrompt: {
        pending: proposal.pendingPrompt,
        clear: proposal.clearPendingPrompt === true,
      },
      agendaUpdates: proposal.agendaUpdates,
      directorUpdates: proposal.directorUpdates,
    });

    const stewardCouncilResults: CouncilToStewardPacket<CouncilDomain>[] = [];
    let stewardCouncilDispatches = 0;

    const appendCouncilArtifacts = (artifacts: CouncilArtifactRecord[]) => {
      for (const artifact of artifacts) {
        const exists = councilArtifacts.some(existing => JSON.stringify(existing) === JSON.stringify(artifact));
        if (!exists) councilArtifacts.push(artifact);
      }
    };

    const createAdHocCouncilPacket = (
      domain: CouncilDomain,
      priority: 'required' | 'optional' = 'required',
      reason?: string | null,
    ) => {
      const bundle = buildCouncilContextBundle();
      switch (domain) {
        case 'character':
          return {
            task: {
              taskId: `character-${nextTurn}-${stewardCouncilDispatches}`,
              domain,
              directive: reason?.trim() || `Determine the relevant NPC response to: "${playerText}"`,
              context: bundle.characterContext,
              priority,
            },
            directorState: draft.directorState,
            turnNumber: nextTurn,
            playerText,
          } as const;
        case 'world':
          return {
            task: {
              taskId: `world-${nextTurn}-${stewardCouncilDispatches}`,
              domain,
              directive: reason?.trim() || `Surface the most relevant world motion for: "${playerText}"`,
              context: bundle.worldDesignerContext,
              priority,
            },
            directorState: draft.directorState,
            turnNumber: nextTurn,
            playerText,
          } as const;
        case 'systems':
        default:
          return {
            task: {
              taskId: `systems-${nextTurn}-${stewardCouncilDispatches}`,
              domain: 'systems' as const,
              directive: reason?.trim() || `Resolve the systems-owned portion of: "${playerText}"`,
              context: bundle.systemsContext,
              priority,
            },
            directorState: draft.directorState,
            turnNumber: nextTurn,
            playerText,
          };
      }
    };

    const buildWorldSummaryPacket = (question?: string | null) => {
      const context = buildStewardRoutingSummary({
        state: draft,
        playerId,
        playerText,
        nextTurn,
        turnHistory,
        pendingPrompt: currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
      });
      return {
        ok: true,
        question: question || null,
        summary: [
          `Turn ${context.turnNumber} at ${context.telemetry.location.name}.`,
          context.sceneSummary.currentFocus ? `Scene focus: ${context.sceneSummary.currentFocus}.` : '',
          context.worldSummary.activeThreads.length ? `World threads: ${context.worldSummary.activeThreads.slice(0, 3).join('; ')}.` : '',
          context.pendingPrompt ? `Pending prompt: ${context.pendingPrompt.question}` : '',
        ].filter(Boolean).join(' '),
        sceneSummary: context.sceneSummary,
        worldSummary: context.worldSummary,
        telemetry: context.telemetry,
        pendingPrompt: context.pendingPrompt,
      };
    };

    const runLegacyGMProposal = async (
      reason: string,
      focus?: string | null,
      seedToolCall?: { name: string; arguments: Record<string, unknown> } | null,
    ): Promise<LegacyGMProposal> => {
      let proposalDraft = deepClone(draft);
      let proposalPendingPrompt = currentPendingPrompt ?? proposalDraft.meta.pendingPrompt ?? null;
      const proposalAcceptedEvents: WorldEvent[] = [];
      const proposalRejectedEvents: RejectedEventRecord[] = [];
      const proposalNpcOutputs: NpcAgentOutput[] = [];
      const proposalTurnSpeech: TurnSpeechRecord[] = [];
      const proposalSpecialistOutputs: Array<Omit<SpecialistConsultation, 'usedSuggestion' | 'usedCandidateEvents'>> = [];
      const localMechanicsResolutions = new Map<string, MechanicsResolutionRecord>();
      let localActiveMechanicsResolutionId: string | null = null;
      const localScheduleResolutions = new Map<string, ScheduleResolutionRecord>();
      let localActiveScheduleResolutionId: string | null = null;
      let proposalSummary = 'Legacy GM fallback turn';
      let proposalAgendaUpdates: GMAgendaUpdates | null = null;
      let proposalDirectorUpdates: GMDirectorUpdates | null = null;
      let proposalClearedPendingPrompt = false;

      const applyProposalEvents = (events: WorldEvent[]) => {
        const batch = Array.isArray(events) ? events.map(event => normalizeWorldEvent(event)) : [];
        if (!batch.length) {
          return { ok: true, accepted: proposalAcceptedEvents.length, rejected: proposalRejectedEvents.length };
        }

        const stagedAccepted: WorldEvent[] = [];
        let stagedState = deepClone(proposalDraft);
        for (const event of batch) {
          const validation = validateEvent(stagedState, event, proposalPendingPrompt);
          if (!validation.ok) {
            proposalRejectedEvents.push({ event, reason: validation.reason || 'invalid' });
            continue;
          }

          const stamped = stampEvent(event, nextTurn);
          try {
            stagedState = applyEvents(stagedState, [stamped]);
          } catch (error) {
            proposalRejectedEvents.push(toRejectedEvent(stamped, error));
            continue;
          }

          stagedAccepted.push(stamped);
          if (
            stamped.type === 'TravelToLocation' &&
            typeof stamped.confirmId === 'string' &&
            proposalPendingPrompt?.id === stamped.confirmId
          ) {
            proposalPendingPrompt = null;
            delete stagedState.meta.pendingPrompt;
          }
        }

        if (!stagedAccepted.length) {
          return { ok: true, accepted: proposalAcceptedEvents.length, rejected: proposalRejectedEvents.length };
        }

        const issues = checkInvariants(stagedState);
        if (issues.length) {
          const error = new InvariantViolationError(issues[0]?.message || 'Invariant violation', issues);
          for (const event of stagedAccepted) {
            proposalRejectedEvents.push(toRejectedEvent(event, error));
          }
          return { ok: false, accepted: proposalAcceptedEvents.length, rejected: proposalRejectedEvents.length };
        }

        proposalAcceptedEvents.push(...stagedAccepted);
        proposalDraft = stagedState;
        return { ok: true, accepted: proposalAcceptedEvents.length, rejected: proposalRejectedEvents.length };
      };

      const legacyRuntime = {
        observe_world: async (input: { perspective: 'gm' | 'player' }) => {
          return input.perspective === 'player'
            ? buildTelemetry(proposalDraft, playerId)
            : buildObservation(proposalDraft, playerId);
        },
        consult_npc: async (input: { npcId: string; topic?: string }) => {
          const npc = proposalDraft.actors[input.npcId];
          if (!npc || npc.kind !== 'npc' || !npc.persona) {
            return { error: 'npc_not_found' };
          }
          const output = await runNpcAgent({
            apiKey,
            npcId: npc.id,
            persona: {
              name: npc.name,
              tagline: npc.persona.tagline,
              background: npc.persona.background,
              voice: npc.persona.voice,
              goals: npc.persona.goals,
            },
            observation: buildObservation(proposalDraft, playerId),
            conversationHistory: buildNPCConversationContext({
              state: proposalDraft,
              turnHistory,
              playerId,
              playerText,
              nextTurn,
            }).conversationHistory,
            olderTurnsSummary: buildNPCConversationContext({
              state: proposalDraft,
              turnHistory,
              playerId,
              playerText,
              nextTurn,
            }).olderTurnsSummary,
            currentTurn: { turn: nextTurn, playerId },
            llm: this.llm,
            debug: undefined,
            trace,
          });
          proposalNpcOutputs.push(output);
          const speech = buildNpcConsultSpeechRecord(proposalDraft, output, playerId);
          if (speech) proposalTurnSpeech.push(speech);
          return output;
        },
        consult_specialist: async (input: { specialistType: SpecialistType; question: string; focus?: string | null }) => {
          const output = await runSpecialistAgent({
            apiKey,
            specialistType: input.specialistType,
            question: input.question,
            focus: input.focus || undefined,
            context: buildSpecialistContext({
              state: proposalDraft,
              playerId,
              playerText,
              nextTurn,
              turnHistory,
              specialistType: input.specialistType,
              pendingPrompt: proposalPendingPrompt,
            }),
            llm: this.llm,
            debug: undefined,
            trace,
          });
          proposalSpecialistOutputs.push({
            specialistType: input.specialistType,
            question: input.question,
            focus: input.focus || undefined,
            output,
          });
          return output;
        },
        propose_events: async (input: { events: WorldEvent[] }) => {
          return { ok: true, ...applyProposalEvents(input.events || []) };
        },
        resolve_mechanics: async (input: { playerText?: string | null; objective?: string | null; focus?: string | null; pendingPrompt?: PendingPrompt | null }) => {
          const request = {
            ...buildMechanicsRequest({
              playerText: input.playerText,
              objective: input.objective,
              focus: input.focus,
              pendingPrompt: input.pendingPrompt,
            }),
            pendingPrompt: normalizePendingPrompt(input.pendingPrompt) || proposalPendingPrompt,
          };
          const draftResolution = await runMechanicsAgent({
            apiKey,
            request,
            llm: this.llm,
            debug: undefined,
            trace,
          });
          const resolutionId = createRuntimeId();
          const resolution = attachResolutionMetadata(
            draftResolution,
            resolutionId,
            request.pendingPrompt,
            nextTurn,
          );
          localMechanicsResolutions.set(resolutionId, { request, resolution, revisionCount: 0 });
          localActiveMechanicsResolutionId = resolutionId;
          pushMechanicsTrace(resolution);
          const { debug: _debug, ...resolutionForGM } = resolution;
          return resolutionForGM;
        },
        review_mechanics_resolution: async (input: { resolutionId: string; action: 'approve' | 'revise' | 'reject'; feedback?: string | null }) => {
          const cached = localMechanicsResolutions.get(input.resolutionId);
          if (!cached) {
            return { ok: false, error: 'mechanics_resolution_not_found', resolutionId: input.resolutionId };
          }
          if (input.action === 'approve') {
            const result = applyProposalEvents(cached.resolution.candidateEvents);
            localMechanicsResolutions.delete(input.resolutionId);
            if (localActiveMechanicsResolutionId === input.resolutionId) {
              localActiveMechanicsResolutionId = null;
            }
            if (cached.resolution.pendingPrompt) {
              proposalDraft.meta.pendingPrompt = cached.resolution.pendingPrompt;
              proposalPendingPrompt = cached.resolution.pendingPrompt;
            }
            return { ok: result.ok, status: 'approved', resolutionId: input.resolutionId, accepted: result.accepted, rejected: result.rejected };
          }
          if (input.action === 'reject') {
            localMechanicsResolutions.delete(input.resolutionId);
            if (localActiveMechanicsResolutionId === input.resolutionId) {
              localActiveMechanicsResolutionId = null;
            }
            return { ok: true, status: 'rejected', resolutionId: input.resolutionId };
          }
          const feedback = typeof input.feedback === 'string' ? input.feedback.trim() : '';
          if (!feedback) {
            return { ok: false, error: 'revision_feedback_required', resolutionId: input.resolutionId };
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
            debug: undefined,
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
          localMechanicsResolutions.delete(input.resolutionId);
          localMechanicsResolutions.set(nextResolutionId, {
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
          localActiveMechanicsResolutionId = nextResolutionId;
          const { debug: _debug, ...resolutionForGM } = resolution;
          return { ok: true, status: 'revised', previousResolutionId: input.resolutionId, resolution: resolutionForGM };
        },
        schedule_task: async (input: { task: string; actorId?: string | null; timeHint?: string | null }) => {
          const request = buildScheduleTaskInput(input);
          const resolution = await runScheduleAgent({
            apiKey,
            input: request,
            llm: this.llm,
            trace,
          });
          localScheduleResolutions.set(resolution.id, { request, resolution, revisionCount: 0 });
          localActiveScheduleResolutionId = resolution.id;
          return scheduleResolutionForGM(resolution);
        },
        review_schedule_resolution: async (input: { scheduleResolutionId: string; action: 'approve' | 'revise' | 'reject'; feedback?: string | null }) => {
          const cached = localScheduleResolutions.get(input.scheduleResolutionId);
          if (!cached) {
            return { ok: false, error: 'schedule_resolution_not_found', scheduleResolutionId: input.scheduleResolutionId };
          }
          if (input.action === 'approve') {
            const result = applyProposalEvents(cached.resolution.events as WorldEvent[]);
            localScheduleResolutions.delete(input.scheduleResolutionId);
            if (localActiveScheduleResolutionId === input.scheduleResolutionId) {
              localActiveScheduleResolutionId = null;
            }
            return { ok: result.ok, status: 'approved', scheduleResolutionId: input.scheduleResolutionId, accepted: result.accepted, rejected: result.rejected };
          }
          if (input.action === 'reject') {
            localScheduleResolutions.delete(input.scheduleResolutionId);
            if (localActiveScheduleResolutionId === input.scheduleResolutionId) {
              localActiveScheduleResolutionId = null;
            }
            return { ok: true, status: 'rejected', scheduleResolutionId: input.scheduleResolutionId };
          }
          const feedback = typeof input.feedback === 'string' ? input.feedback.trim() : '';
          if (!feedback) {
            return { ok: false, error: 'revision_feedback_required', scheduleResolutionId: input.scheduleResolutionId };
          }
          const resolution = await runScheduleAgent({
            apiKey,
            input: buildScheduleTaskInput({
              task: cached.request.task,
              actorId: cached.request.actorId,
              timeHint: cached.request.timeHint,
              revisionFeedback: feedback,
              previousDraft: {
                status: cached.resolution.status,
                rationale: cached.resolution.rationale,
                confidence: cached.resolution.confidence,
                events: cached.resolution.events,
                clarificationNeeded: cached.resolution.clarificationNeeded,
              },
            }),
            llm: this.llm,
            trace,
          });
          localScheduleResolutions.delete(input.scheduleResolutionId);
          localScheduleResolutions.set(resolution.id, {
            request: {
              ...cached.request,
              revisionFeedback: feedback,
              previousDraft: {
                status: cached.resolution.status,
                rationale: cached.resolution.rationale,
                confidence: cached.resolution.confidence,
                events: cached.resolution.events,
                clarificationNeeded: cached.resolution.clarificationNeeded,
              },
            },
            resolution,
            revisionCount: cached.revisionCount + 1,
          });
          localActiveScheduleResolutionId = resolution.id;
          return { ok: true, status: 'revised', previousScheduleResolutionId: input.scheduleResolutionId, resolution: scheduleResolutionForGM(resolution) };
        },
        finish_turn: async (input: GMFinishTurnInput) => {
          if (localActiveMechanicsResolutionId) {
            const active = localMechanicsResolutions.get(localActiveMechanicsResolutionId);
            return { ok: false, error: 'mechanics_review_required', resolutionId: localActiveMechanicsResolutionId, summary: active?.resolution.summary };
          }
          if (localActiveScheduleResolutionId) {
            const active = localScheduleResolutions.get(localActiveScheduleResolutionId);
            return { ok: false, error: 'schedule_review_required', scheduleResolutionId: localActiveScheduleResolutionId, summary: active?.resolution.rationale };
          }
          proposalSummary = input.summary;
          proposalAgendaUpdates = input.agendaUpdates || null;
          proposalDirectorUpdates = input.directorUpdates || null;
          if (input.playerPrompt?.clear === true) {
            delete proposalDraft.meta.pendingPrompt;
            proposalPendingPrompt = null;
            proposalClearedPendingPrompt = true;
          }
          const pending = normalizePendingPrompt(input.playerPrompt?.pending);
          if (pending) {
            proposalDraft.meta.pendingPrompt = pending;
            proposalPendingPrompt = pending;
          }
          applyAgendaUpdates(proposalDraft, input.agendaUpdates);
          applyDirectorUpdates(proposalDraft, input.directorUpdates, nextTurn);
          return { ok: true };
        },
      };

      let shouldRunLegacyLoop = true;
      if (seedToolCall && typeof seedToolCall.name === 'string' && seedToolCall.name in legacyRuntime) {
        const toolName = seedToolCall.name as keyof typeof legacyRuntime;
        const toolArgs = seedToolCall.arguments || {};
        const seedStartedAt = Date.now();
        const seedOutput = await legacyRuntime[toolName](toolArgs as never);
        pushToolTrace(trace, { tool: String(toolName), input: toolArgs, output: seedOutput }, seedStartedAt);
        if (toolName === 'finish_turn' && deriveToolResultOk(seedOutput) !== false) {
          shouldRunLegacyLoop = false;
        }
      }

      const gmWorldContext = buildGMWorldContext({
        state: proposalDraft,
        playerId,
        playerText,
        nextTurn,
        turnHistory,
        pendingPrompt: proposalPendingPrompt,
      });
      if (shouldRunLegacyLoop) {
        await runGMAgent({
          apiKey,
          gmReasoningEffort,
          playerText,
          worldContext: gmWorldContext,
          runtime: legacyRuntime,
          debug: undefined,
          llm: this.llm,
          trace,
          traceAgent: 'legacy_gm',
        });
      }

      const proposal: LegacyGMProposal = {
        summary: proposalSummary,
        candidateEvents: proposalAcceptedEvents,
        pendingPrompt: proposalPendingPrompt,
        clearPendingPrompt: proposalClearedPendingPrompt,
        agendaUpdates: proposalAgendaUpdates,
        directorUpdates: proposalDirectorUpdates,
        reasoningNotes: [
          `Legacy GM fallback invoked: ${reason}`,
          focus ? `Focus: ${focus}` : '',
          proposalRejectedEvents.length ? `${proposalRejectedEvents.length} proposed event(s) were rejected during fallback planning.` : '',
        ].filter(Boolean),
      };
      pendingLegacyArtifacts = {
        proposal,
        npcOutputs: proposalNpcOutputs,
        turnSpeech: proposalTurnSpeech,
        specialistOutputs: proposalSpecialistOutputs,
      };
      return proposal;
    };

    const stewardRuntime = {
      inspect_world_summary: async (input: { question?: string | null }) => buildWorldSummaryPacket(input.question),
      dispatch_character_task: async (input: { reason?: string | null; priority?: 'required' | 'optional' | null }) => {
        stewardCouncilDispatches += 1;
        const packet = createAdHocCouncilPacket('character', input.priority || 'required', input.reason);
        const result = await dispatchCouncilTask(packet);
        stewardCouncilResults.push(result);
        return { ok: true, domain: 'character', result: result.result };
      },
      dispatch_world_task: async (input: { reason?: string | null; priority?: 'required' | 'optional' | null }) => {
        stewardCouncilDispatches += 1;
        const packet = createAdHocCouncilPacket('world', input.priority || 'required', input.reason);
        const result = await dispatchCouncilTask(packet);
        stewardCouncilResults.push(result);
        return { ok: true, domain: 'world', result: result.result };
      },
      dispatch_systems_task: async (input: { reason?: string | null; priority?: 'required' | 'optional' | null }) => {
        stewardCouncilDispatches += 1;
        const packet = createAdHocCouncilPacket('systems', input.priority || 'required', input.reason);
        const result = await dispatchCouncilTask(packet);
        stewardCouncilResults.push(result);
        return { ok: true, domain: 'systems', result: result.result };
      },
      inspect_council_results: async (input: { domains?: Array<'character' | 'world' | 'systems'> | null }) => ({
        ok: true,
        councilResults: input.domains?.length
          ? stewardCouncilResults.filter(result => input.domains!.includes(result.result.domain as never)).map(result => result.result)
          : stewardCouncilResults.map(result => result.result),
      }),
      finish_steward_turn: async (input: StewardFinishTurnInput) => {
        const result = applyProposedEvents(input.candidateEvents || []);
        if (input.playerPrompt?.clear === true) {
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
        applyStewardMemoryUpdate(draft, input.stewardMemoryUpdate, nextTurn);
        const closeResult = closeStewardTurn({
          turnPlan: {
            classification: 'steward_judgment',
            deterministicOwner: null,
            requiredDomains: [],
            optionalDomains: [],
            heldBeatsToConsider: [],
            pendingEventsToCheck: [],
            rationale: 'Steward judgment synthesis',
          },
          councilResults: stewardCouncilResults,
          directorState: draft.directorState,
        });
        appendCouncilArtifacts(closeResult.councilArtifacts);
        const systemsArtifact = closeResult.councilArtifacts.find(artifact => artifact.domain === 'systems');
        if (!systemsNarratorPacket && systemsArtifact?.domain === 'systems' && systemsArtifact.narratorPacket) {
          systemsNarratorPacket = systemsArtifact.narratorPacket as SystemsNarratorPacket;
        }
        if (pendingLegacyArtifacts && shouldAttachLegacyArtifacts(input, pendingLegacyArtifacts.proposal)) {
          npcOutputs.push(...pendingLegacyArtifacts.npcOutputs);
          turnSpeech.push(...pendingLegacyArtifacts.turnSpeech);
          specialistOutputs.push(...pendingLegacyArtifacts.specialistOutputs);
          pendingLegacyArtifacts = null;
        }
        return {
          ok: result.ok,
          accepted: result.accepted,
          rejected: result.rejected,
        };
      },
    };

    try {
      let stewardHandledTurn = false;
      let councilFallbackReason: string | null = null;
      const councilBundle = buildCouncilContextBundle();
      const openStewardStartedAt = Date.now();
      const stewardOpenResult = openStewardTurn({
        playerText,
        directorState: draft.directorState,
        worldContext: councilBundle,
        pendingPrompt: currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
        telemetry: councilBundle.systemsContext.telemetry,
        turnNumber: nextTurn,
      });
      const hasCouncilTasks = stewardOpenResult.councilTasks.length > 0;

      pushToolTrace(trace, {
        tool: 'open_steward_turn',
        input: {
          playerText,
          pendingPromptId: currentPendingPrompt?.id ?? null,
        },
        output: {
          classification: stewardOpenResult.turnPlan.classification,
          deterministicOwner: stewardOpenResult.turnPlan.deterministicOwner,
          requiredDomains: stewardOpenResult.turnPlan.requiredDomains,
          optionalDomains: stewardOpenResult.turnPlan.optionalDomains,
          heldBeatsToConsider: stewardOpenResult.turnPlan.heldBeatsToConsider,
          pendingEventsToCheck: stewardOpenResult.turnPlan.pendingEventsToCheck,
          rationale: stewardOpenResult.turnPlan.rationale,
          councilTasks: stewardOpenResult.councilTasks.length,
          tasks: stewardOpenResult.councilTasks.map(packet => ({
            taskId: packet.task.taskId,
            domain: packet.task.domain,
            directive: packet.task.directive,
            priority: packet.task.priority,
          })),
        },
        agent: 'steward',
        stage: 'open',
      }, openStewardStartedAt);

      if (hasCouncilTasks) {

        const councilResults = await Promise.all(
          stewardOpenResult.councilTasks.map(packet => dispatchCouncilTask(packet as { task: CouncilTask<CouncilDomain> })),
        );
        stewardCouncilResults.push(...councilResults);

        const closeStewardStartedAt = Date.now();
        const closeResult = closeStewardTurn({
          turnPlan: stewardOpenResult.turnPlan,
          councilResults,
          directorState: draft.directorState,
        });
        pushToolTrace(trace, {
          tool: 'close_steward_turn',
          input: {
            turnClassification: stewardOpenResult.turnPlan.classification,
            councilResults: councilResults.map(packet => packet.result.domain),
          },
          output: {
            handled: closeResult.handled,
            route: closeResult.trace.route,
            reason: closeResult.fallbackReason ?? closeResult.trace.reason,
            summary: closeResult.summary,
            councilDomains: closeResult.trace.councilDomains,
            proposedEvents: closeResult.proposedEvents,
            proposedEventCount: closeResult.proposedEvents.length,
            agendaUpdates: closeResult.agendaUpdates,
            directorUpdates: closeResult.directorUpdates,
            councilArtifacts: closeResult.councilArtifacts,
            narratorHandoff: closeResult.narratorHandoff,
          },
          agent: 'steward',
          stage: 'close',
        }, closeStewardStartedAt);

        const systemsPacket = councilResults.find(
          (packet): packet is CouncilToStewardPacket<'systems'> => packet.result.domain === 'systems',
        );
        const systemsDetail = systemsPacket?.result.detail as SystemsDesignerResultDetail | undefined;
        if (systemsDetail?.mechanicsResolution) {
          pushMechanicsTrace(systemsDetail.mechanicsResolution);
        }

        if (closeResult.handled) {
          const acceptedBefore = acceptedEvents.length;
          const rejectedBefore = rejectedEvents.length;
          applyProposedEvents(closeResult.proposedEvents);
          applyAgendaUpdates(draft, closeResult.agendaUpdates);
          applyDirectorUpdates(draft, closeResult.directorUpdates, nextTurn);
          appendCouncilArtifacts(closeResult.councilArtifacts);

          const clearsPendingPromptViaEvent = Boolean(
            systemsDetail?.pendingPromptRecommendation &&
            closeResult.proposedEvents.some(event =>
              event.type === 'TravelToLocation' &&
              event.confirmId === systemsDetail.pendingPromptRecommendation?.id,
            ),
          );

          if (systemsDetail?.pendingPromptRecommendation === null || clearsPendingPromptViaEvent) {
            delete draft.meta.pendingPrompt;
            currentPendingPrompt = undefined;
          } else if (systemsDetail?.pendingPromptRecommendation) {
            draft.meta.pendingPrompt = systemsDetail.pendingPromptRecommendation;
            currentPendingPrompt = systemsDetail.pendingPromptRecommendation;
          }

          const acceptedDelta = acceptedEvents.length - acceptedBefore;
          const rejectedDelta = rejectedEvents.length - rejectedBefore;
          const fullyApplied =
            closeResult.proposedEvents.length === 0 ||
            (acceptedDelta === closeResult.proposedEvents.length && rejectedDelta === 0);

          if (fullyApplied) {
            stewardHandledTurn = true;
            if (closeResult.narratorHandoff.kind === 'systems_v1') {
              systemsNarratorPacket = closeResult.narratorHandoff.packet;
            }
          } else {
            councilFallbackReason = 'systems_events_rejected_or_unapplied';
          }
        } else {
          councilFallbackReason = closeResult.fallbackReason ?? closeResult.trace.reason ?? 'council_result_unhandled';
        }
      }

      if (councilFallbackReason && stewardOpenResult.turnPlan.classification !== 'steward_judgment') {
        const legacyFallbackStartedAt = Date.now();
        const proposal = await runLegacyGMProposal(councilFallbackReason);
        const finishInput = buildStewardFinishInputFromLegacyProposal(proposal);
        const result = applyProposedEvents(finishInput.candidateEvents || []);
        if (finishInput.playerPrompt?.clear === true) {
          delete draft.meta.pendingPrompt;
          currentPendingPrompt = undefined;
        }
        const pending = normalizePendingPrompt(finishInput.playerPrompt?.pending);
        if (pending) {
          draft.meta.pendingPrompt = pending;
          currentPendingPrompt = pending;
        }
        applyAgendaUpdates(draft, finishInput.agendaUpdates);
        applyDirectorUpdates(draft, finishInput.directorUpdates, nextTurn);
        if (pendingLegacyArtifacts) {
          npcOutputs.push(...pendingLegacyArtifacts.npcOutputs);
          turnSpeech.push(...pendingLegacyArtifacts.turnSpeech);
          specialistOutputs.push(...pendingLegacyArtifacts.specialistOutputs);
          pendingLegacyArtifacts = null;
        }
        pushToolTrace(trace, {
          tool: 'legacy_council_fallback',
          input: { reason: councilFallbackReason },
          output: {
            ok: result.ok,
            summary: proposal.summary,
            candidateEvents: proposal.candidateEvents,
            candidateEventCount: proposal.candidateEvents.length,
            pendingPrompt: proposal.pendingPrompt,
            clearPendingPrompt: proposal.clearPendingPrompt === true,
            agendaUpdates: proposal.agendaUpdates,
            directorUpdates: proposal.directorUpdates,
            reasoningNotes: proposal.reasoningNotes,
          },
          agent: 'legacy_gm',
          stage: 'fallback',
        }, legacyFallbackStartedAt);
      }

      if (!stewardHandledTurn && stewardOpenResult.turnPlan.classification === 'steward_judgment') {
        const stewardContext = buildStewardRoutingSummary({
          state: draft,
          playerId,
          playerText,
          nextTurn,
          turnHistory,
          pendingPrompt: currentPendingPrompt ?? draft.meta.pendingPrompt ?? null,
        });
        await runStewardAgent({
          apiKey,
          stewardReasoningEffort: effectiveStewardReasoningEffort,
          playerText,
          context: stewardContext,
          runtime: stewardRuntime,
          debug: emit,
          llm: this.llm,
          trace,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      emitDebugEvent(emit, { type: 'error', stage: 'steward', message });
      pushToolTrace(trace, {
        tool: 'steward_agent_error',
        input: { playerText },
        output: { error: 'steward_agent_failed', message },
        executionMs: 0,
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
    const recentSpeech = buildRecentSpeechDigests(turnHistory);
    stream?.onNarrationStart?.(afterTelemetry);
    // #region agent log
    fetch('http://127.0.0.1:7412/ingest/6414e5d3-0ba2-48dd-aec2-bcdd9c092ae4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'10fa75'},body:JSON.stringify({sessionId:'10fa75',runId:'engine-turn',hypothesisId:'H4',location:'src/engine/turnEngine.ts:1391',message:'pre-narration orchestration completed',data:{elapsedMs:Date.now()-orchestrationStartedAt,turn:nextTurn,acceptedEvents:acceptedEvents.length,rejectedEvents:rejectedEvents.length,pendingPromptCreatedThisTurn:draft.meta.pendingPrompt?.createdTurn===nextTurn},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // Skip the narrator LLM call for pure prompt-creation turns: no events, no speech,
    // and the pending prompt was just created this turn. The prompt's question field is
    // already a user-facing string authored at output quality; there is nothing else to
    // narrate around it, so returning it directly avoids an unnecessary LLM round-trip.
    const promptOnlyNarration =
      !systemsNarratorPacket &&
      acceptedEvents.length === 0 &&
      rejectedEvents.length === 0 &&
      turnSpeech.length === 0 &&
      draft.meta.pendingPrompt?.createdTurn === nextTurn
        ? draft.meta.pendingPrompt.question
        : null;
    const narrationStartedAt = Date.now();
    const narration = promptOnlyNarration ?? await narrateTurn(
      systemsNarratorPacket
        ? buildNarratorParamsFromSystemsPacket({
            packet: systemsNarratorPacket,
            apiKey,
            style: narratorStyle,
            telemetry: afterTelemetry,
            diff,
            recentTurns,
            currentTurnSpeech: turnSpeech,
            recentSpeech,
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
            currentTurnSpeech: turnSpeech,
            recentSpeech,
            opening: buildOpeningRecap(draft),
            pendingPrompt: draft.meta.pendingPrompt || null,
            rejectedEvents,
            llm: this.llm,
            debug: emit,
            onNarrationDelta: stream?.onNarrationDelta,
            trace,
          },
    );
    // #region agent log
    fetch('http://127.0.0.1:7412/ingest/6414e5d3-0ba2-48dd-aec2-bcdd9c092ae4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'10fa75'},body:JSON.stringify({sessionId:'10fa75',runId:'engine-turn',hypothesisId:'H4',location:'src/engine/turnEngine.ts:1441',message:'narration completed',data:{elapsedMs:Date.now()-narrationStartedAt,usedPromptOnlyNarration:Boolean(promptOnlyNarration),turn:nextTurn,totalElapsedMs:Date.now()-turnStartedAt,narrationLength:narration.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const finalizedSpecialistOutputs = finalizeSpecialistConsultations(specialistOutputs, acceptedEvents);
    if (trace) {
      trace.councilArtifacts = councilArtifacts;
      trace.specialistOutputs = finalizedSpecialistOutputs;
    }

    const persistStartedAt = Date.now();
    const record: TurnRecord = {
      sessionId,
      turn: nextTurn,
      atIso: new Date().toISOString(),
      playerId,
      playerText,
      pendingPrompt: draft.meta.pendingPrompt || undefined,
      acceptedEvents,
      rejectedEvents,
      councilArtifacts,
      npcOutputs,
      turnSpeech,
      specialistOutputs: finalizedSpecialistOutputs,
      narration,
      telemetry: afterTelemetry,
      trace,
    };

    pushToolTrace(trace, {
      tool: 'persist_turn_record',
      input: {
        sessionId,
        turn: nextTurn,
      },
      output: {
        acceptedEventCount: acceptedEvents.length,
        rejectedEventCount: rejectedEvents.length,
        hasPendingPrompt: Boolean(draft.meta.pendingPrompt),
      },
      stage: 'persistence',
    }, persistStartedAt);

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

function buildTurnSpeechFromEvent(state: WorldState, event: WorldEvent): TurnSpeechRecord | null {
  if (event.type !== 'Speak') return null;
  const text = event.text.trim();
  const speaker = state.actors[event.actorId];
  if (!text || !speaker) return null;
  const recipient = event.toActorId ? state.actors[event.toActorId] : undefined;
  return {
    speakerActorId: speaker.id,
    speakerName: speaker.name,
    text,
    recipientActorIds: recipient ? [recipient.id] : [],
    recipientNames: recipient ? [recipient.name] : [],
    source: 'speak_event',
  };
}

function buildNpcConsultSpeechRecord(state: WorldState, output: NpcAgentOutput, defaultRecipientActorId: string): TurnSpeechRecord | null {
  const text = output.publicUtterance.trim();
  const speaker = state.actors[output.npcId];
  if (!text || !speaker) return null;
  const recipient = state.actors[defaultRecipientActorId];
  return {
    speakerActorId: speaker.id,
    speakerName: speaker.name,
    text,
    recipientActorIds: recipient ? [recipient.id] : [],
    recipientNames: recipient ? [recipient.name] : [],
    source: 'npc_consult',
  };
}

function stampEvent(event: WorldEvent, turn: number): WorldEvent {
  return {
    ...event,
    meta: {
      id: createRuntimeId(),
      turn,
      by: 'steward',
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

function formatClockDisplay(minutesOfDay: number): string {
  const normalized = ((minutesOfDay % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
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

function shouldAttachLegacyArtifacts(
  finishInput: StewardFinishTurnInput,
  proposal: LegacyGMProposal,
): boolean {
  if (finishInput.summary === proposal.summary) return true;
  if (finishInput.candidateEvents === proposal.candidateEvents) return true;
  const finishedEvents = Array.isArray(finishInput.candidateEvents) ? finishInput.candidateEvents : [];
  if (finishedEvents.length === 0 && proposal.candidateEvents.length === 0) return true;
  if (finishedEvents.length !== proposal.candidateEvents.length) return false;
  return finishedEvents.every((event, index) => {
    const candidate = proposal.candidateEvents[index];
    return JSON.stringify(event) === JSON.stringify(candidate);
  });
}

function deriveToolResultOk(output: unknown): boolean | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const record = output as Record<string, unknown>;
  if (typeof record.ok === 'boolean') return record.ok;
  if (typeof record.error === 'string') return false;
  return undefined;
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

function applyStewardMemoryUpdate(
  state: WorldState,
  update: StewardMemoryUpdate | null | undefined,
  currentTurn: number,
) {
  if (!update || typeof update !== 'object') return;
  const next = state.stewardMemory;
  if (Array.isArray(update.currentGoals)) next.currentGoals = normalizeStringArray(update.currentGoals) || next.currentGoals;
  if (Array.isArray(update.workingHypotheses)) next.workingHypotheses = normalizeStringArray(update.workingHypotheses) || next.workingHypotheses;
  if (Array.isArray(update.intendedBeats)) next.intendedBeats = normalizeStringArray(update.intendedBeats) || next.intendedBeats;
  if (Array.isArray(update.deferredQuestions)) next.deferredQuestions = normalizeStringArray(update.deferredQuestions) || next.deferredQuestions;
  if (Array.isArray(update.continuityNotes)) next.continuityNotes = normalizeStringArray(update.continuityNotes) || next.continuityNotes;
  next.lastUpdatedTurn = currentTurn;
}
