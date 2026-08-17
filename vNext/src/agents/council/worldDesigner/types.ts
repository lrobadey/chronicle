import type { RecentTurnDigest } from '../../../engine/session/types';
import type { WorldEvent } from '../../../sim/events';
import type { PendingWorldEvent, ActiveThread, HeldBeat, PendingPrompt } from '../../../sim/state';

export interface WorldDesignerTaskContext {
  playerText: string;
  pendingPrompt: PendingPrompt | null;
  sceneAgenda: {
    currentFocus?: string;
    pressures: string[];
    unresolvedBeats: string[];
    immediateTensions: string[];
  };
  worldAgenda: {
    activeThreads: string[];
    introductionOpportunities: string[];
    escalationHooks: string[];
  };
  activeThreads: ActiveThread[];
  heldBeats: HeldBeat[];
  pendingWorldEvents: PendingWorldEvent[];
  worldSnapshot: unknown;
  recentTurns: RecentTurnDigest[];
}

/**
 * Lean seed for the World Designer agent prompt.
 *
 * Design rule: IDs + short one-line hooks only. No full entity dumps, no
 * snapshot blobs, no full transcripts. The agent pulls full detail via
 * inspect_* tools on demand.
 */
export interface WorldDesignerTaskBrief {
  taskId: string;
  playerText: string;
  pendingPrompt: { id: string; kind: string; question: string } | null;
  scene: {
    focus: string | null;
    pressureCount: number;
    topPressures: string[];
    topTensions: string[];
    unresolvedBeatCount: number;
  };
  world: {
    activeThreadHints: string[];
    introductionOpportunities: string[];
    escalationHooks: string[];
  };
  activeThreadIds: Array<{ id: string; name: string; pressure: number; status: ActiveThread['status'] }>;
  heldBeatIds: Array<{ id: string; note: string }>;
  pendingWorldEventIds: Array<{ id: string; summary: string; pressure: number | null }>;
  recentTurnHeadlines: Array<{ turn: number; headline: string }>;
  totals: {
    activeThreads: number;
    heldBeats: number;
    pendingWorldEvents: number;
    recentTurns: number;
  };
}

const MAX_TEXT = 140;

function clip(value: string | undefined | null, max = MAX_TEXT): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function buildWorldDesignerBrief(
  taskId: string,
  context: WorldDesignerTaskContext,
): WorldDesignerTaskBrief {
  return {
    taskId,
    playerText: clip(context.playerText, 400),
    pendingPrompt: context.pendingPrompt
      ? {
          id: context.pendingPrompt.id,
          kind: context.pendingPrompt.kind,
          question: clip(context.pendingPrompt.question),
        }
      : null,
    scene: {
      focus: context.sceneAgenda.currentFocus ? clip(context.sceneAgenda.currentFocus) : null,
      pressureCount: context.sceneAgenda.pressures.length,
      topPressures: context.sceneAgenda.pressures.slice(0, 3).map(p => clip(p)),
      topTensions: context.sceneAgenda.immediateTensions.slice(0, 3).map(t => clip(t)),
      unresolvedBeatCount: context.sceneAgenda.unresolvedBeats.length,
    },
    world: {
      activeThreadHints: context.worldAgenda.activeThreads.slice(0, 4).map(t => clip(t)),
      introductionOpportunities: context.worldAgenda.introductionOpportunities.slice(0, 3).map(h => clip(h)),
      escalationHooks: context.worldAgenda.escalationHooks.slice(0, 3).map(h => clip(h)),
    },
    activeThreadIds: context.activeThreads.slice(0, 6).map(t => ({
      id: t.id,
      name: clip(t.name, 80),
      pressure: t.pressure,
      status: t.status,
    })),
    heldBeatIds: context.heldBeats.slice(0, 4).map(b => ({ id: b.id, note: clip(b.note) })),
    pendingWorldEventIds: context.pendingWorldEvents.slice(0, 6).map(e => ({
      id: e.id,
      summary: clip(e.summary),
      pressure: typeof e.pressure === 'number' ? e.pressure : null,
    })),
    recentTurnHeadlines: context.recentTurns.slice(-3).map(turn => ({
      turn: turn.turn,
      headline: clip(turn.playerText || turn.narration || '', 120),
    })),
    totals: {
      activeThreads: context.activeThreads.length,
      heldBeats: context.heldBeats.length,
      pendingWorldEvents: context.pendingWorldEvents.length,
      recentTurns: context.recentTurns.length,
    },
  };
}

export interface WorldDesignerResultDetail {
  sceneMotionNotes: string[];
  worldMotionNotes: string[];
  surfacedThreadIds: string[];
  surfacedPendingEventIds: string[];
  artifacts: Array<{
    type: 'scene_motion' | 'world_motion';
    summary: string;
    candidateEvents: WorldEvent[];
  }>;
}

export interface WorldDesignerArtifact {
  domain: 'world';
  summary: string;
  sceneMotionNotes: string[];
  worldMotionNotes: string[];
  surfacedThreadIds: string[];
  surfacedPendingEventIds: string[];
}

export interface WorldDraftResult {
  summary: string;
  candidateEvents: WorldEvent[];
}

export interface WorldCouncilToolRuntime {
  inspect_world_scene(input: { question?: string | null }): Promise<unknown>;
  inspect_world_pressure(input: { includeThreads?: boolean | null }): Promise<unknown>;
  inspect_world_threads(input: { limit?: number | null }): Promise<unknown>;
  inspect_held_beats(input: { limit?: number | null }): Promise<unknown>;
  inspect_pending_world_events(input: { pressureFloor?: number | null }): Promise<unknown>;
  worker_draft_scene_motion(input: { focus?: string | null }): Promise<WorldDraftResult>;
  worker_draft_world_motion(input: { focus?: string | null }): Promise<WorldDraftResult>;
  worker_draft_world_events(input: {
    sceneSummary?: string | null;
    worldSummary?: string | null;
    sceneCandidateEvents?: WorldEvent[] | null;
    worldCandidateEvents?: WorldEvent[] | null;
  }): Promise<{ candidateEvents: WorldEvent[] }>;
  emit_world_result(input: {
    summary: string;
    candidateEvents: WorldEvent[];
    sceneMotionNotes: string[];
    worldMotionNotes: string[];
    surfacedThreadIds: string[];
    surfacedPendingEventIds: string[];
    artifacts?: Array<{
      type: 'scene_motion' | 'world_motion';
      summary: string;
      candidateEvents: WorldEvent[];
    }> | null;
    warnings?: string[] | null;
  }): Promise<unknown>;
}
