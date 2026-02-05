import type { WorldState } from '../../sim/state';
import type { WorldEvent } from '../../sim/events';
import type { Telemetry } from '../../sim/views/telemetry';
import type { NpcAgentOutput } from '../../agents/npc/npcAgent';

export interface TurnRecord {
  sessionId: string;
  turn: number;
  atIso: string;
  playerId: string;
  playerText: string;
  acceptedEvents: WorldEvent[];
  rejectedEvents: Array<{ event: WorldEvent; reason: string }>;
  npcOutputs?: NpcAgentOutput[];
  narration?: string;
  telemetry?: Telemetry;
  trace?: TurnTrace;
}

export interface TurnTrace {
  toolCalls: Array<{ tool: string; input: unknown; output: unknown }>;
  llmCalls?: Array<{
    agent: 'gm' | 'npc' | 'narrator';
    responseId?: string;
    previousResponseId?: string;
    inputItems?: number;
    outputItems?: number;
    toolCalls?: number;
    usage?: unknown;
    status?: string;
    error?: unknown;
  }>;
  llmMessages?: Array<{ role: string; content?: string }>;
}

export interface SessionStore {
  ensureSession(sessionId: string | undefined, worldFactory: () => WorldState): Promise<{ sessionId: string; created: boolean; state: WorldState }>;
  loadSession(sessionId: string): Promise<WorldState | null>;
  saveSnapshot(sessionId: string, state: WorldState): Promise<void>;
  appendTurn(sessionId: string, record: TurnRecord): Promise<void>;
}
