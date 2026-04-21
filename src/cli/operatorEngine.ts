import type { CliApiMode } from './app';
import { isChronicleError } from '../engine/errors';
import type { TurnEngine, InitResult } from '../engine/turnEngine';
import { buildStewardContext, buildStewardRoutingSummary } from '../engine/contextBuilders';
import type { DebugEvent } from '../engine/debug';
import type {
  CouncilArtifactRecord,
  RejectedEventRecord,
  TurnRecord,
  TurnTrace,
  TurnTraceToolCall,
} from '../engine/session/types';
import type { JsonlSessionStore } from '../engine/session/jsonlStore';
import type { PendingPrompt, StewardMemory, WorldState } from '../sim/state';
import type { Telemetry } from '../sim/views/telemetry';
import { buildTelemetry } from '../sim/views/telemetry';
import { computeTurnDiff } from '../sim/views/diff';
import type { WorldEvent } from '../sim/events';
import { classifyTurn } from '../agents/hierarchy';
import { classifyPromptReply } from '../agents/hierarchy/promptReply';
import { listWorldModules, resolveWorldModule, type WorldModule } from '../worlds';
import type { NarratorStyle } from '../agents/narrator/narratorAgent';
import type { GMReasoningEffort } from '../agents/gm/gmAgent';
import type { StaffInterviewContext } from '../engine/contextBuilders';

export type OperatorViewMode = 'summary' | 'operator' | 'full' | 'raw';

export interface SessionSummaryRow {
  sessionId: string;
  worldId: string;
  worldDisplayName: string;
  turn: number;
  pendingPromptKind: string | null;
  pendingPromptQuestion: string | null;
  updatedAtIso: string | null;
  lastPlayerText: string | null;
  lastRoute: string | null;
  lastFallbackReason: string | null;
}

export interface TurnRouteSummary {
  classification: string | null;
  deterministicOwner: string | null;
  requiredDomains: string[];
  optionalDomains: string[];
  heldBeatsToConsider: string[];
  pendingEventsToCheck: string[];
  rationale: string | null;
  councilTaskCount: number;
  councilDomains: string[];
  ownerLabel: string;
  closeRoute: string | null;
  stewardHandled: boolean;
  gmHandled: boolean;
  fallbackReason: string | null;
}

export interface PreflightSummary {
  pendingPromptActive: boolean;
  pendingPromptKind: string | null;
  promptReply: 'yes' | 'no' | null;
  deterministicOwnerCandidate: string | null;
  attempted: boolean;
  handled: boolean;
  notes: string[];
}

export interface CouncilDomainInspection {
  domain: string;
  ran: boolean;
  taskId: string | null;
  directive: string | null;
  priority: string | null;
  contextSummary: string | null;
  context: unknown;
  summary: string | null;
  warnings: string[];
  confidence: number | null;
  proposedEvents: WorldEvent[];
  proposedEventCount: number;
  resultDetail: unknown;
  artifact: CouncilArtifactRecord | null;
  executionMs: number | null;
}

export interface CouncilInspection {
  domains: CouncilDomainInspection[];
}

export interface GmFallbackSummary {
  occurred: boolean;
  reason: string | null;
  summary: string | null;
  candidateEvents: WorldEvent[];
  reasoningNotes: string[];
  toolTimeline: TurnTraceToolCall[];
}

export interface DecisionSummary {
  proposedEventCount: number;
  acceptedEvents: WorldEvent[];
  rejectedEvents: RejectedEventRecord[];
  agendaUpdates: unknown;
  directorUpdates: unknown;
  stewardMemoryUpdate: unknown;
  councilArtifacts: CouncilArtifactRecord[];
}

export interface NarrationSummary {
  invoked: boolean;
  style: string | null;
  source: 'systems_packet' | 'steward' | 'gm' | 'prompt_only' | 'unknown';
  text: string;
}

export interface StateDeltaReport {
  summary: string;
  timeDeltaMinutes: number;
  moved: boolean;
  newLocationName?: string;
  newItems: string[];
  newClues: string[];
  acceptedEvents: WorldEvent[];
  before: Telemetry;
  after: Telemetry;
}

export interface PersistenceSummary {
  sessionId: string;
  turn: number;
  turnRecordSaved: boolean;
  snapshotSaved: boolean;
  pendingPromptAfter: PendingPrompt | null;
  finalTelemetry: Telemetry;
}

export interface TraceTimelineEvent {
  index: number;
  phase: string;
  kind: string;
  label: string;
  summary: string;
  data?: unknown;
}

export interface PromptInspection {
  sessionId: string;
  pendingPrompt: PendingPrompt | null;
  deterministicReplyHandlers: {
    classifier: 'yes_no';
    recognizedReplies: {
      yes: string[];
      no: string[];
    };
  } | null;
}

export interface TurnHistoryRow {
  turn: number;
  atIso: string;
  playerText: string;
  route: string | null;
  domains: string[];
  acceptedEventCount: number;
  rejectedEventCount: number;
  fallback: boolean;
  pendingPrompt: string | null;
  narrationSummary: string | null;
}

export interface StewardInspection {
  sessionId: string;
  memory: StewardMemory;
  currentGoals: string[];
  workingHypotheses: string[];
  intendedBeats: string[];
  deferredQuestions: string[];
  continuityNotes: string[];
  mostRecentRoutingSummary: TurnRouteSummary | null;
  lastStewardOwnedOutcome: string | null;
  lastStewardTriggeredFallback: string | null;
  perTurnMemoryChanges: Array<{
    turn: number;
    atIso: string;
    update: unknown;
  }>;
  latestFinishStewardPayload: unknown;
  councilResultsVisibleAtClose: unknown[];
}

export interface StateInspection {
  sessionId: string;
  worldId: string;
  worldDisplayName: string;
  telemetry: Telemetry;
  pendingPrompt: PendingPrompt | null;
  directorState: WorldState['directorState'];
}

export interface WorldInspection {
  sessionId: string;
  world: {
    id: string;
    displayName: string;
    metadata: Record<string, unknown> | null;
    cliTheme: Record<string, unknown> | null;
  };
  counts: {
    actors: number;
    items: number;
    locations: number;
    factions: number;
    scheduledProcesses: number;
  };
}

export interface LastRunExplainTurn {
  turn: number;
  atIso: string;
  playerText: string;
  routeClassification: string;
  ownerLabel: string;
  ownerSummary: string;
  councilDomains: string[];
  majorDecisions: string[];
  fallbackUsed: boolean;
  fallbackReason: string | null;
  fallbackSummary: string;
  stateDeltaSummary: string;
  narrationOutcome: string;
  raw: {
    route: TurnRouteSummary;
    council: CouncilInspection;
    decision: DecisionSummary;
    narration: NarrationSummary;
    gmFallback: GmFallbackSummary | null;
    stateDelta: StateDeltaReport;
    timeline: TraceTimelineEvent[];
    turnRecord: TurnRecord;
  };
}

export interface LastRunExplainReport {
  status: 'ok' | 'no_completed_run';
  message: string;
  sessionId: string | null;
  worldId: string | null;
  worldDisplayName: string | null;
  turnCount: number;
  fallbackTurnCount: number;
  lastUpdatedAtIso: string | null;
  summary: string;
  turns: LastRunExplainTurn[];
}

export interface TurnExecutionReport {
  sessionCreated: boolean;
  sessionSummary: SessionSummaryRow;
  input: {
    rawPlayerText: string;
    normalizedPlayerText: string | null;
    sessionId: string;
    playerId: string;
    worldId: string;
    worldDisplayName: string;
    pendingPromptBefore: PendingPrompt | null;
    executionMode: 'live' | 'fallback' | 'auto->fallback';
  };
  route: TurnRouteSummary;
  preflight: PreflightSummary;
  steward: {
    routingSummary: unknown;
    memory: StewardMemory;
    finishInput: unknown;
  };
  council: CouncilInspection;
  gmFallback: GmFallbackSummary | null;
  decision: DecisionSummary;
  narration: NarrationSummary;
  persistence: PersistenceSummary;
  stateDelta: StateDeltaReport;
  timeline: TraceTimelineEvent[];
  raw: {
    debugEvents: DebugEvent[];
    latestTurn: TurnRecord;
    trace: TurnTrace | null;
  };
}

