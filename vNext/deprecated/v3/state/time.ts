/**
 * Time system derivation for Chronicle
 * 
 * Provides rich calendar/time calculations from the canonical elapsedMinutes source of truth.
 * Designed to be backward compatible with existing time tracking.
 */

import type { SimpleWorld } from './world';

/**
 * Extended time system state (backward compatible with existing time interface)
 */
export interface TimeSystemState {
  /** Canonical elapsed minutes since game start */
  elapsedMinutes: number;
  /** Starting hour of day (0-23) */
  startHour?: number;
  /** Optional: Absolute anchor point for calendar calculations */
  anchor?: {
    /** ISO 8601 timestamp for when the game started (e.g., "1825-05-14T14:00:00Z") */
    isoDateTime: string;
    /** Calendar system (default: gregorian) */
    calendar?: 'gregorian' | 'custom';
  };
  /** Optional: Manual time adjustments/patches for GM overrides */
  patches?: Array<{
    turn: number;
    reason: string;
    deltaMinutes?: number;
    setAbsolute?: string; // ISO timestamp override
  }>;
  /** Optional: Cache for computed values */
  cache?: {
    lastComputedTurn: number;
    currentIso?: string;
  };
}

/**
 * Rich time telemetry derived from time state
 */
export interface RichTimeTelemetry {
  // Basic (existing)
  elapsedMinutes: number;
  currentHour: number;
  currentDay: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  
  // Enhanced (new)
  absolute?: {
    isoDateTime: string;
    date: Date;
  };
  calendar?: {
    year: number;
    month: {
      index: number; // 1-12
      name: string;
      dayOfMonth: number;
      daysInMonth: number;
    };
    week: {
      number: number; // ISO week number
      dayOfWeek: number; // 0=Sunday, 1=Monday, etc.
      dayName: string;
    };
    dayOfYear: number;
    daysInYear: number;
  };
  cycle: {
    minute: number; // 0-59
    hour: number; // 0-23
    day: number;
    week: number;
  };
}

/**
 * Compute effective elapsed minutes, applying any patches
 */
export function computeEffectiveElapsedMinutes(
  timeState: TimeSystemState,
  currentTurn?: number
): number {
  let effective = timeState.elapsedMinutes;
  
  // Apply patches if present
  if (timeState.patches && currentTurn !== undefined) {
    // Apply patches up to current turn (in chronological order)
    const applicablePatches = timeState.patches
      .filter(p => p.turn <= currentTurn)
      .sort((a, b) => a.turn - b.turn);
    
    for (const patch of applicablePatches) {
      if (patch.setAbsolute && timeState.anchor) {
        // Calculate elapsed from absolute timestamp
        const anchorDate = new Date(timeState.anchor.isoDateTime);
        const patchDate = new Date(patch.setAbsolute);
        const diffMs = patchDate.getTime() - anchorDate.getTime();
        effective = Math.max(0, Math.floor(diffMs / (1000 * 60)));
      } else if (patch.deltaMinutes !== undefined) {
        effective = Math.max(0, effective + patch.deltaMinutes);
      }
    }
  }
  
  return effective;
}

/**
 * Derive rich calendar/time data from time state
 */
export function deriveAbsoluteTime(
  timeState: TimeSystemState,
  currentTurn?: number
): RichTimeTelemetry {
  const effectiveMinutes = computeEffectiveElapsedMinutes(timeState, currentTurn);
  const startHour = timeState.startHour || 0;
  
  // Basic calculations (existing)
  const totalMinutes = startHour * 60 + effectiveMinutes;
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const currentDay = Math.floor(effectiveMinutes / (24 * 60)) + 1;
  
  const timeOfDay: RichTimeTelemetry['timeOfDay'] =
    hours24 >= 5 && hours24 < 12 ? 'morning' :
    hours24 >= 12 && hours24 < 17 ? 'afternoon' :
    hours24 >= 17 && hours24 < 21 ? 'evening' : 'night';
  
  const result: RichTimeTelemetry = {
    elapsedMinutes: effectiveMinutes,
    currentHour: hours24,
    currentDay,
    timeOfDay,
    cycle: {
      minute: minutes,
      hour: hours24,
      day: currentDay,
      week: Math.floor((currentDay - 1) / 7) + 1,
    },
  };
  
  // Enhanced calendar calculations if anchor is present
  if (timeState.anchor) {
    const anchorDate = new Date(timeState.anchor.isoDateTime);
    const currentDate = new Date(anchorDate.getTime() + effectiveMinutes * 60 * 1000);
    const isoDateTime = currentDate.toISOString();
    
    result.absolute = {
      isoDateTime,
      date: currentDate,
    };
    
    // Calendar calculations (Gregorian for now)
    const year = currentDate.getFullYear();
    const monthIndex = currentDate.getMonth() + 1; // 1-12
    const dayOfMonth = currentDate.getDate();
    
    // Get days in month
    const daysInMonth = new Date(year, monthIndex, 0).getDate();
    
    // Get day of year
    const startOfYear = new Date(year, 0, 1);
    const dayOfYear = Math.floor((currentDate.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
    
    // ISO week calculation
    const d = new Date(Date.UTC(year, currentDate.getMonth(), dayOfMonth));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    
    // Day of week
    const dayOfWeek = currentDate.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    result.calendar = {
      year,
      month: {
        index: monthIndex,
        name: monthNames[monthIndex - 1],
        dayOfMonth,
        daysInMonth,
      },
      week: {
        number: weekNumber,
        dayOfWeek,
        dayName: dayNames[dayOfWeek],
      },
      dayOfYear,
      daysInYear,
    };
  }
  
  return result;
}

/**
 * Ensure time state has an anchor (for backward compatibility)
 * If no anchor exists, creates one based on startHour and startedAt if available
 */
export function ensureTimeAnchor(
  timeState: TimeSystemState,
  worldMeta?: { startedAt?: string; turn?: number }
): TimeSystemState {
  if (timeState.anchor) {
    return timeState;
  }
  
  // Try to infer from world metadata
  if (worldMeta?.startedAt) {
    return {
      ...timeState,
      anchor: {
        isoDateTime: worldMeta.startedAt,
        calendar: 'gregorian',
      },
    };
  }
  
  // Default: use current time with startHour offset
  const now = new Date();
  const startHour = timeState.startHour || 0;
  const anchorDate = new Date(now);
  anchorDate.setHours(startHour, 0, 0, 0);
  
  return {
    ...timeState,
    anchor: {
      isoDateTime: anchorDate.toISOString(),
      calendar: 'gregorian',
    },
  };
}

/**
 * Get time state from world (with backward compatibility)
 */
export function getTimeState(world: SimpleWorld): TimeSystemState | undefined {
  if (!world.systems?.time) {
    return undefined;
  }
  
  const time = world.systems.time;
  return {
    elapsedMinutes: time.elapsedMinutes,
    startHour: time.startHour,
    anchor: (time as any).anchor,
    patches: (time as any).patches,
    cache: (time as any).cache,
  };
}

/**
 * Advance time by a delta (for gameplay time advancement)
 */
export function advanceTime(
  timeState: TimeSystemState,
  deltaMinutes: number
): TimeSystemState {
  return {
    ...timeState,
    elapsedMinutes: Math.max(0, timeState.elapsedMinutes + deltaMinutes),
    // Clear cache since time changed
    cache: undefined,
  };
}

