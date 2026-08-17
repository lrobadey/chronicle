import type { WorldState, LocationPOI } from '../state';

export interface TideSnapshot {
  phase: 'low' | 'rising' | 'high' | 'falling';
  level: number;
  minutesUntilChange: number;
  blockedLocationIds: string[];
}

export function deriveTide(state: WorldState): TideSnapshot {
  const elapsed = state.systems.time.elapsedMinutes;
  const cycleMinutes = state.systems.tideConfig.cycleMinutes || 720;
  const normalized = (elapsed % cycleMinutes) / cycleMinutes;
  const level = 0.5 + 0.5 * Math.sin(2 * Math.PI * normalized);
  const derivative = Math.cos(2 * Math.PI * normalized);

  const phase: TideSnapshot['phase'] =
    level < 0.25 ? 'low' :
    level > 0.75 ? 'high' :
    derivative > 0 ? 'rising' : 'falling';

  const quarterCycle = cycleMinutes / 4;
  const currentQuarter = Math.floor(normalized * 4);
  const minutesIntoQuarter = (normalized * 4 - currentQuarter) * quarterCycle;
  const minutesUntilChange = Math.max(1, Math.ceil(quarterCycle - minutesIntoQuarter));

  const blockedLocationIds: string[] = [];
  for (const loc of Object.values(state.locations)) {
    if (loc.tideAccess === 'low' && (phase === 'high' || phase === 'rising')) {
      blockedLocationIds.push(loc.id);
    }
    if (loc.tideAccess === 'high' && (phase === 'low' || phase === 'falling')) {
      blockedLocationIds.push(loc.id);
    }
  }

  return { phase, level: Math.max(0, Math.min(1, level)), minutesUntilChange, blockedLocationIds };
}

export function isTideBlocked(loc: LocationPOI, tide: TideSnapshot): boolean {
  if (!loc.tideAccess || loc.tideAccess === 'always') return false;
  if (loc.tideAccess === 'low') return tide.phase === 'high' || tide.phase === 'rising';
  if (loc.tideAccess === 'high') return tide.phase === 'low' || tide.phase === 'falling';
  return false;
}
