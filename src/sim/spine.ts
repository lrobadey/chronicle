import type { Actor, GridPos, Item, LocationPOI, WorldState } from './state';

export type SpineEntityId = string;
export type SpineRelationId = string;
export type SpineScheduleId = string;

export interface SpineEntity {
  id: SpineEntityId;
  kind: 'actor' | 'item' | 'location' | 'container' | 'surface' | 'structure';
  archetype: string;
  name: string;
  tags?: string[];
  components: {
    identity?: {
      tags?: string[];
      aliases?: string[];
    };
    physical?: {
      massKg?: number;
      lengthCm?: number;
      widthCm?: number;
      heightCm?: number;
      volumeL?: number;
      anchored?: boolean;
      portable?: boolean;
    };
    material?: {
      primary?: string;
      secondary?: string[];
      rustable?: boolean;
      flammable?: boolean;
      rotProfile?: string;
    };
    condition?: {
      durability?: number;
      wear?: number;
      rust?: number;
      rot?: number;
      broken?: boolean;
      notes?: string[];
    };
    ownership?: {
      legalOwnerId?: string;
      creatorId?: string;
      lastPossessorId?: string;
    };
    container?: {
      capacityL?: number;
      acceptsTags?: string[];
      sealed?: boolean;
    };
    surface?: {
      maxItems?: number;
      stable?: boolean;
    };
    actor?: {
      inventorySlots?: number;
      routineId?: string;
    };
    location?: {
      anchor?: { x: number; y: number; z?: number };
      radiusCells?: number;
      terrain?: string;
      exposureProfile?: string;
    };
    decay?: {
      class?: 'indoor_stable' | 'outdoor_weathering' | 'organic_rot';
      lastSimulatedAtTurn?: number;
    };
  };
}

export interface SpineRelation {
  id: SpineRelationId;
  type:
    | 'located_in'
    | 'part_of'
    | 'inside'
    | 'on'
    | 'carried_by'
    | 'worn_by'
    | 'owned_by'
    | 'resides_in'
    | 'connected_to';
  from: SpineEntityId;
  to: SpineEntityId;
  props?: Record<string, unknown>;
}

export interface SpineScheduledProcess {
  id: SpineScheduleId;
  entityId?: SpineEntityId;
  processType: string;
  nextEligibleTurn: number;
  cadenceTurns?: number;
  data?: Record<string, unknown>;
}

export interface SpineIndexes {
  byType: Record<string, SpineEntityId[]>;
  byFrom: Record<SpineEntityId, SpineRelationId[]>;
  byTo: Record<SpineEntityId, SpineRelationId[]>;
  byRelationType: Record<string, SpineRelationId[]>;
}

export interface SpineState {
  entities: Record<SpineEntityId, SpineEntity>;
  relations: Record<SpineRelationId, SpineRelation>;
  indexes: SpineIndexes;
  schedules: Record<SpineScheduleId, SpineScheduledProcess>;
}

type LegacyWorldShape = Pick<WorldState, 'actors' | 'items' | 'locations'>;

const ITEM_PLACEMENT_RELATION_TYPES = ['located_in', 'inside', 'on', 'carried_by', 'worn_by'] as const;

export type ItemPlacementRelationType = (typeof ITEM_PLACEMENT_RELATION_TYPES)[number];

export type ItemPlacement =
  | { type: 'located_in'; locationId: string; anchor: GridPos }
  | { type: 'inside'; containerId: string }
  | { type: 'on'; surfaceId: string }
  | { type: 'carried_by'; actorId: string }
  | { type: 'worn_by'; actorId: string };

export function buildSpineFromLegacyWorld(state: LegacyWorldShape): SpineState {
  return buildSynchronizedSpine(state, null, {});
}

export function syncWorldSpine(state: WorldState): WorldState {
  state.spine = buildSynchronizedSpine(state, state.spine, state.spine?.schedules || {});
  deriveLegacyPlacement(state);
  return state;
}

export function getItemPlacement(spine: SpineState, itemId: string): ItemPlacement | null {
  const placements = getItemPlacementRelations(spine, itemId);
  const relation = placements[0];
  if (!relation) return null;

  if (relation.type === 'located_in') {
    const anchor = readStoredItemAnchor(spine, itemId, relation);
    if (!anchor) return null;
    return { type: 'located_in', locationId: relation.to, anchor };
  }
  if (relation.type === 'inside') {
    return { type: 'inside', containerId: relation.to };
  }
  if (relation.type === 'on') {
    return { type: 'on', surfaceId: relation.to };
  }
  if (relation.type === 'carried_by') {
    return { type: 'carried_by', actorId: relation.to };
  }
  return { type: 'worn_by', actorId: relation.to };
}

