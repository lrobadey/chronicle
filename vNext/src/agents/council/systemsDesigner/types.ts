import type { MechanicsResolution, MechanicsWorkerRequest } from '../../../agents/mechanics';
import type { ScheduleResolution } from '../../../agents/schedule/types';
import type { PendingPrompt } from '../../../sim/state';
import type { Observation } from '../../../sim/views/observe';
import type { Telemetry } from '../../../sim/views/telemetry';
import type { WorldEvent } from '../../../sim/events';

export type SystemsTurnIntent = 'observation' | 'cardinal_movement' | 'general_systems';

export interface SystemsNarratorPacket {
  version: 'systems_v1';
  intent: SystemsTurnIntent;
  playerText: string;
  summary: string;
  warnings: string[];
}

export interface SystemsDesignerTaskContext {
  intent: SystemsTurnIntent;
  executionMode?: 'full_agent' | 'direct_mechanics';
  playerText: string;
  telemetry: Telemetry;
  observation: Observation;
  pendingPrompt: PendingPrompt | null;
  nearby: {
    actors: unknown[];
    itemsOnGround: unknown[];
  };
  travelCandidates: Array<{
    id: string;
    name: string;
    aliases?: string[];
    distanceMeters: number;
    estimatedWalkMinutes: number;
    blockedNow: boolean;
    requiresConfirm: boolean;
  }>;
  landmarks: unknown[];
  localAffordances: NonNullable<MechanicsWorkerRequest['localAffordances']>;
  mechanicsRequest?: MechanicsWorkerRequest | null;
}

/**
 * Lean seed for the Systems Designer agent prompt.
 *
 * Design rule: IDs + short one-line hooks. Full telemetry, full observations,
 * and the full mechanics request are NOT in the seed; the agent pulls them via
 * inspect_systems_scene / inspect_local_affordances / inspect_pending_prompt.
 */
export interface SystemsDesignerTaskBrief {
  taskId: string;
  intent: SystemsTurnIntent;
  executionMode: 'full_agent' | 'direct_mechanics';
  playerText: string;
  pendingPrompt: { id: string; kind: string; question: string } | null;
  location: { id: string | null; name: string | null };
  travelCandidateIds: Array<{
    id: string;
    name: string;
    distanceMeters: number;
    blockedNow: boolean;
    requiresConfirm: boolean;
  }>;
  landmarkCount: number;
  nearby: {
    actorCount: number;
    itemsOnGroundCount: number;
  };
  affordanceHints: {
    verbs: string[];
  };
  hasMechanicsRequest: boolean;
}

const SD_MAX_TEXT = 140;

function sdClip(value: string | undefined | null, max = SD_MAX_TEXT): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function buildSystemsDesignerBrief(
  taskId: string,
  context: SystemsDesignerTaskContext,
): SystemsDesignerTaskBrief {
  const telemetry = context.telemetry as { location?: { id?: string | null; name?: string | null } } | undefined;
  const location = telemetry?.location || {};
  const verbs = Object.keys(context.localAffordances || {}).slice(0, 8);
  return {
    taskId,
    intent: context.intent,
    executionMode: context.executionMode ?? 'full_agent',
    playerText: sdClip(context.playerText, 400),
    pendingPrompt: context.pendingPrompt
      ? {
          id: context.pendingPrompt.id,
          kind: context.pendingPrompt.kind,
          question: sdClip(context.pendingPrompt.question),
        }
      : null,
    location: {
      id: location.id ?? null,
      name: location.name ? sdClip(location.name, 80) : null,
    },
    travelCandidateIds: context.travelCandidates.slice(0, 6).map(t => ({
      id: t.id,
      name: sdClip(t.name, 80),
      distanceMeters: t.distanceMeters,
      blockedNow: t.blockedNow,
      requiresConfirm: t.requiresConfirm,
    })),
    landmarkCount: context.landmarks.length,
    nearby: {
      actorCount: context.nearby.actors.length,
      itemsOnGroundCount: context.nearby.itemsOnGround.length,
    },
    affordanceHints: { verbs },
    hasMechanicsRequest: Boolean(context.mechanicsRequest),
  };
}

export interface SystemsDesignerResultDetail {
  handled: boolean;
  fallbackReason?: string;
  narratorPacket?: SystemsNarratorPacket | null;
  mechanicsResolution?: MechanicsResolution | null;
  scheduleResolution?: ScheduleResolution | null;
  pendingPromptRecommendation?: PendingPrompt | null;
  artifacts: Array<{
    type: 'mechanics' | 'schedule' | 'inspection';
    summary: string;
    candidateEvents: WorldEvent[];
  }>;
}

export interface SystemsDesignerArtifact {
  domain: 'systems';
  summary: string;
  narratorPacket?: SystemsNarratorPacket | null;
  pendingPromptRecommendation?: PendingPrompt | null;
}

export interface SystemsCouncilToolRuntime {
  inspect_systems_scene(input: { question?: string | null }): Promise<unknown>;
  inspect_local_affordances(input: { focus?: string | null }): Promise<unknown>;
  inspect_pending_prompt(input: Record<string, never>): Promise<unknown>;
  resolve_mechanics(input: {
    playerText?: string | null;
    objective?: string | null;
    focus?: string | null;
    pendingPrompt?: PendingPrompt | null;
  }): Promise<unknown>;
  review_mechanics_resolution(input: {
    resolutionId: string;
    action: 'approve' | 'revise' | 'reject';
    feedback?: string | null;
  }): Promise<unknown>;
  schedule_task(input: { task: string; actorId?: string | null; timeHint?: string | null }): Promise<unknown>;
  review_schedule_resolution(input: {
    scheduleResolutionId: string;
    action: 'approve' | 'revise' | 'reject';
    feedback?: string | null;
  }): Promise<unknown>;
  emit_systems_result(input: {
    summary: string;
    candidateEvents: WorldEvent[];
    narratorPacket?: SystemsNarratorPacket | null;
    pendingPromptRecommendation?: PendingPrompt | null;
    warnings?: string[] | null;
    handled?: boolean | null;
    fallbackReason?: string | null;
    artifacts?: Array<{
      type: 'mechanics' | 'schedule' | 'inspection';
      summary: string;
      candidateEvents: WorldEvent[];
    }> | null;
  }): Promise<unknown>;
}