export interface TurnExplanation {
  sessionId: string | null;
  worldId: string;
  worldDisplayName: string;
  probableClassification: string;
  likelyDeterministicOwner: string | null;
  requiredDomains: string[];
  optionalDomains: string[];
  heldBeatsToConsider: string[];
  pendingEventsToCheck: string[];
  promptReply: 'yes' | 'no' | null;
  why: string;
  wouldNeedStewardJudgment: boolean;
  routingSummary: unknown;
  predictiveOnly: boolean;
}

export interface StaffAskReport {
  sessionId: string;
  source: 'live' | 'fallback';
  employeeReply: string;
  diagnostics: {
    currentUnderstanding: string;
    knownGoals: string[];
    missingContext: string[];
    frictionPoints: string[];
    improvementIdeas: string[];
    suggestedQuestions: string[];
    confidenceNotes: string[];
  };
  context: StaffInterviewContext;
}

export interface OperatorCliEngineOptions {
  engine: TurnEngine;
  store: JsonlSessionStore;
  worldResolver?: (worldId?: string) => WorldModule;
}

export class OperatorCliEngine {
  private readonly engine: TurnEngine;
  private readonly store: JsonlSessionStore;
  private readonly worldResolver: (worldId?: string) => WorldModule;

  constructor(options: OperatorCliEngineOptions) {
    this.engine = options.engine;
    this.store = options.store;
    this.worldResolver = options.worldResolver || resolveWorldModule;
  }

  async initSessionDetailed(params: {
    sessionId?: string;
    worldId?: string;
    apiKey?: string;
    apiMode: CliApiMode;
    onDebugEvent?: (event: DebugEvent) => void;
  }): Promise<{ result: InitResult; usedFallback: boolean; sessionSummary: SessionSummaryRow }> {
    const { result, usedFallback } = await initSessionWithFallback({
      engine: this.engine,
      sessionId: params.sessionId,
      worldId: params.worldId,
      apiKey: params.apiKey,
      apiMode: params.apiMode,
      onDebugEvent: params.onDebugEvent,
    });
    const sessionSummary = await this.getSessionSummary(result.sessionId);
    return { result, usedFallback, sessionSummary };
  }

