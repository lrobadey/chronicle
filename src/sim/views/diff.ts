import type { Telemetry } from './telemetry';
import type { WorldEvent } from '../events';

export interface TurnDiff {
  summary: string;
  timeDeltaMinutes: number;
  moved: boolean;
  newLocationName?: string;
  newItems: string[];
  events: WorldEvent[];
}

export function computeTurnDiff(before: Telemetry, after: Telemetry, events: WorldEvent[]): TurnDiff {
  const timeDeltaMinutes = after.time.elapsedMinutes - before.time.elapsedMinutes;
  const moved = before.player.pos.x !== after.player.pos.x || before.player.pos.y !== after.player.pos.y || (before.player.pos.z ?? 0) !== (after.player.pos.z ?? 0);
  const newLocationName = moved ? after.location.name : undefined;

  const beforeItems = new Set(before.player.inventory.map(i => i.id));
  const newItems = after.player.inventory.filter(i => !beforeItems.has(i.id)).map(i => i.name);

  const summaryParts: string[] = [];
  if (moved) summaryParts.push(`Moved to ${after.location.name}`);
  if (newItems.length) summaryParts.push(`Picked up ${newItems.join(', ')}`);
  if (!summaryParts.length && timeDeltaMinutes > 0) summaryParts.push(`${timeDeltaMinutes} minutes pass`);

  return {
    summary: summaryParts.join('. ') || 'No major changes',
    timeDeltaMinutes,
    moved,
    newLocationName,
    newItems,
    events,
  };
}
