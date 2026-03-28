import type { Actor, ActorId, GridPos, Item, ItemId, LocationPOI } from './state';

export interface EventMeta {
  id: string;
  turn: number;
  by: 'player' | 'gm' | 'system';
  actorId?: ActorId;
}

export type WorldEvent =
  | {
      meta?: EventMeta;
      type: 'MoveActor';
      actorId: ActorId;
      to: GridPos;
      toLocationId?: string;
      mode?: 'walk' | 'run';
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'PickUpItem';
      actorId: ActorId;
      itemId: ItemId;
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'DropItem';
      actorId: ActorId;
      itemId: ItemId;
      at?: GridPos;
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'Speak';
      actorId: ActorId;
      text: string;
      toActorId?: ActorId;
      note?: string;
    }
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
      type: 'CreateEntity';
      entity:
        | {
            kind: 'item';
            data: {
              id: ItemId;
              name: string;
              description?: string;
              location: Item['location'];
              tags?: string[];
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
          };
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'TravelToLocation';
      actorId: ActorId;
      locationId: string;
      pace?: 'walk' | 'run';
      confirmId?: string;
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'Explore';
      actorId: ActorId;
      area: 'shoreline' | 'docks' | 'under_ribs' | 'around_here';
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
      type: 'SetFlag';
      key: string;
      value: unknown;
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