  async runTurnDetailed(params: {
    sessionId?: string;
    worldId?: string;
    playerId: string;
    playerText: string;
    apiKey?: string;
    apiMode: CliApiMode;
    gmReasoningEffort?: GMReasoningEffort;
    narratorStyle?: NarratorStyle;
    onDebugEvent?: (event: DebugEvent) => void;
  }): Promise<TurnExecutionReport> {
    const runTurnDetailedStartedAt = Date.now();
    // #region agent log
    fetch('http://127.0.0.1:7412/ingest/6414e5d3-0ba2-48dd-aec2-bcdd9c092ae4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'10fa75'},body:JSON.stringify({sessionId:'10fa75',runId:'operator-run-turn',hypothesisId:'H3',location:'src/cli/operatorEngine.ts:331',message:'runTurnDetailed entered',data:{hasSessionId:Boolean(params.sessionId),worldId:params.worldId??null,apiMode:params.apiMode,playerTextLength:params.playerText.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const reinitStartedAt = Date.now();
    const existingState = params.sessionId ? await this.store.loadSession(params.sessionId) : null;
    let resolvedSessionId: string;
    let resolvedWorldId: string;
    let resolvedWorldDisplayName: string;
    let sessionCreated = false;
    let initUsedFallback = false;
    if (existingState && params.sessionId) {
      const world = this.worldResolver(existingState.meta.worldId);
      resolvedSessionId = params.sessionId;
      resolvedWorldId = world.id;
      resolvedWorldDisplayName = world.displayName;
    } else {
      const init = await this.initSessionDetailed({
        sessionId: params.sessionId,
        worldId: params.worldId,
        apiKey: params.apiKey,
        apiMode: params.apiMode,
        onDebugEvent: params.onDebugEvent,
      });
      resolvedSessionId = init.result.sessionId;
      resolvedWorldId = init.result.world.id;
      resolvedWorldDisplayName = init.result.world.displayName;
      sessionCreated = init.result.created;
      initUsedFallback = init.usedFallback;
    }
    // #region agent log
    fetch('http://127.0.0.1:7412/ingest/6414e5d3-0ba2-48dd-aec2-bcdd9c092ae4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'10fa75'},body:JSON.stringify({sessionId:'10fa75',runId:'operator-run-turn',hypothesisId:'H3',location:'src/cli/operatorEngine.ts:338',message:'runTurnDetailed session init completed',data:{elapsedMs:Date.now()-reinitStartedAt,sessionCreated,usedFallback:initUsedFallback,resolvedSessionId,reusedExisting:Boolean(existingState)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const beforeState = await this.loadSessionState(resolvedSessionId);
    const beforeHistory = await this.store.loadTurnLog(resolvedSessionId);
    const pendingPromptBefore = beforeState.meta.pendingPrompt ?? beforeHistory[beforeHistory.length - 1]?.pendingPrompt ?? null;
    const beforeTelemetry = buildTelemetry(beforeState, params.playerId);
    const routePlan = classifyTurn({
      playerText: params.playerText,
      directorState: beforeState.directorState,
      telemetry: beforeTelemetry,
      pendingPrompt: pendingPromptBefore,
      turnNumber: beforeState.meta.turn + 1,
    });

    const debugEvents: DebugEvent[] = [];
    const emitDebug = (event: DebugEvent) => {
      debugEvents.push(event);
      params.onDebugEvent?.(event);
    };
    const engineRunStartedAt = Date.now();
    const { result, usedFallback } = await runTurnWithFallback({
      engine: this.engine,
      sessionId: resolvedSessionId,
      playerId: params.playerId,
      playerText: params.playerText,
      apiKey: params.apiKey,
      apiMode: params.apiMode,
      gmReasoningEffort: params.gmReasoningEffort,
      narratorStyle: params.narratorStyle,
      onDebugEvent: emitDebug,
    });
    // #region agent log
    fetch('http://127.0.0.1:7412/ingest/6414e5d3-0ba2-48dd-aec2-bcdd9c092ae4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'10fa75'},body:JSON.stringify({sessionId:'10fa75',runId:'operator-run-turn',hypothesisId:'H4',location:'src/cli/operatorEngine.ts:367',message:'engine runTurn completed',data:{elapsedMs:Date.now()-engineRunStartedAt,usedFallback,turn:result.turn,acceptedEvents:result.acceptedEvents.length,rejectedEvents:result.rejectedEvents.length,totalElapsedMs:Date.now()-runTurnDetailedStartedAt},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const afterState = await this.loadSessionState(resolvedSessionId);
    const afterHistory = await this.store.loadTurnLog(resolvedSessionId);
    const latestTurn = afterHistory[afterHistory.length - 1];
    if (!latestTurn) {
      throw new Error(`Missing turn record after executing turn ${result.turn}`);
    }

    const afterTelemetry = latestTurn.telemetry || buildTelemetry(afterState, params.playerId);
    const sessionSummary = await this.getSessionSummary(resolvedSessionId);
    const route = buildRouteSummary(latestTurn, routePlan);
    const stateDelta = buildStateDeltaReport(beforeTelemetry, afterTelemetry, latestTurn.acceptedEvents);
    const executionMode = usedFallback || initUsedFallback
      ? 'auto->fallback'
      : params.apiMode === 'fallback' || !params.apiKey
        ? 'fallback'
        : 'live';
    const stewardContext = buildStewardContext({
      state: afterState,
      playerId: params.playerId,
      playerText: params.playerText,
      nextTurn: latestTurn.turn + 1,
      turnHistory: afterHistory,
      pendingPrompt: afterState.meta.pendingPrompt || null,
    });

    return {
      sessionCreated,
      sessionSummary,
      input: {
        rawPlayerText: params.playerText,
        normalizedPlayerText: normalizePlayerText(params.playerText),
        sessionId: resolvedSessionId,
        playerId: params.playerId,
        worldId: resolvedWorldId,
        worldDisplayName: resolvedWorldDisplayName,
        pendingPromptBefore,
        executionMode,
      },
      route,
      preflight: buildPreflightSummary({
        playerText: params.playerText,
        pendingPromptBefore,
        route,
      }),
      steward: {
        routingSummary: buildStewardRoutingSummary({
          state: beforeState,
          playerId: params.playerId,
          playerText: params.playerText,
          nextTurn: beforeState.meta.turn + 1,
          turnHistory: beforeHistory,
          pendingPrompt: pendingPromptBefore,
        }),
        memory: stewardContext.stewardMemory,
        finishInput: getLastToolInput(latestTurn.trace, 'finish_steward_turn'),
      },
      council: buildCouncilInspection(latestTurn),
      gmFallback: buildGmFallbackSummary(latestTurn),
      decision: buildDecisionSummary(latestTurn),
      narration: buildNarrationSummary(latestTurn),
      persistence: {
        sessionId: resolvedSessionId,
        turn: latestTurn.turn,
        turnRecordSaved: true,
        snapshotSaved: true,
        pendingPromptAfter: latestTurn.pendingPrompt || null,
        finalTelemetry: afterTelemetry,
      },
      stateDelta,
      timeline: buildTraceTimeline(latestTurn, debugEvents),
      raw: {
        debugEvents,
        latestTurn,
        trace: latestTurn.trace || null,
      },
    };
  }

  async explainTurn(params: {
    sessionId?: string;
    worldId?: string;
    playerId: string;
    playerText: string;
  }): Promise<TurnExplanation> {
    const context = await this.loadExplainContext(params);
    const telemetry = buildTelemetry(context.state, params.playerId);
    const plan = classifyTurn({
      playerText: params.playerText,
      directorState: context.state.directorState,
      telemetry,
      pendingPrompt: context.pendingPrompt,
      turnNumber: context.state.meta.turn + 1,
    });

    return {
      sessionId: context.sessionId,
      worldId: context.world.id,
      worldDisplayName: context.world.displayName,
      probableClassification: plan.classification,
      likelyDeterministicOwner: plan.deterministicOwner,
      requiredDomains: plan.requiredDomains,
      optionalDomains: plan.optionalDomains,
      heldBeatsToConsider: plan.heldBeatsToConsider,
      pendingEventsToCheck: plan.pendingEventsToCheck,
      promptReply: context.pendingPrompt ? classifyPromptReply(params.playerText) : null,
      why: plan.rationale,
      wouldNeedStewardJudgment: plan.classification === 'steward_judgment',
      routingSummary: buildStewardRoutingSummary({
        state: context.state,
        playerId: params.playerId,
        playerText: params.playerText,
        nextTurn: context.state.meta.turn + 1,
        turnHistory: context.turnHistory,
        pendingPrompt: context.pendingPrompt,
      }),
      predictiveOnly: true,
    };
  }

  async getSessionSummary(sessionId: string): Promise<SessionSummaryRow> {
    const state = await this.loadSessionState(sessionId);
    const turnHistory = await this.store.loadTurnLog(sessionId);
    return buildSessionSummaryRow(sessionId, state, turnHistory, this.worldResolver);
  }

  async getStateSnapshot(sessionId: string, playerId: string): Promise<StateInspection> {
    const state = await this.loadSessionState(sessionId);
    const world = this.worldResolver(state.meta.worldId);
    return {
      sessionId,
      worldId: world.id,
      worldDisplayName: world.displayName,
      telemetry: buildTelemetry(state, playerId),
      pendingPrompt: state.meta.pendingPrompt || null,
      directorState: state.directorState,
    };
  }

  async getLatestTurnTrace(sessionId: string): Promise<{
    sessionSummary: SessionSummaryRow;
    latestTurn: TurnRecord | null;
    timeline: TraceTimelineEvent[];
  }> {
    const turnHistory = await this.store.loadTurnLog(sessionId);
    const latestTurn = turnHistory[turnHistory.length - 1] || null;
    return {
      sessionSummary: await this.getSessionSummary(sessionId),
      latestTurn,
      timeline: latestTurn ? buildTraceTimeline(latestTurn) : [],
    };
  }

  async getLatestRouteSummary(sessionId: string, playerId = 'player-1'): Promise<TurnRouteSummary | null> {
    const turnHistory = await this.store.loadTurnLog(sessionId);
    const latestTurn = turnHistory[turnHistory.length - 1];
    if (!latestTurn) return null;
    const state = await this.loadSessionState(sessionId);
    const telemetry = buildTelemetry(state, playerId);
    const fallbackPlan = classifyTurn({
      playerText: latestTurn.playerText,
      directorState: state.directorState,
      telemetry,
      pendingPrompt: latestTurn.pendingPrompt || null,
      turnNumber: latestTurn.turn,
    });
    return buildRouteSummary(latestTurn, fallbackPlan);
  }

  async getStewardInspection(sessionId: string, playerId = 'player-1'): Promise<StewardInspection> {
    const state = await this.loadSessionState(sessionId);
    const turnHistory = await this.store.loadTurnLog(sessionId);
    const latestTurn = turnHistory[turnHistory.length - 1] || null;
    const lastFallbackTurn = [...turnHistory].reverse().find(turn => Boolean(buildGmFallbackSummary(turn)));
    const memoryChanges = turnHistory
      .map(turn => ({
        turn: turn.turn,
        atIso: turn.atIso,
        update: getStewardMemoryUpdate(turn),
      }))
      .filter(entry => entry.update != null);

    return {
      sessionId,
      memory: state.stewardMemory,
      currentGoals: state.stewardMemory.currentGoals,
      workingHypotheses: state.stewardMemory.workingHypotheses,
      intendedBeats: state.stewardMemory.intendedBeats,
      deferredQuestions: state.stewardMemory.deferredQuestions,
      continuityNotes: state.stewardMemory.continuityNotes,
      mostRecentRoutingSummary: latestTurn ? await this.getLatestRouteSummary(sessionId, playerId) : null,
      lastStewardOwnedOutcome: latestTurn && isStewardOwned(latestTurn) ? latestTurn.narration || latestTurn.playerText : null,
      lastStewardTriggeredFallback: lastFallbackTurn ? buildGmFallbackSummary(lastFallbackTurn)?.reason || null : null,
      perTurnMemoryChanges: memoryChanges,
      latestFinishStewardPayload: latestTurn ? getLastToolInput(latestTurn.trace, 'finish_steward_turn') : null,
      councilResultsVisibleAtClose: latestTurn ? getCouncilResultsVisibleAtClose(latestTurn) : [],
    };
  }

  async getCouncilInspection(sessionId: string): Promise<CouncilInspection> {
    const turnHistory = await this.store.loadTurnLog(sessionId);
    const latestTurn = turnHistory[turnHistory.length - 1];
    return latestTurn ? buildCouncilInspection(latestTurn) : { domains: [] };
  }

  async getPromptInspection(sessionId: string): Promise<PromptInspection> {
    const state = await this.loadSessionState(sessionId);
    return {
      sessionId,
      pendingPrompt: state.meta.pendingPrompt || null,
      deterministicReplyHandlers: state.meta.pendingPrompt
        ? {
            classifier: 'yes_no',
            recognizedReplies: {
              yes: ['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay', 'do it', 'go ahead', 'confirm'],
              no: ['no', 'n', 'nope', 'nah', 'cancel', 'stop', 'never mind', 'dont', "don't"],
            },
          }
        : null,
    };
  }

  async getTurnHistory(sessionId: string): Promise<TurnHistoryRow[]> {
    const turnHistory = await this.store.loadTurnLog(sessionId);
    return turnHistory.map(turn => {
      const route = buildRouteSummary(turn);
      return {
        turn: turn.turn,
        atIso: turn.atIso,
        playerText: turn.playerText,
        route: route.classification,
        domains: route.councilDomains,
        acceptedEventCount: turn.acceptedEvents.length,
        rejectedEventCount: turn.rejectedEvents.length,
        fallback: Boolean(route.fallbackReason),
        pendingPrompt: turn.pendingPrompt?.kind || null,
        narrationSummary: summarizeText(turn.narration, 120),
      };
    });
  }

  async getArtifacts(sessionId: string): Promise<Array<{
    turn: number;
    atIso: string;
    domain: string;
    artifactType: string;
    summary: string;
    relationToOutcome: string;
  }>> {
    const turnHistory = await this.store.loadTurnLog(sessionId);
    return turnHistory.flatMap(turn =>
      (turn.councilArtifacts || []).map(artifact => ({
        turn: turn.turn,
        atIso: turn.atIso,
        domain: artifact.domain,
        artifactType: `${artifact.domain}_artifact`,
        summary: artifact.summary,
        relationToOutcome: turn.acceptedEvents.length
          ? 'paired_with_accepted_events'
          : turn.rejectedEvents.length
            ? 'paired_with_rejected_events'
            : 'no_committed_events',
      })),
    );
  }

  async getWorldInspection(sessionId: string): Promise<WorldInspection> {
    const state = await this.loadSessionState(sessionId);
    const world = this.worldResolver(state.meta.worldId);
    return {
      sessionId,
      world: {
        id: world.id,
        displayName: world.displayName,
        metadata: asRecord(world.metadata),
        cliTheme: asRecord(world.cliTheme),
      },
      counts: {
        actors: Object.keys(state.actors).length,
        items: Object.keys(state.items).length,
        locations: Object.keys(state.locations).length,
        factions: Object.keys(state.factions).length,
        scheduledProcesses: state.systems.scheduledProcesses.length,
      },
    };
  }

  async getLastRunExplainReport(params: {
    sessionId?: string;
    playerId?: string;
  } = {}): Promise<LastRunExplainReport> {
    const playerId = params.playerId || 'player-1';
    const sessionId = params.sessionId || await this.resolveLatestCompletedSessionId();
    if (!sessionId) {
      return buildNoCompletedRunReport('No completed Chronicle run was found yet. Start a session and finish at least one turn first.');
    }

    const turnHistory = await this.store.loadTurnLog(sessionId);
    if (!turnHistory.length) {
      return buildNoCompletedRunReport(
        `Session ${sessionId} exists, but it does not have any persisted turns to explain yet.`,
        sessionId,
      );
    }

    const state = await this.loadSessionState(sessionId);
    const world = this.worldResolver(state.meta.worldId);
    const initialState = await this.store.loadInitialState(sessionId);
    const initialTelemetry = initialState ? buildTelemetry(initialState, playerId) : null;
    const turns = buildLastRunExplainTurns(turnHistory, initialTelemetry);
    const fallbackTurnCount = turns.filter(turn => turn.fallbackUsed).length;
    const lastUpdatedAtIso = turnHistory[turnHistory.length - 1]?.atIso || null;

    return {
      status: 'ok',
      message: `Explained ${turns.length} persisted turn${turns.length === 1 ? '' : 's'} from ${sessionId}.`,
      sessionId,
      worldId: world.id,
      worldDisplayName: world.displayName,
      turnCount: turns.length,
      fallbackTurnCount,
      lastUpdatedAtIso,
      summary: summarizeRunExplanation(turns),
      turns,
    };
  }

  async listSessions(): Promise<SessionSummaryRow[]> {
    const ids = await this.store.listSessionIds();
    const rows = await Promise.all(ids.map(async sessionId => {
      const state = await this.store.loadSession(sessionId);
      if (!state) return null;
      const turnHistory = await this.store.loadTurnLog(sessionId);
      return buildSessionSummaryRow(sessionId, state, turnHistory, this.worldResolver);
    }));

    return rows
      .filter((row): row is SessionSummaryRow => row != null)
      .sort((a, b) => {
        if (a.updatedAtIso && b.updatedAtIso) return b.updatedAtIso.localeCompare(a.updatedAtIso);
        if (a.updatedAtIso) return -1;
        if (b.updatedAtIso) return 1;
        return b.turn - a.turn;
      });
  }

  listWorlds(): Array<{
    id: string;
    displayName: string;
    summary: string | null;
    metadata: Record<string, unknown> | null;
  }> {
    return listWorldModules().map(world => ({
      id: world.id,
      displayName: world.displayName,
      summary: typeof world.metadata?.summary === 'string' ? world.metadata.summary : null,
      metadata: asRecord(world.metadata),
    }));
  }

  async askStaff(params: {
    sessionId?: string;
    worldId?: string;
    playerId: string;
    question: string;
    apiKey?: string;
    apiMode: CliApiMode;
  }): Promise<StaffAskReport> {
    const init = await this.initSessionDetailed({
      sessionId: params.sessionId,
      worldId: params.worldId,
      apiKey: params.apiKey,
      apiMode: params.apiMode,
    });
    const context = await this.engine.getStaffInterviewContext(init.result.sessionId, params.playerId);
    const sourceApiKey = init.usedFallback ? undefined : params.apiKey;
    const result = await this.engine.runStaffInterview({
      sessionId: init.result.sessionId,
      playerId: params.playerId,
      question: params.question,
      apiKey: sourceApiKey,
      conversation: [],
    });
    return {
      sessionId: init.result.sessionId,
      source: result.source,
      employeeReply: result.employeeReply,
      diagnostics: result.diagnostics,
      context,
    };
  }

  private async loadSessionState(sessionId: string): Promise<WorldState> {
    const state = await this.store.loadSession(sessionId);
    if (!state) throw new Error(`Session not found: ${sessionId}`);
    return state;
  }

  private async resolveLatestCompletedSessionId(): Promise<string | null> {
    const sessionIds = await this.store.listSessionIds();
    let latest: { sessionId: string; atIso: string } | null = null;

    for (const sessionId of sessionIds) {
      const turnHistory = await this.store.loadTurnLog(sessionId);
      const atIso = turnHistory[turnHistory.length - 1]?.atIso;
      if (!atIso) continue;
      try {
        await this.loadSessionState(sessionId);
      } catch (error) {
        // "Latest run" should mean latest session we can actually inspect.
        // Keep explicit `--session` behavior strict; only auto-selection skips bad saves.
        continue;
      }
      if (!latest || atIso > latest.atIso) {
        latest = { sessionId, atIso };
      }
    }

    return latest?.sessionId || null;
  }

  private async loadExplainContext(params: {
    sessionId?: string;
    worldId?: string;
    playerId: string;
    playerText: string;
  }): Promise<{
    sessionId: string | null;
    state: WorldState;
    turnHistory: TurnRecord[];
    pendingPrompt: PendingPrompt | null;
    world: {
      id: string;
      displayName: string;
    };
  }> {
    if (params.sessionId) {
      const state = await this.loadSessionState(params.sessionId);
      const turnHistory = await this.store.loadTurnLog(params.sessionId);
      const pendingPrompt = state.meta.pendingPrompt ?? turnHistory[turnHistory.length - 1]?.pendingPrompt ?? null;
      const world = this.worldResolver(state.meta.worldId);
      return {
        sessionId: params.sessionId,
        state,
        turnHistory,
        pendingPrompt,
        world: {
          id: world.id,
          displayName: world.displayName,
        },
      };
    }

    const world = this.worldResolver(params.worldId);
    const state = world.createWorld();
    return {
      sessionId: null,
      state,
      turnHistory: [],
      pendingPrompt: null,
      world: {
        id: world.id,
        displayName: world.displayName,
      },
    };
  }
}

function buildSessionSummaryRow(
  sessionId: string,
  state: WorldState,
  turnHistory: TurnRecord[],
  worldResolver: (worldId?: string) => WorldModule,
): SessionSummaryRow {
  const world = worldResolver(state.meta.worldId);
  const latestTurn = turnHistory[turnHistory.length - 1] || null;
  const latestRoute = latestTurn ? buildRouteSummary(latestTurn) : null;
  return {
    sessionId,
    worldId: world.id,
    worldDisplayName: world.displayName,
    turn: state.meta.turn,
    pendingPromptKind: state.meta.pendingPrompt?.kind || null,
    pendingPromptQuestion: state.meta.pendingPrompt?.question || null,
    updatedAtIso: latestTurn?.atIso || null,
    lastPlayerText: latestTurn?.playerText || null,
    lastRoute: latestRoute?.classification || null,
    lastFallbackReason: latestRoute?.fallbackReason || null,
  };
}

function buildNoCompletedRunReport(message: string, sessionId: string | null = null): LastRunExplainReport {
  return {
    status: 'no_completed_run',
    message,
    sessionId,
    worldId: null,
    worldDisplayName: null,
    turnCount: 0,
    fallbackTurnCount: 0,
    lastUpdatedAtIso: null,
    summary: message,
    turns: [],
  };
}

function buildLastRunExplainTurns(
  turnHistory: TurnRecord[],
  initialTelemetry: Telemetry | null,
): LastRunExplainTurn[] {
  let previousTelemetry = initialTelemetry;

  return turnHistory.map(turn => {
    const route = buildRouteSummary(turn);
    const council = buildCouncilInspection(turn);
    const decision = buildDecisionSummary(turn);
    const gmFallback = buildGmFallbackSummary(turn);
    const narration = buildNarrationSummary(turn);
    const stateDelta = previousTelemetry && turn.telemetry
      ? buildStateDeltaReport(previousTelemetry, turn.telemetry, turn.acceptedEvents)
      : buildUnavailableStateDelta(turn.acceptedEvents);

    if (turn.telemetry) {
      previousTelemetry = turn.telemetry;
    }

    return {
      turn: turn.turn,
      atIso: turn.atIso,
      playerText: turn.playerText,
      routeClassification: route.classification || 'unknown',
      ownerLabel: route.ownerLabel,
      ownerSummary: describeTurnOwner(route),
      councilDomains: route.councilDomains,
      majorDecisions: describeMajorDecisions(turn, route, decision, council),
      fallbackUsed: Boolean(gmFallback),
      fallbackReason: gmFallback?.reason || route.fallbackReason || null,
      fallbackSummary: describeFallback(gmFallback, route),
      stateDeltaSummary: stateDelta.summary,
      narrationOutcome: describeNarrationOutcome(narration),
      raw: {
        route,
        council,
        decision,
        narration,
        gmFallback,
        stateDelta,
        timeline: buildTraceTimeline(turn),
        turnRecord: turn,
      },
    };
  });
}

function buildRouteSummary(turn: TurnRecord, fallbackPlan?: ReturnType<typeof classifyTurn>): TurnRouteSummary {
  const openCall = getMostInformativeToolCall(turn.trace, 'open_steward_turn');
  const closeCall = getLastToolCall(turn.trace, 'close_steward_turn');
  const fallbackCall = getLastToolCall(turn.trace, 'legacy_council_fallback');
  const finishSteward = getLastToolCall(turn.trace, 'finish_steward_turn');
  const finishTurn = getLastToolCall(turn.trace, 'finish_turn');
  const openOutput = asRecord(openCall?.output);
  const closeOutput = asRecord(closeCall?.output);
  const fallbackOutput = asRecord(fallbackCall?.output);
  const classification = readString(openOutput, 'classification') || fallbackPlan?.classification || null;
  const deterministicOwner = readString(openOutput, 'deterministicOwner') || fallbackPlan?.deterministicOwner || null;
  const requiredDomains = readStringArray(openOutput, 'requiredDomains', fallbackPlan?.requiredDomains || []);
  const optionalDomains = readStringArray(openOutput, 'optionalDomains', fallbackPlan?.optionalDomains || []);
  const heldBeatsToConsider = readStringArray(openOutput, 'heldBeatsToConsider', fallbackPlan?.heldBeatsToConsider || []);
  const pendingEventsToCheck = readStringArray(openOutput, 'pendingEventsToCheck', fallbackPlan?.pendingEventsToCheck || []);
  const rationale = readString(openOutput, 'rationale') || fallbackPlan?.rationale || null;
  const councilDispatches = getCouncilDispatches(turn.trace);
  const councilDomains = councilDispatches
    .map(readCouncilDomainFromTraceCall)
    .filter((value): value is string => Boolean(value));
  const closeRoute = readString(closeOutput, 'route')
    || (finishSteward ? 'steward' : finishTurn ? 'legacy_gm' : null);
  const fallbackReason = readString(fallbackOutput, 'reason')
    || readString(closeOutput, 'reason')
    || null;
  const stewardHandled = closeRoute === 'council' || Boolean(finishSteward);
  const gmHandled = Boolean(finishTurn) || Boolean(fallbackCall);

  let ownerLabel = 'unknown owner';
  if (classification === 'deterministic') {
    ownerLabel = deterministicOwner ? `owned by deterministic ${deterministicOwner}` : 'owned by deterministic systems';
  } else if (stewardHandled && councilDomains.length === 1) {
    ownerLabel = `owned by ${councilDomains[0]} council`;
  } else if (stewardHandled && closeRoute === 'steward') {
    ownerLabel = 'closed by steward';
  } else if (gmHandled) {
    ownerLabel = 'fell back to legacy GM';
  }

  return {
    classification,
    deterministicOwner,
    requiredDomains,
    optionalDomains,
    heldBeatsToConsider,
    pendingEventsToCheck,
    rationale,
    councilTaskCount: readNumber(openOutput, 'councilTasks') ?? councilDispatches.length,
    councilDomains,
    ownerLabel,
    closeRoute,
    stewardHandled,
    gmHandled,
    fallbackReason,
  };
}

function getCouncilDispatches(trace?: TurnTrace): TurnTraceToolCall[] {
  return getToolCalls(trace).filter(call => {
    if (call.tool === 'dispatch_council_task') return true;
    return call.tool === 'dispatch_character_task'
      || call.tool === 'dispatch_world_task'
      || call.tool === 'dispatch_systems_task';
  });
}

function readCouncilDomainFromTraceCall(call: TurnTraceToolCall): string | null {
  if (call.tool === 'dispatch_council_task') {
    return readString(asRecord(call.input), 'domain') || null;
  }
  if (call.tool === 'dispatch_character_task') return 'character';
  if (call.tool === 'dispatch_world_task') return 'world';
  if (call.tool === 'dispatch_systems_task') return 'systems';
  return null;
}

function readCouncilDispatchOutput(call?: TurnTraceToolCall): Record<string, unknown> | null {
  if (!call) return null;
  const output = asRecord(call.output);
  if (!output) return null;
  return getNestedRecord(output, 'result') || output;
}

function buildPreflightSummary(params: {
  playerText: string;
  pendingPromptBefore: PendingPrompt | null;
  route: TurnRouteSummary;
}): PreflightSummary {
  const promptReply = params.pendingPromptBefore ? classifyPromptReply(params.playerText) : null;
  return {
    pendingPromptActive: Boolean(params.pendingPromptBefore),
    pendingPromptKind: params.pendingPromptBefore?.kind || null,
    promptReply,
    deterministicOwnerCandidate: params.route.deterministicOwner,
    attempted: Boolean(promptReply) || params.route.classification === 'deterministic',
    handled: params.route.classification === 'deterministic' && !params.route.fallbackReason,
    notes: [
      params.pendingPromptBefore ? `pending_prompt=${params.pendingPromptBefore.kind}` : 'no_pending_prompt',
      promptReply ? `prompt_reply=${promptReply}` : 'prompt_reply=none',
      params.route.deterministicOwner ? `deterministic_owner=${params.route.deterministicOwner}` : 'deterministic_owner=none',
      params.route.fallbackReason ? `fallback=${params.route.fallbackReason}` : 'fallback=none',
    ],
  };
}

function buildCouncilInspection(turn: TurnRecord): CouncilInspection {
  const artifacts = turn.councilArtifacts || [];
  const dispatchCalls = getCouncilDispatches(turn.trace);
  const domains = ['character', 'world', 'systems'].map(domain => {
    const call = dispatchCalls.find(candidate => readCouncilDomainFromTraceCall(candidate) === domain);
    const input = asRecord(call?.input);
    const output = readCouncilDispatchOutput(call);
    const artifact = artifacts.find(candidate => candidate.domain === domain) || null;
    return {
      domain,
      ran: Boolean(call),
      taskId: readString(input, 'taskId') || null,
      directive: readString(input, 'directive') || readString(input, 'reason') || null,
      priority: readString(input, 'priority') || null,
      contextSummary: describeContext(input?.context),
      context: input?.context,
      summary: readString(output, 'summary') || artifact?.summary || null,
      warnings: readStringArray(output, 'warnings'),
      confidence: readNumber(output, 'confidence'),
      proposedEvents: readArray(output, 'proposedEvents') as WorldEvent[],
      proposedEventCount: readNumber(output, 'proposedEventCount') || 0,
      resultDetail: output?.detail,
      artifact,
      executionMs: call?.executionMs ?? null,
    } satisfies CouncilDomainInspection;
  });

  return { domains };
}

function buildGmFallbackSummary(turn: TurnRecord): GmFallbackSummary | null {
  const fallbackCall = getLastToolCall(turn.trace, 'legacy_council_fallback');
  if (!fallbackCall) return null;
  const output = asRecord(fallbackCall.output);
  const toolTimeline = getToolCalls(turn.trace).filter(call => call.agent === 'legacy_gm' || call.tool === 'finish_turn');
  return {
    occurred: true,
    reason: readString(asRecord(fallbackCall.input), 'reason') || readString(output, 'reason') || null,
    summary: readString(output, 'summary') || null,
    candidateEvents: readArray(output, 'candidateEvents') as WorldEvent[],
    reasoningNotes: readStringArray(output, 'reasoningNotes'),
    toolTimeline,
  };
}

function buildDecisionSummary(turn: TurnRecord): DecisionSummary {
  const closeOutput = asRecord(getLastToolCall(turn.trace, 'close_steward_turn')?.output);
  const fallbackOutput = asRecord(getLastToolCall(turn.trace, 'legacy_council_fallback')?.output);
  const finishStewardInput = getLastToolInput(turn.trace, 'finish_steward_turn');
  return {
    proposedEventCount: turn.acceptedEvents.length + turn.rejectedEvents.length,
    acceptedEvents: turn.acceptedEvents,
    rejectedEvents: turn.rejectedEvents,
    agendaUpdates: closeOutput?.agendaUpdates || fallbackOutput?.agendaUpdates || getNestedRecord(finishStewardInput, 'agendaUpdates') || null,
    directorUpdates: closeOutput?.directorUpdates || fallbackOutput?.directorUpdates || getNestedRecord(finishStewardInput, 'directorUpdates') || null,
    stewardMemoryUpdate: getNestedRecord(finishStewardInput, 'stewardMemoryUpdate') || null,
    councilArtifacts: turn.councilArtifacts || [],
  };
}

function buildNarrationSummary(turn: TurnRecord): NarrationSummary {
  const systemsArtifact = (turn.councilArtifacts || []).find(artifact => artifact.domain === 'systems');
  const latestFinishSteward = getLastToolCall(turn.trace, 'finish_steward_turn');
  const latestFinishTurn = getLastToolCall(turn.trace, 'finish_turn');
  const source =
    turn.pendingPrompt && turn.narration === turn.pendingPrompt.question
      ? 'prompt_only'
      : systemsArtifact && 'narratorPacket' in systemsArtifact && systemsArtifact.narratorPacket
        ? 'systems_packet'
        : latestFinishSteward
          ? 'steward'
          : latestFinishTurn
            ? 'gm'
            : 'unknown';
  return {
    invoked: Boolean(turn.narration),
    style: readString(asRecord(findDebugEvent(turn, 'narrator.started')), 'style') || null,
    source,
    text: turn.narration || '',
  };
}

function buildStateDeltaReport(before: Telemetry, after: Telemetry, acceptedEvents: WorldEvent[]): StateDeltaReport {
  const diff = computeTurnDiff(before, after, acceptedEvents);
  return {
    summary: diff.summary,
    timeDeltaMinutes: diff.timeDeltaMinutes,
    moved: diff.moved,
    newLocationName: diff.newLocationName,
    newItems: diff.newItems,
    newClues: diff.newClues,
    acceptedEvents: diff.events,
    before,
    after,
  };
}

function buildUnavailableStateDelta(acceptedEvents: WorldEvent[]): StateDeltaReport {
  return {
    summary: acceptedEvents.length
      ? 'State changed, but the persisted telemetry was not detailed enough to explain the delta cleanly.'
      : 'No state delta was available from the persisted telemetry.',
    timeDeltaMinutes: 0,
    moved: false,
    newItems: [],
    newClues: [],
    acceptedEvents,
    before: undefined as unknown as Telemetry,
    after: undefined as unknown as Telemetry,
  };
}

function summarizeRunExplanation(turns: LastRunExplainTurn[]): string {
  if (!turns.length) return 'No persisted turns were available to explain.';
  const ownerCounts = new Map<string, number>();
  for (const turn of turns) {
    ownerCounts.set(turn.ownerLabel, (ownerCounts.get(turn.ownerLabel) || 0) + 1);
  }
  const dominantOwner = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown owner';
  const fallbackTurns = turns.filter(turn => turn.fallbackUsed).length;
  if (fallbackTurns) {
    return `This run covered ${turns.length} persisted turn${turns.length === 1 ? '' : 's'}. Most turns were ${dominantOwner}, and ${fallbackTurns} turn${fallbackTurns === 1 ? '' : 's'} had to fall back to the legacy GM.`;
  }
  return `This run covered ${turns.length} persisted turn${turns.length === 1 ? '' : 's'}. Most turns were ${dominantOwner}, and none needed the legacy GM fallback.`;
}

function describeTurnOwner(route: TurnRouteSummary): string {
  if (route.classification === 'deterministic') {
    return route.deterministicOwner
      ? `Deterministic ${route.deterministicOwner} logic owned this turn, so Chronicle did not need open-ended judgment.`
      : 'Deterministic logic owned this turn, so Chronicle did not need open-ended judgment.';
  }
  if (route.gmHandled) {
    return 'The steward could not close this turn on its own, so the legacy GM took over the final decision.';
  }
  if (route.councilDomains.length) {
    return `The steward owned routing, then handed judgment to ${formatNaturalList(route.councilDomains.map(domain => `${domain} council`))}.`;
  }
  if (route.stewardHandled) {
    return 'The steward handled this turn directly without needing the legacy GM.';
  }
  return 'Chronicle recorded the turn, but the owning subsystem was not obvious from the persisted trace.';
}

function describeMajorDecisions(
  turn: TurnRecord,
  route: TurnRouteSummary,
  decision: DecisionSummary,
  council: CouncilInspection,
): string[] {
  const notes: string[] = [];

  if (route.rationale) {
    notes.push(`Route reason: ${route.rationale}`);
  }

  if (route.councilDomains.length) {
    notes.push(`Council involvement: ${formatNaturalList(route.councilDomains)} weighed in on this turn.`);
  }

  for (const artifact of decision.councilArtifacts) {
    notes.push(`${capitalize(artifact.domain)} direction: ${artifact.summary}`);
  }

  if (decision.acceptedEvents.length) {
    notes.push(`Committed outcomes: ${formatNaturalList(decision.acceptedEvents.slice(0, 4).map(describeWorldEvent))}.`);
  }

  if (decision.rejectedEvents.length) {
    notes.push(`Rejected outcomes: ${formatNaturalList(decision.rejectedEvents.slice(0, 3).map(event => describeRejectedEvent(event.reason, event.event)))}.`);
  }

  const councilWarnings = council.domains.flatMap(domain =>
    domain.warnings.map(warning => `${domain.domain}: ${warning}`),
  );
  if (councilWarnings.length) {
    notes.push(`Warnings carried forward: ${formatNaturalList(councilWarnings.slice(0, 3))}.`);
  }

  if (!notes.length) {
    notes.push(turn.narration
      ? 'The main visible outcome was the narrated reply.'
      : 'Chronicle recorded the turn, but no major decision summary was persisted.');
  }

  return notes;
}

function describeFallback(
  gmFallback: GmFallbackSummary | null,
  route: TurnRouteSummary,
): string {
  if (!gmFallback) {
    return 'No legacy GM fallback was needed.';
  }
  const reason = gmFallback.reason || route.fallbackReason || 'Chronicle did not persist a fallback reason';
  const summary = gmFallback.summary ? ` Result: ${gmFallback.summary}` : '';
  return `Legacy GM fallback was used because ${reason}.${summary}`.trim();
}

function describeNarrationOutcome(narration: NarrationSummary): string {
  if (!narration.invoked || !narration.text.trim()) {
    return 'No player-facing narration was persisted for this turn.';
  }
  const source = narration.source === 'systems_packet'
    ? 'the systems packet'
    : narration.source === 'steward'
      ? 'the steward close path'
      : narration.source === 'gm'
        ? 'the legacy GM close path'
        : narration.source === 'prompt_only'
          ? 'a pending prompt'
          : 'an unknown source';
  const preview = summarizeText(narration.text, 140) || 'Narration was persisted.';
  return `The player received narration from ${source}. Preview: ${preview}`;
}

function describeWorldEvent(event: WorldEvent): string {
  switch (event.type) {
    case 'Speak':
      return event.toActorId
        ? `${event.actorId} spoke to ${event.toActorId}`
        : `${event.actorId} spoke aloud`;
    case 'RecordClue':
      return event.subject ? `a clue was recorded about ${event.subject}` : 'a clue was recorded';
    case 'SetFlag':
      return `${event.key} was updated`;
    case 'CreateEntity':
      return `${event.entity.data.name} was introduced`;
    case 'TravelToLocation':
      return `travel moved to ${event.locationId}`;
    case 'MoveActor':
      return event.toLocationId ? `movement shifted to ${event.toLocationId}` : 'an actor moved';
    case 'AdvanceTime':
      return `${event.minutes} minute${event.minutes === 1 ? '' : 's'} passed`;
    case 'Inspect':
      return `${event.subject} was inspected`;
    case 'Explore':
      return `the player explored ${event.area.replaceAll('_', ' ')}`;
    default:
      return event.type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  }
}

function describeRejectedEvent(reason: string, event: WorldEvent): string {
  return `${describeWorldEvent(event)} was rejected (${reason})`;
}

function formatNaturalList(values: string[]): string {
  const cleaned = values.map(value => value.trim()).filter(Boolean);
  if (!cleaned.length) return 'nothing explicit';
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`;
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function buildTraceTimeline(turn: TurnRecord, debugEvents: DebugEvent[] = []): TraceTimelineEvent[] {
  if (debugEvents.length) {
    return debugEvents.map((event, index) => ({
      index,
      phase: phaseForDebugEvent(event),
      kind: event.type,
      label: event.type,
      summary: summarizeDebugEvent(event),
      data: event,
    }));
  }

  const timeline: TraceTimelineEvent[] = [];
  const trace = turn.trace;
  if (!trace) return timeline;

  for (const [index, call] of trace.toolCalls.entries()) {
    timeline.push({
      index,
      phase: phaseForTool(call.tool, call.stage),
      kind: call.tool,
      label: call.tool,
      summary: summarizeToolCall(call),
      data: {
        input: call.input,
        output: call.output,
        callId: call.callId,
        iteration: call.iteration,
        executionMs: call.executionMs,
      },
    });
  }

  if (trace.llmCalls?.length) {
    for (const [offset, llmCall] of trace.llmCalls.entries()) {
      timeline.push({
        index: timeline.length + offset,
        phase: 'llm',
        kind: 'llm_call',
        label: `${llmCall.agent}`,
        summary: summarizeLLMCall(llmCall),
        data: llmCall,
      });
    }
  }

  return timeline;
}

function phaseForDebugEvent(event: DebugEvent): string {
  switch (event.type) {
    case 'turn.started':
      return 'input';
    case 'steward.iteration.started':
    case 'steward.response.received':
      return 'steward';
    case 'gm.iteration.started':
    case 'gm.response.received':
      return 'gm_fallback';
    case 'tool.called':
    case 'tool.result':
      return phaseForTool(event.tool);
    case 'narrator.started':
    case 'narrator.completed':
      return 'narration';
    case 'turn.persisted':
      return 'persistence';
    case 'event.accepted':
    case 'event.rejected':
    case 'event.rollback':
      return 'decision';
    case 'error':
      return 'error';
    default:
      return 'runtime';
  }
}

function phaseForTool(tool: string, stage?: string): string {
  if (stage) return stage;
  if (tool === 'open_steward_turn') return 'classification';
  if (tool === 'close_steward_turn' || tool === 'finish_steward_turn' || tool === 'finish_turn') return 'decision';
  if (tool === 'dispatch_council_task' || tool.startsWith('dispatch_')) return 'council';
  if (tool === 'legacy_council_fallback') return 'gm_fallback';
  if (tool === 'persist_turn_record') return 'persistence';
  return 'runtime';
}

function summarizeDebugEvent(event: DebugEvent): string {
  switch (event.type) {
    case 'turn.started':
      return `turn ${event.turn} started for "${event.playerText}"`;
    case 'steward.iteration.started':
      return `steward iteration ${event.iteration} started`;
    case 'steward.response.received':
      return `steward iteration ${event.iteration} returned ${event.toolCallCount} tool call(s)`;
    case 'gm.iteration.started':
      return `GM iteration ${event.iteration} started`;
    case 'gm.response.received':
      return `GM iteration ${event.iteration} returned ${event.toolCallCount} tool call(s)`;
    case 'tool.called':
      return `${event.tool} called`;
    case 'tool.result':
      return `${event.tool} returned ${event.ok === false ? 'error' : 'result'}`;
    case 'narrator.started':
      return `narrator started (${event.phase})`;
    case 'narrator.completed':
      return `narrator completed (${event.phase})`;
    case 'turn.persisted':
      return `turn ${event.turn} persisted`;
    case 'event.accepted':
      return `accepted ${event.event.type}`;
    case 'event.rejected':
      return `rejected ${event.event.type}: ${event.reason}`;
    case 'event.rollback':
      return `rolled back ${event.events.length} event(s): ${event.reason}`;
    case 'error':
      return `${event.stage}: ${event.message}`;
    default:
      return event.type;
  }
}

function summarizeToolCall(call: TurnTraceToolCall): string {
  switch (call.tool) {
    case 'open_steward_turn': {
      const output = asRecord(call.output);
      return [
        readString(output, 'classification'),
        readString(output, 'rationale'),
      ].filter(Boolean).join(' | ') || 'opened steward turn';
    }
    case 'dispatch_council_task': {
      const input = asRecord(call.input);
      const output = asRecord(call.output);
      return `${readString(input, 'domain') || 'council'}: ${readString(output, 'summary') || 'no summary'}`;
    }
    case 'close_steward_turn': {
      const output = asRecord(call.output);
      return `${readString(output, 'route') || 'close'} | proposed=${readNumber(output, 'proposedEventCount') || 0}`;
    }
    case 'legacy_council_fallback': {
      const input = asRecord(call.input);
      const output = asRecord(call.output);
      return `${readString(input, 'reason') || 'fallback'} | ${readString(output, 'summary') || 'legacy GM'}`;
    }
    case 'finish_steward_turn':
      return 'steward finalized the turn';
    case 'finish_turn':
      return 'legacy GM finalized the turn';
    case 'persist_turn_record':
      return 'turn record persisted';
    default:
      return call.tool;
  }
}

function summarizeLLMCall(call: { agent: string; toolCalls?: number; status?: string }): string {
  const toolCalls = typeof call.toolCalls === 'number' ? call.toolCalls : 0;
  const status = call.status || 'unknown';
  return `${call.agent} response status=${status} toolCalls=${toolCalls}`;
}

function describeContext(context: unknown): string | null {
  const record = asRecord(context);
  if (!record) return null;
  const fragments: string[] = [];
  const intent = readString(record, 'intent');
  if (intent) fragments.push(`intent=${intent}`);
  const executionMode = readString(record, 'executionMode');
  if (executionMode) fragments.push(`mode=${executionMode}`);
  const playerText = readString(record, 'playerText');
  if (playerText) fragments.push(`playerText=${summarizeText(playerText, 48)}`);
  const pendingPrompt = getNestedRecord(record, 'pendingPrompt');
  if (pendingPrompt) fragments.push(`pendingPrompt=${readString(pendingPrompt, 'kind') || 'active'}`);
  if (!fragments.length) {
    fragments.push(`keys=${Object.keys(record).slice(0, 6).join(', ')}`);
  }
  return fragments.join(' | ');
}

function normalizePlayerText(playerText: string): string | null {
  const trimmed = playerText.trim();
  return trimmed === playerText ? null : trimmed;
}

function isRecoverableLLMError(error: unknown): boolean {
  if (isChronicleError(error)) return false;
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { status?: unknown; code?: unknown; type?: unknown; name?: unknown };
  if (maybe.code === 'insufficient_quota') return true;
  if (maybe.type === 'insufficient_quota') return true;
  if (typeof maybe.status === 'number' && [401, 402, 403, 429, 500, 502, 503, 504].includes(maybe.status)) return true;
  if (typeof maybe.name === 'string' && maybe.name.endsWith('Error') && typeof maybe.status === 'number') return true;
  return false;
}

async function initSessionWithFallback(params: {
  engine: TurnEngine;
  sessionId?: string;
  worldId?: string;
  apiKey?: string;
  apiMode: CliApiMode;
  onDebugEvent?: (event: DebugEvent) => void;
}): Promise<{ result: InitResult; usedFallback: boolean }> {
  if (params.apiMode === 'fallback' || !params.apiKey) {
    return {
      result: await params.engine.initSession({
        sessionId: params.sessionId,
        worldId: params.worldId,
        debug: {
          onEvent: params.onDebugEvent,
        },
      }),
      usedFallback: false,
    };
  }

  try {
    return {
      result: await params.engine.initSession({
        sessionId: params.sessionId,
        worldId: params.worldId,
        apiKey: params.apiKey,
        debug: {
          onEvent: params.onDebugEvent,
        },
      }),
      usedFallback: false,
    };
  } catch (error) {
    if (params.apiMode !== 'auto' || !isRecoverableLLMError(error)) throw error;
    return {
      result: await params.engine.initSession({
        sessionId: params.sessionId,
        worldId: params.worldId,
        debug: {
          onEvent: params.onDebugEvent,
        },
      }),
      usedFallback: true,
    };
  }
}

async function runTurnWithFallback(params: {
  engine: TurnEngine;
  sessionId: string;
  playerId: string;
  playerText: string;
  apiKey?: string;
  apiMode: CliApiMode;
  gmReasoningEffort?: GMReasoningEffort;
  narratorStyle?: NarratorStyle;
  onDebugEvent?: (event: DebugEvent) => void;
}): Promise<{ result: Awaited<ReturnType<TurnEngine['runTurn']>>; usedFallback: boolean }> {
  const payload = {
    sessionId: params.sessionId,
    playerId: params.playerId,
    playerText: params.playerText,
    gmReasoningEffort: params.gmReasoningEffort,
    narratorStyle: params.narratorStyle,
    debug: {
      includeTrace: true,
      onEvent: params.onDebugEvent,
    },
  } as const;

  if (params.apiMode === 'fallback' || !params.apiKey) {
    return { result: await params.engine.runTurn(payload), usedFallback: false };
  }

  try {
    return { result: await params.engine.runTurn({ ...payload, apiKey: params.apiKey }), usedFallback: false };
  } catch (error) {
    if (params.apiMode !== 'auto' || !isRecoverableLLMError(error)) throw error;
    return { result: await params.engine.runTurn(payload), usedFallback: true };
  }
}

function getToolCalls(trace?: TurnTrace | null, tool?: string): TurnTraceToolCall[] {
  if (!trace?.toolCalls?.length) return [];
  return tool ? trace.toolCalls.filter(call => call.tool === tool) : trace.toolCalls;
}

function getLastToolCall(trace?: TurnTrace | null, tool?: string): TurnTraceToolCall | undefined {
  const calls = getToolCalls(trace, tool);
  return calls[calls.length - 1];
}

function getMostInformativeToolCall(trace?: TurnTrace | null, tool?: string): TurnTraceToolCall | undefined {
  const calls = getToolCalls(trace, tool);
  return calls.find(call => typeof readString(asRecord(call.output), 'classification') === 'string') || calls[calls.length - 1];
}

function getLastToolInput(trace: TurnTrace | null | undefined, tool: string): unknown {
  return getLastToolCall(trace, tool)?.input ?? null;
}

function getStewardMemoryUpdate(turn: TurnRecord): unknown {
  const input = asRecord(getLastToolInput(turn.trace, 'finish_steward_turn'));
  return input?.stewardMemoryUpdate || null;
}

function getCouncilResultsVisibleAtClose(turn: TurnRecord): unknown[] {
  const inspectResults = getToolCalls(turn.trace, 'inspect_council_results').map(call => call.output);
  if (inspectResults.length) return inspectResults;
  return getToolCalls(turn.trace, 'dispatch_council_task').map(call => call.output);
}

function isStewardOwned(turn: TurnRecord): boolean {
  const route = buildRouteSummary(turn);
  return route.stewardHandled && !route.gmHandled;
}

function readArray(record: Record<string, unknown> | null | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function readStringArray(
  record: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string[] = [],
): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) return fallback;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function readString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getNestedRecord(record: unknown, key: string): Record<string, unknown> | null {
  return asRecord(asRecord(record)?.[key]);
}

function summarizeText(value: string | undefined, max = 80): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function findDebugEvent(turn: TurnRecord, type: DebugEvent['type']): unknown {
  const trace = turn.trace;
  if (!trace || !Array.isArray((trace as { debugEvents?: unknown[] }).debugEvents)) return null;
  return ((trace as { debugEvents?: Array<{ type?: string }> }).debugEvents || []).find(event => event?.type === type) || null;
}
