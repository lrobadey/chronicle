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

export type MoveActorEvent = {
  meta?: EventMeta;
  type: 'MoveActor';
  actorId: ActorId;
  to: GridPos;
  toLocationId?: string;
  mode?: 'walk' | 'run';
  note?: string;
};

export type TravelToLocationEvent = {
  meta?: EventMeta;
  type: 'TravelToLocation';
  actorId: ActorId;
  locationId: string;
  pace?: 'walk' | 'run';
  confirmId?: string;
  note?: string;
};

export type PickUpItemEvent = {
  meta?: EventMeta;
  type: 'PickUpItem';
  actorId: ActorId;
  itemId: ItemId;
  note?: string;
};

export type DropItemEvent = {
  meta?: EventMeta;
  type: 'DropItem';
  actorId: ActorId;
  itemId: ItemId;
  at?: GridPos;
  note?: string;
};

export type AffectItemEvent = {
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

export type TransferItemEvent = {
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

export type SpeakEvent = {
  meta?: EventMeta;
  type: 'Speak';
  actorId: ActorId;
  text: string;
  toActorId?: ActorId;
  note?: string;
};

export type CreateEntityEvent = {
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

export type SetFlagEvent = {
  meta?: EventMeta;
  type: 'SetFlag';
  key: string;
  value: unknown;
  note?: string;
};

export type ModifyReputationEvent = {
  meta?: EventMeta;
  type: 'ModifyReputation';
  actorId: ActorId;
  factionId: FactionId;
  delta: number;
  reason?: string;
  note?: string;
};

export type SpreadRumorEvent = {
  meta?: EventMeta;
  type: 'SpreadRumor';
  fromActorId?: ActorId;
  toActorId: ActorId;
  rumor: string;
  subject?: string;
  note?: string;
};

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

export type AdvanceTimeEvent = {
  meta?: EventMeta;
  // Use explicit time advancement for "wait" style actions only.
  // MoveActor, TravelToLocation, Explore, and Inspect already add their
  // own elapsed minutes in the reducer.
  type: 'AdvanceTime';
  minutes: number;
  note?: string;
};

export type ExploreEvent = {
  meta?: EventMeta;
  type: 'Explore';
  actorId: ActorId;
  area: string;
  direction?: 'east' | 'west' | 'north' | 'south';
  note?: string;
};

export type InspectEvent = {
  meta?: EventMeta;
  type: 'Inspect';
  actorId: ActorId;
  subject: string;
  note?: string;
};

export type RecordClueEvent = {
  meta?: EventMeta;
  type: 'RecordClue';
  actorId: ActorId;
  text: string;
  subject?: string;
  note?: string;
};

export type ScheduleProcessEvent = {
  meta?: EventMeta;
  type: 'ScheduleProcess';
  process: {
    id: string;
    label: string;
    dueAtMinutes: number;
    cadenceMinutes?: number;
    payload: SchedulableEvent;
  };
  note?: string;
};

export type SetNpcScheduleEvent = {
  meta?: EventMeta;
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

export type WorldEvent =
  | SchedulableEvent
  | AdvanceTimeEvent
  | ExploreEvent
  | InspectEvent
  | RecordClueEvent
  | ScheduleProcessEvent
  | SetNpcScheduleEvent;

export function normalizeWorldEvent(event: WorldEvent): WorldEvent {
  switch (event.type) {
    case 'CreateEntity':
      return normalizeCreateEntityEvent(event);
    case 'ScheduleProcess':
      return {
        ...event,
        process: {
          ...event.process,
          payload: normalizeSchedulableEvent(event.process.payload),
        },
      };
    case 'SetNpcSchedule':
      return {
        ...event,
        entries: event.entries.map(entry => ({
          ...entry,
          payload: normalizeSchedulableEvent(entry.payload),
        })),
      };
    default:
      return event;
  }
}

function normalizeSchedulableEvent(event: SchedulableEvent): SchedulableEvent {
  if (event.type === 'CreateEntity') return normalizeCreateEntityEvent(event);
  return event;
}

function normalizeCreateEntityEvent(event: CreateEntityEvent): CreateEntityEvent {
  if (event.entity.kind !== 'npc') return event;

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
