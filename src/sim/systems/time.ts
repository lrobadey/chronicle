import type { WorldState } from '../state';

export interface TimeSnapshot {
  elapsedMinutes: number;
  currentHour: number;
  currentDay: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  absoluteIso: string;
}

export function deriveTime(state: WorldState): TimeSnapshot {
  const elapsed = state.systems.time.elapsedMinutes;
  const startHour = state.systems.timeConfig.startHour ?? 0;
  const totalMinutes = startHour * 60 + elapsed;
  const currentHour = Math.floor(totalMinutes / 60) % 24;
  const currentDay = Math.floor(totalMinutes / (24 * 60)) + 1;

  const timeOfDay: TimeSnapshot['timeOfDay'] =
    currentHour >= 5 && currentHour < 12
      ? 'morning'
      : currentHour >= 12 && currentHour < 17
        ? 'afternoon'
        : currentHour >= 17 && currentHour < 21
          ? 'evening'
          : 'night';

  const anchor = new Date(state.systems.timeConfig.anchorIso);
  const absoluteIso = new Date(anchor.getTime() + elapsed * 60 * 1000).toISOString();

  return { elapsedMinutes: elapsed, currentHour, currentDay, timeOfDay, absoluteIso };
}
