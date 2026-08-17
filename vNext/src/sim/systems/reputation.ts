import type { WorldState } from '../state';

/**
 * Reputation drift — a Kernel primitive (North Star §4.2.1).
 *
 * Standing with each faction decays toward neutral (0) when not actively
 * reinforced. This makes faction relationships require ongoing engagement
 * to maintain rather than persisting forever from a single interaction.
 *
 * Drift rate: 1 point per 10 in-world days toward neutral.
 * Standing is only drifted when |standing| > DRIFT_THRESHOLD.
 *
 * Called from syncWorldSpine on every event, mirroring the runDecayCatchUp
 * pattern (lazy catch-up — computes delta from lastDriftedMinutes).
 */

const DRIFT_RATE_PER_MINUTE = 1 / (10 * 24 * 60); // 1 point per 10 days
const DRIFT_THRESHOLD = 5; // standings within ±5 of neutral are left alone

export function runReputationDrift(state: WorldState): void {
  const currentMinutes = state.systems.time.elapsedMinutes;
  const lastMinutes = state.directorState.reputationDriftLastMinutes ?? currentMinutes;
  const deltaMinutes = currentMinutes - lastMinutes;

  if (deltaMinutes <= 0) return;

  const driftAmount = deltaMinutes * DRIFT_RATE_PER_MINUTE;

  for (const actor of Object.values(state.actors)) {
    if (!actor.factionStandings) continue;

    let changed = false;
    const updated: Record<string, number> = { ...actor.factionStandings };

    for (const [factionId, standing] of Object.entries(actor.factionStandings)) {
      if (Math.abs(standing) <= DRIFT_THRESHOLD) continue;

      // Drift toward 0
      const direction = standing > 0 ? -1 : 1;
      const drifted = standing + direction * driftAmount;

      // Don't overshoot neutral — clamp to 0 if we'd cross the threshold
      const clamped = direction > 0
        ? Math.min(0, drifted)
        : Math.max(0, drifted);

      if (clamped !== standing) {
        updated[factionId] = clamped;
        changed = true;
      }
    }

    if (changed) {
      actor.factionStandings = updated;
    }
  }

  state.directorState.reputationDriftLastMinutes = currentMinutes;
}
