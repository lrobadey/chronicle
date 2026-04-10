import type { MechanicsResolution, MechanicsWorkerRequest } from '../../../agents/mechanics';
import type { Observation } from '../../../sim/views/observe';
import type { Telemetry } from '../../../sim/views/telemetry';

export type SystemsTurnIntent = 'observation' | 'cardinal_movement';

export interface SystemsNarratorPacket {
  version: 'systems_v1';
  intent: SystemsTurnIntent;
  playerText: string;
  summary: string;
  telemetry: Telemetry;
  observation: Observation;
  warnings: string[];
}

/** Domain-scoped context for the first Systems Designer slice. */
export interface SystemsDesignerTaskContext {
  intent: SystemsTurnIntent;
  playerText: string;
  telemetry: Telemetry;
  observation: Observation;
  mechanicsRequest?: MechanicsWorkerRequest | null;
}

/** Domain-specific detail in the Systems Designer's council result. */
export interface SystemsDesignerResultDetail {
  handled: boolean;
  fallbackReason?: string;
  narratorPacket?: SystemsNarratorPacket | null;
  mechanicsResolution?: MechanicsResolution | null;
}
