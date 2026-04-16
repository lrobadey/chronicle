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