export function setItemPlacement(
  spine: SpineState,
  itemId: string,
  placement: ItemPlacement,
  locations: Record<string, LocationPOI>,
) {
  for (const relation of getItemPlacementRelations(spine, itemId)) {
    delete spine.relations[relation.id];
  }

  const entity = spine.entities[itemId] || {
    id: itemId,
    kind: 'item',
    archetype: 'item.generic',
    name: itemId,
    components: {},
  };

  if (placement.type === 'located_in') {
    entity.components.location = {
      anchor: placement.anchor,
      terrain: locations[placement.locationId]?.terrain ?? resolveContainingLocation(placement.anchor, locations)?.terrain,
    };
    addRelation(spine.relations, {
      type: 'located_in',
      from: itemId,
      to: placement.locationId,
    });
  } else {
    entity.components.location = undefined;
    addRelation(spine.relations, {
      type: placement.type,
      from: itemId,
      to: placement.type === 'inside'
        ? placement.containerId
        : placement.type === 'on'
          ? placement.surfaceId
          : placement.actorId,
    });
  }

  spine.entities[itemId] = entity;
  spine.indexes = buildIndexes(spine.entities, spine.relations);
}

export function deriveLegacyPlacement(state: WorldState): WorldState {
  const carried: Record<string, string[]> = {};
  for (const actorId of Object.keys(state.actors)) {
    carried[actorId] = [];
  }

  for (const itemId of Object.keys(state.items)) {
    const placement = getItemPlacement(state.spine, itemId);
    if (!placement) continue;

    if (placement.type === 'located_in') {
      state.items[itemId] = {
        ...state.items[itemId],
        location: { kind: 'ground', pos: placement.anchor },
      };
      continue;
    }

    if (placement.type === 'inside' || placement.type === 'on') {
      state.items[itemId] = {
        ...state.items[itemId],
        location: { kind: 'container', containerId: placement.type === 'inside' ? placement.containerId : placement.surfaceId },
      };
      continue;
    }

    carried[placement.actorId] = [...(carried[placement.actorId] || []), itemId];
    state.items[itemId] = {
      ...state.items[itemId],
      location: { kind: 'inventory', actorId: placement.actorId },
    };
  }

  for (const actorId of Object.keys(state.actors)) {
    state.actors[actorId] = {
      ...state.actors[actorId],
      inventory: carried[actorId] || [],
    };
  }

  return state;
}

function buildSynchronizedSpine(
  state: LegacyWorldShape,
  previous: SpineState | null | undefined,
  schedules: Record<SpineScheduleId, SpineScheduledProcess>,
): SpineState {
  const entities: Record<SpineEntityId, SpineEntity> = {};
  const relations: Record<SpineRelationId, SpineRelation> = {};
  const placements = collectItemPlacements(state, previous);
  const carriedCounts = countCarriedItems(placements);

  for (const location of Object.values(state.locations)) {
    entities[location.id] = buildLocationEntity(location);
  }

  for (const actor of Object.values(state.actors)) {
    entities[actor.id] = buildActorEntity(actor, carriedCounts[actor.id] || 0);
    const containingLocationId = findContainingLocationId(actor.pos, state.locations);
    if (containingLocationId) {
      addRelation(relations, {
        type: 'located_in',
        from: actor.id,
        to: containingLocationId,
        props: { anchor: actor.pos },
      });
    }
  }

  for (const item of Object.values(state.items)) {
    const placement = placements[item.id] || buildPlacementFromLegacyItem(item, state.locations);
    entities[item.id] = buildItemEntity(item, placement, state.locations);
    addRelation(relations, buildPlacementRelation(item.id, placement));
  }

  return {
    entities,
    relations,
    indexes: buildIndexes(entities, relations),
    schedules,
  };
}

function buildActorEntity(actor: Actor, inventorySlots: number): SpineEntity {
  return {
    id: actor.id,
    kind: 'actor',
    archetype: actor.kind === 'player' ? 'actor.player' : 'actor.npc',
    name: actor.name,
    tags: actor.tags,
    components: {
      actor: {
        inventorySlots,
      },
      location: {
        anchor: actor.pos,
      },
    },
  };
}

function buildLocationEntity(location: LocationPOI): SpineEntity {
  return {
    id: location.id,
    kind: 'location',
    archetype: 'location.poi',
    name: location.name,
    tags: location.tags,
    components: {
      location: {
        anchor: location.anchor,
        radiusCells: location.radiusCells,
        terrain: location.terrain,
      },
    },
  };
}

function buildItemEntity(item: Item, placement: ItemPlacement, locations: Record<string, LocationPOI>): SpineEntity {
  return {
    id: item.id,
    kind: 'item',
    archetype: 'item.generic',
    name: item.name,
    tags: item.tags,
    components: {
      identity: item.description
        ? {
            aliases: [item.description],
          }
        : undefined,
      location: placement.type === 'located_in'
        ? {
            anchor: placement.anchor,
            terrain: locations[placement.locationId]?.terrain ?? resolveContainingLocation(placement.anchor, locations)?.terrain,
          }
        : undefined,
    },
  };
}

