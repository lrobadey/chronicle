/**
 * Schedule agent types.
 * The schedule agent takes a natural-language task + bounded NPC context
 * and returns structured ScheduleProcess / SetNpcSchedule events for GM review.
 */

export interface ScheduleTaskInput {
  /** Natural language description of what to schedule. */
  task: string;
  /** Primary NPC actor ID, if any. */
  actorId?: string;
  /** Primary NPC display name, for prompt clarity. */
  actorName?: string;
  /** Current world elapsed minutes. */
  currentElapsedMinutes: number;
  /** Human-readable time context for prompt clarity. */
  worldTimeContext: {
    /** e.g. "Day 3, 6:23 AM" */
    clockDisplay: string;
    currentDayIndex: number;
    /** Absolute elapsed-minute values for common time anchors. */
    namedTimepoints: Record<string, number>; // { dawn, noon, dusk, midnight }
  };
  /** The NPC's current schedule entries (id, label, atHour only — compact). */
  existingSchedule?: Array<{ id: string; label: string; atHour: number }>;
  /** Already-scheduled processes involving this actor (compact). */
  pendingProcessesForActor?: Array<{ id: string; label: string; dueAtMinutes: number }>;
  /** Optional revision feedback from a prior GM review. */
  revisionFeedback?: string;
  /** The draft being revised, if this is a revision call. */
  previousDraft?: ScheduleResolution;
}

export type ScheduleResolutionStatus = 'resolved' | 'cannot_resolve' | 'needs_clarification';

/**
 * A single event in a schedule resolution.
 * Payloads are left loosely typed because they pass through JSON and are
 * validated by the reducer when applied.
 */
export type ScheduleResolutionEvent =
  | {
      type: 'ScheduleProcess';
      process: {
        id: string;
        label: string;
        dueAtMinutes: number;
        cadenceMinutes?: number;
        payload: { type: string; [key: string]: unknown };
      };
      note?: string;
    }
  | {
      type: 'SetNpcSchedule';
      actorId: string;
      entries: Array<{
        id: string;
        label: string;
        atHour: number;
        payload: { type: string; [key: string]: unknown };
      }>;
      note?: string;
    };

export interface ScheduleResolution {
  id: string;
  status: ScheduleResolutionStatus;
  rationale: string;
  /** 0.0–1.0 */
  confidence: number;
  events: ScheduleResolutionEvent[];
  /** Populated when status === 'needs_clarification'. */
  clarificationNeeded?: string;
}

export interface ScheduleResolutionRecord {
  input: ScheduleTaskInput;
  resolution: ScheduleResolution;
  revisionCount: number;
}
