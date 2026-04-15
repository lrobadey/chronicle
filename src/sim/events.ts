import type { Actor, ActorId, FactionId, GridPos, ItemId, ItemLifecycleState, ItemLocationInput, LocationPOI } from './state';
import type { ItemComponents } from './archetypes';

export type AffectItemEffect =
  | 'pick_up'
  | 'drop'
  | 'transfer'
  | 'open'
  | 'close'
  | 'break'
  | 'consume'
  | 'empty'
  | 'fill'
  | 'ruin';

export interface EventMeta {
  id: string;
  turn: number;
  by: 'player' | 'gm' | 'system';
  actorId?: ActorId;
}

// ---------------------------------------------------------------------------
// Named per-event types for all schedulable variants.
// Defined before WorldEvent so SchedulableEvent can reference them without
// creating a forward-reference cycle.
// ---------------------------------------------------------------------------

type MoveActorEvent = {
  meta?: EventMeta;
  type: 'MoveActor';
  actorId: ActorId;
  to: GridPos;
  toLocationId?: string;
  mode?: 'walk' | 'run';
  note?: string;
};

type PickUpItemEvent = {
  meta?: EventMeta;
  type: 'PickUpItem';
  actorId: ActorId;
  itemId: ItemId;
  note?: string;
};

type DropItemEvent = {
  meta?: EventMeta;
  type: 'DropItem';
  actorId: ActorId;
  itemId: ItemId;
  at?: GridPos;
  note?: string;
};

type AffectItemEvent = {
  meta?: EventMeta;
  type: 'AffectItem';
  actorId: ActorId;
  itemId: ItemId;
  effect: AffectItemEffect;
  at?: GridPos;
  targetActorId?: ActorId;
  targetContainerId?: string;
  instrumentItemId?: ItemId;
  nextLifecycle?: ItemLifecycleState;
  note?: string;
};

type TransferItemEvent = {
  meta?: EventMeta;
  type: 'TransferItem';
  itemId?: ItemId;
  item?: {
    id: ItemId;
    name: string;
    description?: string;
    tags?: string[];
    archetype?: string;
    components?: ItemComponents;
  };
  fromActorId?: ActorId;
  toActorId?: ActorId;
  at?: GridPos;
  note?: string;
};

type SpeakEvent = {
  meta?: EventMeta;
  type: 'Speak';
  actorId: ActorId;
  text: string;
  toActorId?: ActorId;
  note?: string;
};

type CreateEntityEvent = {
  meta?: EventMeta;
  type: 'CreateEntity';
  entity:
    | {
        kind: 'item';
        data: {
          id: ItemId;
          name: string;
          description?: string;
          location: ItemLocationInput;
          tags?: string[];
          archetype?: string;
          components?: ItemComponents;
        };
      }
    | {
        kind: 'npc';
        data: {
          id: ActorId;
          name: string;
          pos: GridPos;
          facing?: Actor['facing'];
          inventory?: ItemId[];
          stats?: Record<string, number>;
          tags?: string[];
          persona?: NonNullable<Actor['persona']>;
          relationships?: NonNullable<Actor['relationships']>;
        };
      }
    | {
        kind: 'location';
        data: {
          id: string;
          name: string;
          description: string;
          anchor: GridPos;
          radiusCells?: LocationPOI['radiusCells'];
          tideAccess?: LocationPOI['tideAccess'];
          terrain?: LocationPOI['terrain'];
          tags?: string[];
        };
      }
    | {
        kind: 'faction';
        data: {
          id: FactionId;
          name: string;
          description: string;
          tags?: string[];
          memberIds?: ActorId[];
        };
      };
  note?: string;
};

type SetFlagEvent = {
  meta?: EventMeta;
  type: 'SetFlag';
  key: string;
  value: unknown;
  note?: string;
};

type ModifyReputationEvent = {
  meta?: EventMeta;
  /**
   * Adjust an actor's standing with a faction.
   * delta > 0 improves standing; delta < 0 worsens it.
   * Standing is clamped to [−100, 100].
   */
  type: 'ModifyReputation';
  actorId: ActorId;
  factionId: FactionId;
  delta: number;
  reason?: string;
  note?: string;
};

type SpreadRumorEvent = {
  meta?: EventMeta;
  /**
   * Propagate a rumor to an actor's knowledge.
   * Rumor text is added to the recipient's knowledge.rumors array.
   */
  type: 'SpreadRumor';
  fromActorId?: ActorId;
  toActorId: ActorId;
  rumor: string;
  subject?: string;
  note?: string;
};

type TravelToLocationEvent = {
  meta?: EventMeta;
  type: 'TravelToLocation';
  actorId: ActorId;
  locationId: string;
  pace?: 'walk' | 'run';
  confirmId?: string;
  note?: string;
};

// ---------------------------------------------------------------------------
// SchedulableEvent: the subset of WorldEvent that may appear as a payload
// inside ScheduleProcess or SetNpcSchedule. Excludes recursive/time events.
// ---------------------------------------------------------------------------

