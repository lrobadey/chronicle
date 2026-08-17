// ChangeSummary.ts – Convert engine PatchSets into narratable change events
// ========================================================================
import type { GTWG } from '../types/GTWGTypes.js';
import type { Patch, PatchSet } from './PressurePatch.js';
import { getEntity, getEntityContainer } from '../data/GTWG.js';
import { getSeason, getTimeOfDay } from './WorldTime.js';

export interface ChangeEvent {
  kind: string;
  actorId?: string;
  entityId?: string;
  fromId?: string;
  toId?: string;
  meta?: Record<string, any>;
}

export interface ChangeSummary {
  tick: number;
  timeIsoBefore: string;
  timeIsoAfter: string;
  events: ChangeEvent[];
  notes?: string[];
}

function isTimePatch(p: Patch): boolean {
  return p.op === 'set' && p.entity === '__meta__' && p.field === 'worldTime';
}

function minutesBetween(prevIso?: string, nextIso?: string): number | undefined {
  if (!prevIso || !nextIso) return undefined;
  const prev = new Date(prevIso).getTime();
  const next = new Date(nextIso).getTime();
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return undefined;
  return Math.max(0, Math.round((next - prev) / 60000));
}

export function summarizePatches(
  gtwgBefore: GTWG,
  gtwgAfter: GTWG,
  patches: PatchSet,
  tick: number,
): ChangeSummary {
  const events: ChangeEvent[] = [];
  const notes: string[] = [];

  const timeBefore = (gtwgBefore as any)?.metadata?.worldTime || new Date().toISOString();
  const timeAfter = (gtwgAfter as any)?.metadata?.worldTime || timeBefore;

  // Time advancement (single consolidated event)
  const anyTimePatch = patches.find(isTimePatch);
  const advancedMinutes = minutesBetween(timeBefore, timeAfter);
  if (anyTimePatch && typeof advancedMinutes === 'number' && advancedMinutes > 0) {
    events.push({
      kind: 'time_advanced',
      meta: {
        minutes: advancedMinutes,
        season: getSeason(timeAfter),
        timeOfDay: getTimeOfDay(timeAfter),
      },
    });
  }

  // Travel detection heuristic:
  //  - A player character's properties.current_location changed to a new region
  //  - A contained_in relation created from player -> destination
  // We group these into a single 'travel' event when detected.
  const createRelPatches = patches.filter((p) => p.op === 'create_relation' && (p as any).value?.type === 'contained_in');
  for (const p of createRelPatches) {
    const rel = (p as any).value as { id: string; type: string; from: string; to: string };
    const player = getEntity(gtwgAfter, rel.from);
    if (player && player.type === 'character') {
      const prevContainer = getEntityContainer(gtwgBefore, rel.from);
      const minutes = typeof advancedMinutes === 'number' ? advancedMinutes : undefined;
      events.push({
        kind: 'travel',
        actorId: rel.from,
        fromId: prevContainer?.id,
        toId: rel.to,
        meta: {
          proposer: p.proposer,
          etaMinutes: minutes,
        },
      });
    }
  }

  // Entity lifecycle
  for (const p of patches) {
    if (p.op === 'create_entity') {
      events.push({ kind: 'entity_created', entityId: p.entity, meta: { proposer: p.proposer } });
    } else if (p.op === 'delete_entity') {
      events.push({ kind: 'entity_deleted', entityId: p.entity, meta: { proposer: p.proposer } });
    }
  }

  // Relation lifecycle (skip the travel we already captured; still emit generic events)
  for (const p of patches) {
    if (p.op === 'create_relation') {
      const rel = (p as any).value;
      events.push({ kind: 'relation_created', entityId: rel?.id, meta: { type: rel?.type, from: rel?.from, to: rel?.to, proposer: p.proposer } });
    } else if (p.op === 'delete_relation') {
      events.push({ kind: 'relation_deleted', entityId: p.entity, meta: { proposer: (p as any).proposer } });
    }
  }

  // Salient field changes
  const salientFields = new Set([
    'properties.status',
    'properties.health',
    'properties.state',
    // 'properties.current_location' is covered by travel
  ]);

  for (const p of patches) {
    if (p.op === 'set' || p.op === 'replace') {
      const fullField = p.field;
      if (fullField === 'properties') {
        const keys = p.value ? Object.keys(p.value) : [];
        for (const k of keys) {
          const f = `properties.${k}`;
          if (salientFields.has(f)) {
            events.push({ kind: 'field_changed', entityId: p.entity, meta: { field: f, value: p.value[k], proposer: p.proposer } });
          }
        }
      } else if (salientFields.has(fullField)) {
        events.push({ kind: 'field_changed', entityId: p.entity, meta: { field: fullField, value: p.value, proposer: p.proposer } });
      }
    }
  }

  return {
    tick,
    timeIsoBefore: timeBefore,
    timeIsoAfter: timeAfter,
    events,
    notes,
  };
}


