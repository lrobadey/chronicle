/**
 * System calculations for Chronicle world state
 * 
 * These functions derive system state (tide, weather, etc.) from the source of truth: elapsed time.
 */

export interface TideState {
  phase: 'low' | 'rising' | 'high' | 'falling';
  /** Normalized tide level: 0.0 (low) to 1.0 (high) */
  level: number;
  /** Minutes until the next phase transition */
  minutesUntilChange: number;
}

/**
 * Calculate tide state from elapsed time using a simple sinusoid.
 * 
 * The tide follows a sine wave: level = 0.5 + 0.5 * sin(2π * t / cycleMinutes)
 * - Level 0.0 = low tide
 * - Level 0.5 = mid-tide (rising or falling)
 * - Level 1.0 = high tide
 * 
 * @param elapsedMinutes - Total elapsed game time in minutes
 * @param cycleMinutes - Full tide cycle duration (default: 720 = 12 hours)
 * @returns Tide state including phase, level, and time until next change
 */
export function calculateTideState(
  elapsedMinutes: number,
  cycleMinutes: number = 720
): TideState {
  // Normalize time to [0, 1] within the cycle
  const normalizedTime = (elapsedMinutes % cycleMinutes) / cycleMinutes;
  
  // Calculate tide level using sine wave: 0.0 (low) to 1.0 (high)
  const level = 0.5 + 0.5 * Math.sin(2 * Math.PI * normalizedTime);
  
  // Determine phase based on level and derivative (rising vs falling)
  // The sine derivative tells us if tide is rising or falling
  const derivative = Math.cos(2 * Math.PI * normalizedTime);
  
  let phase: TideState['phase'];
  if (level < 0.25) {
    phase = 'low';
  } else if (level > 0.75) {
    phase = 'high';
  } else if (derivative > 0) {
    phase = 'rising';
  } else {
    phase = 'falling';
  }
  
  // Calculate minutes until next phase transition
  // Transitions occur at level: 0, 0.25, 0.5, 0.75, 1.0 (which wraps to 0)
  let nextTransitionLevel: number;
  if (phase === 'low') {
    nextTransitionLevel = 0.25;
  } else if (phase === 'rising') {
    nextTransitionLevel = 0.75;
  } else if (phase === 'high') {
    nextTransitionLevel = 0.75; // falling from high
  } else { // falling
    nextTransitionLevel = 0.25;
  }
  
  // Solve for when level reaches nextTransitionLevel
  // This is approximate - for simplicity, use quarter-cycle intervals
  const quarterCycle = cycleMinutes / 4;
  const currentQuarter = Math.floor(normalizedTime * 4);
  const minutesIntoQuarter = (normalizedTime * 4 - currentQuarter) * quarterCycle;
  const minutesUntilChange = Math.ceil(quarterCycle - minutesIntoQuarter);
  
  return {
    phase,
    level: Math.max(0, Math.min(1, level)), // clamp to [0, 1]
    minutesUntilChange: Math.max(1, minutesUntilChange), // at least 1 minute
  };
}

/**
 * Format elapsed time into a human-readable clock time.
 * 
 * @param elapsedMinutes - Total elapsed game time in minutes
 * @param startHour - Starting hour (0-23, default: 8 for 8 AM)
 * @returns Formatted time string like "2:45 PM"
 */
export function formatGameTime(elapsedMinutes: number, startHour: number = 8): string {
  const totalMinutes = startHour * 60 + elapsedMinutes;
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  
  const hours12 = hours24 % 12 || 12;
  const ampm = hours24 < 12 ? 'AM' : 'PM';
  const minutesStr = minutes.toString().padStart(2, '0');
  
  return `${hours12}:${minutesStr} ${ampm}`;
}

/**
 * Get the day number from elapsed time.
 * 
 * @param elapsedMinutes - Total elapsed game time in minutes
 * @returns Day number (1-indexed)
 */
export function getGameDay(elapsedMinutes: number): number {
  return Math.floor(elapsedMinutes / (24 * 60)) + 1;
}

