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