export type SchedulableEvent =
  | MoveActorEvent
  | TravelToLocationEvent
  | PickUpItemEvent
  | DropItemEvent
  | AffectItemEvent
  | TransferItemEvent
  | SpeakEvent
  | CreateEntityEvent
  | SetFlagEvent
  | ModifyReputationEvent
  | SpreadRumorEvent;

// ---------------------------------------------------------------------------
// Full WorldEvent union
// ---------------------------------------------------------------------------

export type WorldEvent =
  | SchedulableEvent
  | {
      meta?: EventMeta;
      // Use explicit time advancement for "wait" style actions only.
      // MoveActor, TravelToLocation, Explore, and Inspect already add their
      // own elapsed minutes in the reducer.
      type: 'AdvanceTime';
      minutes: number;
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'Explore';
      actorId: ActorId;
      area: string;
      direction?: 'east' | 'west' | 'north' | 'south';
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'Inspect';
      actorId: ActorId;
      subject: string;
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'RecordClue';
      actorId: ActorId;
      text: string;
      subject?: string;
      note?: string;
    }
  | {
      meta?: EventMeta;
      /**
       * Register a future world event to fire when elapsedMinutes >= dueAtMinutes.
       * If a process with the same id already exists, it is overwritten.
       * If cadenceMinutes is set, the process re-schedules at dueAtMinutes + cadenceMinutes after firing.
       */
      type: 'ScheduleProcess';
      process: {
        id: string;
        label: string;
        dueAtMinutes: number;
        cadenceMinutes?: number;
        payload: SchedulableEvent;
      };
      note?: string;
    }
  | {
      meta?: EventMeta;
      /**
       * Set or replace an NPC's daily schedule.
       * Existing entries are replaced wholesale. Pass entries: [] to clear.
       * The reducer hydrates schedule entries into scheduledProcesses automatically.
       */
      type: 'SetNpcSchedule';
      actorId: ActorId;
      entries: Array<{
        id: string;
        label: string;
        atHour: number;
        payload: SchedulableEvent;
      }>;
      note?: string;
    };

export function normalizeWorldEvent(event: WorldEvent): WorldEvent {
  if (event.type !== 'CreateEntity') return event;

  if (event.entity.kind === 'npc') {
    const data = event.entity.data as typeof event.entity.data & {
      stats?: { entries?: Array<{ key: string; value: number }> } | Record<string, number> | null;
      relationships?:
        | { entries?: Array<{ actorId: string; trust: number; fear: number; affinity: number }> }
        | Record<string, { trust: number; fear: number; affinity: number }>
        | null;
    };
    return {
      ...event,
      entity: {
        ...event.entity,
        data: {
          ...event.entity.data,
          stats: normalizeStats(data.stats),
          relationships: normalizeRelationships(data.relationships),
        },
      },
    };
  }

  return event;
}

function normalizeStats(
  value: { entries?: Array<{ key: string; value: number }> } | Record<string, number> | null | undefined,
): Record<string, number> | undefined {
  if (!value) return undefined;
  if (Array.isArray((value as { entries?: unknown }).entries)) {
    const record: Record<string, number> = {};
    for (const entry of (value as { entries: Array<{ key: string; value: number }> }).entries) {
      if (typeof entry?.key === 'string' && typeof entry?.value === 'number') {
        record[entry.key] = entry.value;
      }
    }
    return Object.keys(record).length ? record : undefined;
  }
  const record = Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => typeof entryValue === 'number'),
  );
  return Object.keys(record).length ? record : undefined;
}

function normalizeRelationships(
  value:
    | { entries?: Array<{ actorId: string; trust: number; fear: number; affinity: number }> }
    | Record<string, { trust: number; fear: number; affinity: number }>
    | null
    | undefined,
): Record<string, { trust: number; fear: number; affinity: number }> | undefined {
  if (!value) return undefined;
  if (Array.isArray((value as { entries?: unknown }).entries)) {
    const record: Record<string, { trust: number; fear: number; affinity: number }> = {};
    for (const entry of (value as { entries: Array<{ actorId: string; trust: number; fear: number; affinity: number }> }).entries) {
      if (typeof entry?.actorId === 'string') {
        record[entry.actorId] = {
          trust: typeof entry?.trust === 'number' ? entry.trust : 0,
          fear: typeof entry?.fear === 'number' ? entry.fear : 0,
          affinity: typeof entry?.affinity === 'number' ? entry.affinity : 0,
        };
      }
    }
    return Object.keys(record).length ? record : undefined;
  }
  const record: Record<string, { trust: number; fear: number; affinity: number }> = {};
  for (const [actorId, entry] of Object.entries(value)) {
    if (entry && typeof entry === 'object') {
      record[actorId] = {
        trust: typeof entry.trust === 'number' ? entry.trust : 0,
        fear: typeof entry.fear === 'number' ? entry.fear : 0,
        affinity: typeof entry.affinity === 'number' ? entry.affinity : 0,
      };
    }
  }
  return Object.keys(record).length ? record : undefined;
}
