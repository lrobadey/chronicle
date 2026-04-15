import type { PendingPrompt, WorldState } from '../../sim/state';
import type { WorldEvent } from '../../sim/events';
import type { Telemetry } from '../../sim/views/telemetry';
import type { NpcAgentOutput } from '../../agents/npc/npcAgent';
import type { MechanicsDebugRecord, MechanicsResolution } from '../../agents/mechanics';
import type { SpecialistConsultation, SpecialistType } from '../../agents/specialists';

export interface TurnSpeechRecord {
  speakerActorId: string;
  speakerName: string;
  text: string;
  recipientActorIds: string[];
  recipientNames: string[];
  source?: 'speak_event' | 'npc_consult';
}

export interface RejectedEventRecord {
  event: WorldEvent;
  reason: string;
  details?: unknown;
}

export interface RecentTurnDigest {
  turn: number;
  playerText: string;
  narration: string | null;
  accepted: string[];
  rejected: string[];
}

export interface WebTurnSummary {
  headline: string;
  accepted: string[];
  rejected: string[];
  outcome: 'progress' | 'blocked' | 'quiet';
}

export interface WebTurnCard {
  turn: number;
  atIso: string;
  playerText: string;
  narration: string;
  summary: WebTurnSummary;
  telemetry?: Telemetry;
  trace?: TurnTrace;
}

export interface WebHistorySummary {
  fromTurn: number;
  toTurn: number;
  turnCount: number;
  headline: string;
  highlights: string[];
}

export interface WebTranscriptHistory {
  totalTurns: number;
  recentTurns: WebTurnCard[];
  olderSummary?: WebHistorySummary;
}

export interface TurnRecord {
  sessionId: string;
  turn: number;
  atIso: string;
  playerId: string;
  playerText: string;
  pendingPrompt?: PendingPrompt;
  acceptedEvents: WorldEvent[];
  rejectedEvents: RejectedEventRecord[];
  npcOutputs?: NpcAgentOutput[];
  turnSpeech?: TurnSpeechRecord[];
  specialistOutputs?: SpecialistConsultation[];
  narration?: string;
  telemetry?: Telemetry;
  trace?: TurnTrace;
}

export interface TurnTrace {
  toolCalls: Array<{ tool: string; input: unknown; output: unknown }>;
  mechanicsResolutions?: MechanicsResolution[];
  mechanicsDebug?: MechanicsDebugRecord[];
  specialistOutputs?: SpecialistConsultation[];
  llmCalls?: Array<{
    agent: 'gm' | 'npc' | 'narrator' | 'specialist' | 'mechanics' | 'schedule';
    responseId?: string;
    previousResponseId?: string;
    inputItems?: number;
    outputItems?: number;
    toolCalls?: number;
    usage?: unknown;
    status?: string;
    error?: unknown;
    specialistType?: SpecialistType;
  }>;
  llmMessages?: Array<{ role: string; content?: string }>;
}

export interface SessionStore {
  ensureSession(
    sessionId: string | undefined,
    options: {
      worldId?: string;
      createWorld: (worldId?: string) => WorldState;
    },
  ): Promise<{ sessionId: string; created: boolean; state: WorldState }>;
  loadSession(sessionId: string): Promise<WorldState | null>;
  loadTurnLog(sessionId: string): Promise<TurnRecord[]>;
  saveInitialState(sessionId: string, state: WorldState): Promise<void>;
  saveSnapshot(sessionId: string, state: WorldState): Promise<void>;
  appendTurn(sessionId: string, record: TurnRecord): Promise<void>;
}
