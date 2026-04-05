import type { WorldEvent } from '../../sim/events';
import type { WorldAgenda, SceneAgenda } from '../../sim/state';
import type { RecentTurnDigest } from '../../engine/session/types';

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
  recentTurns: RecentTurnDigest[];
}

export interface WorldSpecialistContext {
  agendas: WorldAgenda;
  pendingPrompt: unknown;
  telemetry: unknown;
  worldSnapshot: unknown;
  playerText: string;
  recentTurns: RecentTurnDigest[];
}

export type SpecialistContext = SceneSpecialistContext | WorldSpecialistContext;
