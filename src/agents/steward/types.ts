/**
 * Steward (Tier 1) input/output types.
 *
 * The Steward has two jobs per turn: open and close.
 * - Open: read DirectorState, classify action, decompose into council tasks
 * - Close: synthesize council returns, commit changes, update DirectorState
 *
 * The Steward never touches raw world data and never writes narration.
 * It routes, decomposes, and synthesizes.
 */

import type { DirectorState, PendingPrompt, StewardMemory } from '../../sim/state';
import type { WorldEvent } from '../../sim/events';
import type { RejectedEventRecord } from '../../engine/session/types';
import type { StewardContext } from '../../engine/contextBuilders';
import type { GMAgendaUpdates } from '../gm/gmAgent';
import type { GMDirectorUpdates } from '../gm/gmAgent';
import type { CouncilDomain } from '../hierarchy/types';
import type { StewardToCouncilPacket, CouncilToStewardPacket, DirectorUpdates } from '../hierarchy/packets';
import type { TurnPlan } from '../hierarchy/turnPlan';
import type { SystemsNarratorPacket } from '../council';
import type { LLMClient } from '../llm/types';
import type { DebugSink } from '../../engine/debug';

// ---------------------------------------------------------------------------
// Open turn
// ---------------------------------------------------------------------------

/** What the Steward receives at the start of a turn. */
export interface StewardOpenInput {
  playerText: string;
  directorState: DirectorState;
  /** Bounded world context (currently the GMWorldContext shape). */
  worldContext: unknown;
  pendingPrompt: PendingPrompt | null;
  telemetry: unknown;
  turnNumber: number;
}

/** The Steward's opening decision: a routing plan and dispatched council tasks. */
export interface StewardOpenResult {
  turnPlan: TurnPlan;
  councilTasks: StewardToCouncilPacket<CouncilDomain>[];
}

// ---------------------------------------------------------------------------
// Close turn
// ---------------------------------------------------------------------------

/** What the Steward receives after all Council agents have returned. */
export interface StewardCloseInput {
  turnPlan: TurnPlan;
  councilResults: CouncilToStewardPacket<CouncilDomain>[];
  directorState: DirectorState;
}

/** The Steward's closing decision: what to commit, surface, defer, or hold. */
export interface StewardCloseResult {
  handled: boolean;
  fallbackReason?: string;
  summary: string;
  proposedEvents: WorldEvent[];
  acceptedEvents: WorldEvent[];
  rejectedEvents: RejectedEventRecord[];
  agendaUpdates: GMAgendaUpdates;
  directorUpdates: DirectorUpdates;
  narratorHandoff:
    | { kind: 'systems_v1'; packet: SystemsNarratorPacket }
    | { kind: 'legacy'; packet: null };
  trace: {
    route: 'systems_council' | 'fallback_to_gm';
    reason?: string;
    councilDomains: CouncilDomain[];
  };
}

export type StewardReasoningEffort = 'low' | 'medium' | 'high';

export interface StewardMemoryUpdate {
  currentGoals?: string[] | null;
  workingHypotheses?: string[] | null;
  intendedBeats?: string[] | null;
  deferredQuestions?: string[] | null;
  continuityNotes?: string[] | null;
}

export interface LegacyGMProposal {
  summary: string;
  candidateEvents: WorldEvent[];
  pendingPrompt: PendingPrompt | null;
  clearPendingPrompt?: boolean;
  agendaUpdates: GMAgendaUpdates | null;
  directorUpdates: GMDirectorUpdates | null;
  reasoningNotes: string[];
}

export interface StewardFinishTurnInput {
  summary: string;
  candidateEvents?: WorldEvent[] | null;
  playerPrompt?: {
    pending?: PendingPrompt | null;
    clear?: boolean | null;
  } | null;
  agendaUpdates?: GMAgendaUpdates | null;
  directorUpdates?: GMDirectorUpdates | null;
  stewardMemoryUpdate?: StewardMemoryUpdate | null;
}

export interface StewardToolRuntime {
  inspect_world_summary(input: { question?: string | null }): Promise<unknown>;
  inspect_scene_detail(input: { question?: string | null; focus?: string | null }): Promise<unknown>;
  delegate_mechanics(input: {
    playerText?: string | null;
    objective?: string | null;
    focus?: string | null;
    deterministicOnly?: boolean | null;
  }): Promise<unknown>;
  delegate_legacy_gm(input: {
    reason: string;
    focus?: string | null;
    seedToolCall?: {
      name: string;
      arguments: Record<string, unknown>;
    } | null;
  }): Promise<LegacyGMProposal>;
  finish_steward_turn(input: StewardFinishTurnInput): Promise<unknown>;
}

export interface StewardAgentParams {
  apiKey?: string;
  model?: string;
  stewardReasoningEffort?: StewardReasoningEffort;
  playerText: string;
  context: StewardContext;
  runtime: StewardToolRuntime;
  llm: LLMClient;
  maxIterations?: number;
  debug?: DebugSink;
  trace?: {
    toolCalls: Array<{ tool: string; input: unknown; output: unknown }>;
    llmCalls?: Array<{
      agent: 'gm' | 'steward' | 'legacy_gm' | 'observer' | 'npc' | 'narrator' | 'specialist' | 'mechanics' | 'schedule' | 'staff_interview';
      responseId?: string;
      previousResponseId?: string;
      inputItems?: number;
      outputItems?: number;
      toolCalls?: number;
      usage?: unknown;
      status?: string;
      error?: unknown;
    }>;
  };
}
