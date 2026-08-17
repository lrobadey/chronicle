// WorldTime.ts – minimal pure helpers for GTWG world time management
// ================================================================

export function addMinutesToIso(iso: string, minutes: number): string {
  try {
    const d = new Date(iso);
    if (Number.isFinite(minutes)) d.setMinutes(d.getMinutes() + minutes);
    return d.toISOString();
  } catch {
    const d = new Date();
    d.setMinutes(d.getMinutes() + (Number.isFinite(minutes) ? minutes : 0));
    return d.toISOString();
  }
}

export function getSeason(iso: string): 'spring' | 'summer' | 'autumn' | 'winter' {
  const m = new Date(iso).getMonth(); // 0-11
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

export function getTimeOfDay(iso: string): 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night' {
  const h = new Date(iso).getHours();
  if (h >= 5 && h < 6) return 'dawn';
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 13) return 'noon';
  if (h >= 13 && h < 17) return 'afternoon';
  if (h >= 17 && h < 19) return 'dusk';
  return 'night';
}

export function crossedBoundary(prevIso: string, nextIso: string, unit: 'hour' | 'day'): boolean {
  const prev = new Date(prevIso);
  const next = new Date(nextIso);
  if (unit === 'hour') {
    const sameUtcDate =
      prev.getUTCFullYear() === next.getUTCFullYear() &&
      prev.getUTCMonth() === next.getUTCMonth() &&
      prev.getUTCDate() === next.getUTCDate();
    return prev.getUTCHours() !== next.getUTCHours() || !sameUtcDate;
  }
  if (unit === 'day') {
    return (
      prev.getUTCFullYear() !== next.getUTCFullYear() ||
      prev.getUTCMonth() !== next.getUTCMonth() ||
      prev.getUTCDate() !== next.getUTCDate()
    );
  }
  return false;
}

export function formatIsoForDisplay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Added helpers
export function getMonthName(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'long' });
}

export function summarizeBoundaryCrossings(prevIso: string, nextIso: string) {
  const p = new Date(prevIso);
  const n = new Date(nextIso);
  const sameUtcDate =
    p.getUTCFullYear() === n.getUTCFullYear() &&
    p.getUTCMonth() === n.getUTCMonth() &&
    p.getUTCDate() === n.getUTCDate();
  return {
    hour: p.getUTCHours() !== n.getUTCHours() || !sameUtcDate,
    day: !sameUtcDate,
    month: p.getUTCMonth() !== n.getUTCMonth() || p.getUTCFullYear() !== n.getUTCFullYear(),
    year: p.getUTCFullYear() !== n.getUTCFullYear(),
  };
}