function buildPlacementRelation(itemId: string, placement: ItemPlacement): Omit<SpineRelation, 'id'> {
  if (placement.type === 'carried_by') {
    return {
      type: 'carried_by',
      from: itemId,
      to: placement.actorId,
    };
  }

  if (placement.type === 'worn_by') {
    return {
      type: 'worn_by',
      from: itemId,
      to: placement.actorId,
    };
  }

  if (placement.type === 'inside') {
    return {
      type: 'inside',
      from: itemId,
      to: placement.containerId,
    };
  }

  if (placement.type === 'on') {
    return {
      type: 'on',
      from: itemId,
      to: placement.surfaceId,
    };
  }

  return {
    type: 'located_in',
    from: itemId,
    to: placement.locationId,
  };
}

function addRelation(relations: Record<SpineRelationId, SpineRelation>, relation: Omit<SpineRelation, 'id'>) {
  const id = `${relation.type}:${relation.from}:${relation.to}`;
  relations[id] = { id, ...relation };
}

function buildIndexes(
  entities: Record<SpineEntityId, SpineEntity>,
  relations: Record<SpineRelationId, SpineRelation>,
): SpineIndexes {
  const indexes: SpineIndexes = {
    byType: {},
    byFrom: {},
    byTo: {},
    byRelationType: {},
  };

  for (const entity of Object.values(entities)) {
    const bucket = indexes.byType[entity.kind] || [];
    bucket.push(entity.id);
    indexes.byType[entity.kind] = bucket;
  }

  for (const relation of Object.values(relations)) {
    const fromBucket = indexes.byFrom[relation.from] || [];
    fromBucket.push(relation.id);
    indexes.byFrom[relation.from] = fromBucket;

    const toBucket = indexes.byTo[relation.to] || [];
    toBucket.push(relation.id);
    indexes.byTo[relation.to] = toBucket;

    const typeBucket = indexes.byRelationType[relation.type] || [];
    typeBucket.push(relation.id);
    indexes.byRelationType[relation.type] = typeBucket;
  }

  return indexes;
}

function collectItemPlacements(state: LegacyWorldShape, previous: SpineState | null | undefined): Record<string, ItemPlacement> {
  const placements: Record<string, ItemPlacement> = {};

  for (const itemId of Object.keys(state.items)) {
    const placement = previous ? getItemPlacement(previous, itemId) : null;
    placements[itemId] = placement || buildPlacementFromLegacyItem(state.items[itemId], state.locations);
  }

  return placements;
}

function buildPlacementFromLegacyItem(item: Item, locations: Record<string, LocationPOI>): ItemPlacement {
  if (item.location.kind === 'inventory') {
    return { type: 'carried_by', actorId: item.location.actorId };
  }

  if (item.location.kind === 'container') {
    return { type: 'inside', containerId: item.location.containerId };
  }

  return {
    type: 'located_in',
    locationId: findContainingLocationId(item.location.pos, locations) || findNearestLocationId(item.location.pos, locations) || 'unknown-location',
    anchor: item.location.pos,
  };
}

function countCarriedItems(placements: Record<string, ItemPlacement>) {
  const counts: Record<string, number> = {};
  for (const placement of Object.values(placements)) {
    if (placement.type === 'carried_by' || placement.type === 'worn_by') {
      counts[placement.actorId] = (counts[placement.actorId] || 0) + 1;
    }
  }
  return counts;
}

function getItemPlacementRelations(spine: SpineState, itemId: string): SpineRelation[] {
  const relationIds = spine.indexes.byFrom[itemId] || Object.keys(spine.relations);
  return relationIds
    .map(id => spine.relations[id])
    .filter((relation): relation is SpineRelation => {
      return !!relation && relation.from === itemId && ITEM_PLACEMENT_RELATION_TYPES.includes(relation.type as ItemPlacementRelationType);
    });
}

function readStoredItemAnchor(spine: SpineState, itemId: string, relation: SpineRelation): GridPos | null {
  const anchor = spine.entities[itemId]?.components.location?.anchor;
  if (anchor) return anchor;

  const relationAnchor = relation.props?.anchor;
  if (
    relationAnchor
    && typeof relationAnchor === 'object'
    && typeof (relationAnchor as GridPos).x === 'number'
    && typeof (relationAnchor as GridPos).y === 'number'
  ) {
    return relationAnchor as GridPos;
  }

  return null;
}

function findContainingLocationId(pos: GridPos, locations: Record<string, LocationPOI>): string | null {
  return resolveContainingLocation(pos, locations)?.id || null;
}

function findNearestLocationId(pos: GridPos, locations: Record<string, LocationPOI>): string | null {
  const nearest = Object.values(locations)
    .sort((a, b) => distance(pos, a.anchor) - distance(pos, b.anchor))[0];
  return nearest?.id || null;
}

function resolveContainingLocation(pos: GridPos, locations: Record<string, LocationPOI>): LocationPOI | null {
  const matches = Object.values(locations)
    .filter(location => distance(pos, location.anchor) <= (location.radiusCells ?? 0))
    .sort((a, b) => distance(pos, a.anchor) - distance(pos, b.anchor));
  return matches[0] || null;
}

function distance(a: GridPos, b: GridPos): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}
