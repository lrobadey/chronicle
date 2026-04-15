import type { WorldEvent } from '../sim/events';
import type { RejectedEventRecord } from './session/types';

export type DebugSink = (event: DebugEvent) => void;

export type DebugEvent =
  | { type: 'init.started'; sessionId?: string }
  | { type: 'init.session_ready'; sessionId: string; created: boolean }
  | { type: 'turn.started'; sessionId: string; turn: number; playerText: string }
  | { type: 'steward.iteration.started'; iteration: number }
  | {
      type: 'steward.response.received';
      iteration: number;
      toolCalls: number;
      toolCallCount: number;
      toolCallNames: string[];
      status?: string;
      responseId?: string;
      error?: unknown;
    }
  | { type: 'gm.iteration.started'; iteration: number }
  | {
      type: 'gm.response.received';
      iteration: number;
      toolCalls: number;
      toolCallCount: number;
      toolCallNames: string[];
      status?: string;
      responseId?: string;
      error?: unknown;
    }
  | {
      type: 'tool.called';
      iteration: number;
      tool: string;
      callId: string;
      callIndex: number;
      callCount: number;
      input: unknown;
    }
  | {
      type: 'tool.result';
      iteration: number;
      tool: string;
      callId: string;
      callIndex: number;
      callCount: number;
      output: unknown;
      ok?: boolean;
    }
  | { type: 'event.accepted'; event: WorldEvent }
  | ({ type: 'event.rejected' } & RejectedEventRecord)
  | { type: 'event.rollback'; events: WorldEvent[]; reason: string }
  | { type: 'npc.started'; npcId: string }
  | { type: 'npc.completed'; npcId: string; output: unknown }
  | { type: 'specialist.started'; specialistType: 'scene' | 'world'; question: string; focus?: string }
  | { type: 'specialist.completed'; specialistType: 'scene' | 'world'; output: unknown }
  | { type: 'narrator.started'; phase: 'opening' | 'turn'; style?: string }
  | { type: 'narrator.completed'; phase: 'opening' | 'turn'; text?: string }
  | { type: 'turn.persisted'; sessionId: string; turn: number }
  | { type: 'error'; stage: string; message: string };

export function emitDebugEvent(sink: DebugSink | undefined, event: DebugEvent) {
  if (!sink) return;
  try {
    sink(event);
  } catch {
    // Debug output must never affect runtime behavior.
  }
}
