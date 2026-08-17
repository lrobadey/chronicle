import type { PendingPrompt, WorldState } from '../../sim/state';
import type { WorldEvent } from '../../sim/events';
import type { Telemetry } from '../../sim/views/telemetry';
import type { NpcAgentOutput } from '../../agents/npc/npcAgent';
import type { MechanicsDebugRecord, MechanicsResolution } from '../../agents/mechanics';
import type { SpecialistConsultation, SpecialistType } from '../../agents/specialists';

export type CouncilArtifactRecord =
  | {
      domain: 'character';
      summary: string;
      selectedNpcIds: string[];
      privateIntentNotes: Array<{ npcId: string; note: string }>;
      publicUtterances: Array<{ npcId: string; text: string; emotionalTone?: string }>;
    }
  | {
      domain: 'world';
      summary: string;
      sceneMotionNotes: string[];
      worldMotionNotes: string[];
      surfacedThreadIds: string[];
      surfacedPendingEventIds: string[];
    }
  | {
      domain: 'systems';
      summary: string;
      narratorPacket?: unknown;
      pendingPromptRecommendation?: PendingPrompt | null;
    };

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
  councilArtifacts?: CouncilArtifactRecord[];
  npcOutputs?: NpcAgentOutput[];
  turnSpeech?: TurnSpeechRecord[];
  specialistOutputs?: SpecialistConsultation[];
  narration?: string;
  telemetry?: Telemetry;
  trace?: TurnTrace;
}

export interface TurnTraceToolCall {
  tool: string;
  input: unknown;
  output: unknown;
  agent?: string;
  iteration?: number;
  callId?: string;
  callIndex?: number;
  callCount?: number;
  stage?: string;
  executionMs?: number;
}

export interface TurnTraceLLMCall {
  agent:
    | 'gm'
    | 'steward'
    | 'legacy_gm'
    | 'observer'
    | 'npc'
    | 'narrator'
    | 'specialist'
    | 'mechanics'
    | 'schedule'
    | 'staff_interview'
    | 'character_designer'
    | 'world_designer'
    | 'systems_designer'
    | 'character_worker'
    | 'world_worker';
  responseId?: string;
  previousResponseId?: string;
  /** Epoch ms when the LLM request was issued (just before the network call). */
  startedAtMs?: number;
  /** Epoch ms when the LLM response returned. */
  endedAtMs?: number;
  /** Wall time of the LLM call in ms (endedAtMs - startedAtMs). */
  durationMs?: number;
  /** Response id of the parent agent call that triggered this one (e.g. a council call that fired a worker). */
  parentResponseId?: string;
  inputItems?: number;
  outputItems?: number;
  toolCalls?: number;
  reasoningHeadings?: string[];
  usage?: unknown;
  status?: string;
  error?: unknown;
  specialistType?: SpecialistType | string;
}

export interface TurnTrace {
  toolCalls: TurnTraceToolCall[];
  councilArtifacts?: CouncilArtifactRecord[];
  mechanicsResolutions?: MechanicsResolution[];
  mechanicsDebug?: MechanicsDebugRecord[];
  specialistOutputs?: SpecialistConsultation[];
  llmCalls?: TurnTraceLLMCall[];
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
  listSessionIds(): Promise<string[]>;
  saveInitialState(sessionId: string, state: WorldState): Promise<void>;
  saveSnapshot(sessionId: string, state: WorldState): Promise<void>;
  appendTurn(sessionId: string, record: TurnRecord): Promise<void>;
}
