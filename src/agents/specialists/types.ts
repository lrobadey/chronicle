import type { WorldEvent } from '../../sim/events';
import type { WorldAgenda, SceneAgenda } from '../../sim/state';

export type SpecialistType = 'scene' | 'world';

export interface SpecialistCreationIntent {
  kind: 'npc' | 'item' | 'location';
  purpose: string;
}

export interface SpecialistAgentOutput {
  specialistType: SpecialistType;
  summary: string;
  recommendations: string[];
  candidateEvents: WorldEvent[];
  creationIntent?: SpecialistCreationIntent | null;
  risks?: string[];
}

export interface SpecialistConsultation {
  specialistType: SpecialistType;
  question: string;
  focus?: string;
  output: SpecialistAgentOutput;
  usedSuggestion: boolean;
  usedCandidateEvents: WorldEvent[];
}

export interface SceneSpecialistContext {
  agendas: SceneAgenda;
  pendingPrompt: unknown;
  telemetry: unknown;
  observation: unknown;
  playerText: string;
  transcriptTail: Array<{ turn: number; playerId: string; playerText: string }>;
}

export interface WorldSpecialistContext {
  agendas: WorldAgenda;
  pendingPrompt: unknown;
  telemetry: unknown;
  worldSnapshot: unknown;
  playerText: string;
  transcriptTail: Array<{ turn: number; playerId: string; playerText: string }>;
}

export type SpecialistContext = SceneSpecialistContext | WorldSpecialistContext;
