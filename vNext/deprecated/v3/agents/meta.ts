import type { TurnTelemetry } from '../state/telemetry';
import type { ProjectPKGOutput } from '../tools/types';

/**
 * Placeholder interfaces for the planned Meta-GM system.
 *
 * The intention is for the primary GM agent to delegate to short-lived
 * specialists that focus on a single domain (e.g., economy, politics,
 * region synthesis). These types document the contract we expect those
 * specialists to follow once implemented.
 */
export interface SpecialistProfile {
  id: string;
  specialization: string;
  context: string;
  prompt: string;
  constraints: string[];
  lifespan: 'ephemeral' | 'persistent';
}

export interface SpecialistPlan {
  turn: number;
  reason: string;
  specialists: SpecialistProfile[];
  openQuestions: string[];
}

/**
 * Drafts (but does not yet execute) a plan for auxiliary specialists.
 * Today this simply records intent so future agents know where to hook in.
 */
export function draftSpecialistPlan(params: {
  telemetry: TurnTelemetry;
  pkg?: ProjectPKGOutput;
  latentHints?: { label: string; dir?: string }[];
}): SpecialistPlan {
  return {
    turn: params.telemetry.turn,
    reason: 'meta-gm not yet implemented',
    specialists: [],
    openQuestions: [
      'Which systems would benefit from a dedicated specialist this turn?',
      'What validation is required for dynamically generated SystemSpecs?',
    ],
  };
}

