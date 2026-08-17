export interface ScheduleTaskInput {
  task: string;
  actorId?: string;
  actorName?: string;
  currentElapsedMinutes: number;
  worldTimeContext: {
    clockDisplay: string;
    currentDayIndex: number;
    namedTimepoints: Record<string, number>;
  };
  existingSchedule?: Array<{ id: string; label: string; atHour: number }>;
  pendingProcessesForActor?: Array<{ id: string; label: string; dueAtMinutes: number }>;
  timeHint?: string;
  revisionFeedback?: string;
  previousDraft?: {
    status: ScheduleResolutionStatus;
    rationale: string;
    confidence: number;
    events: ScheduleResolutionEvent[];
    clarificationNeeded?: string;
  };
}

export type ScheduleResolutionStatus = 'resolved' | 'cannot_resolve' | 'needs_clarification';

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
  confidence: number;
  events: ScheduleResolutionEvent[];
  clarificationNeeded?: string;
}

export interface ScheduleResolutionRecord {
  request: ScheduleTaskInput;
  resolution: ScheduleResolution;
  revisionCount: number;
}
