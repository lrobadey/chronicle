import type { Actor, GridPos, Item, ItemLocationInput, LocationPOI, WorldState } from './state';

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

const ITEM_PLACEMENT_RELATION_TYPES = ['located_in', 'inside', 'on', 'carried_by', 'worn_by'] as const;

export type ItemPlacementRelationType = (typeof ITEM_PLACEMENT_RELATION_TYPES)[number];

export type ItemPlacement =
  | { type: 'located_in'; locationId: string; anchor: GridPos }
  | { type: 'inside'; containerId: string }
  | { type: 'on'; surfaceId: string }
  | { type: 'carried_by'; actorId: string }
  | { type: 'worn_by'; actorId: string };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the initial spine for a new world. Item placements are provided
 * explicitly — this is the only path that converts ItemLocationInput into
 * spine relations.
 */
export function buildInitialSpine(
  state: Pick<WorldState, 'actors' | 'items' | 'locations'>,
  itemPlacements: Record<string, ItemLocationInput>,
): SpineState {
  const entities: Record<SpineEntityId, SpineEntity> = {};
  const relations: Record<SpineRelationId, SpineRelation> = {};

  const placements: Record<string, ItemPlacement> = {};
  for (const [itemId, location] of Object.entries(itemPlacements)) {
    placements[itemId] = placementFromInput(location, state.locations);
  }
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
    const placement = placements[item.id];
    if (!placement) continue;
    entities[item.id] = buildItemEntity(item, placement, state.locations);
    addRelation(relations, buildPlacementRelation(item.id, placement));
  }

  return {
    entities,
    relations,
    indexes: buildIndexes(entities, relations),
    schedules: {},
  };
}

/**
 * Rebuild the spine from the current world state. Actor and location entities
 * are rebuilt from their authoritative fields. Item placement is read from
 * the *previous* spine — spine is the single source of truth for items.
 *
 * After rebuilding, actor inventories are derived from spine placement
 * relations (the one permitted spine → legacy derivation).
 */
export function syncWorldSpine(state: WorldState): WorldState {
  const previous = state.spine || emptySpine();

  const entities: Record<SpineEntityId, SpineEntity> = {};
  const relations: Record<SpineRelationId, SpineRelation> = {};

  // Read item placements from previous spine (authoritative)
  const itemPlacements: Record<string, ItemPlacement> = {};
  for (const itemId of Object.keys(state.items)) {
    const placement = getItemPlacement(previous, itemId);
    if (placement) itemPlacements[itemId] = placement;
  }
  const carriedCounts = countCarriedItems(itemPlacements);

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
    const placement = itemPlacements[item.id];
    if (!placement) continue;
    entities[item.id] = buildItemEntity(item, placement, state.locations);
    addRelation(relations, buildPlacementRelation(item.id, placement));
  }

  state.spine = {
    entities,
    relations,
    indexes: buildIndexes(entities, relations),
    schedules: previous.schedules || {},
  };

  // TODO(spine-commit-gate): Add a spine-level finalize/commit step here that
  // runs *before* returning state and rejects invalid graph commits.
  //
  // Why here:
  // - applyEvents() currently syncs after every event, so this is the canonical
  //   choke point for "state leaves reducer as valid" guarantees.
  // - turnEngine checks invariants later, but direct call sites (tests, tools,
  //   persistence hydration) can bypass that gate.
  //
  // Suggested contract:
  //   validateSpineOrThrow(state.spine, {
  //     actors: state.actors,
  //     locations: state.locations,
  //     items: state.items,
  //   });
  //
  // Validator should enforce at minimum:
  // 1) exactly one placement relation per item;
  // 2) placement target exists for every placement type:
  //    - carried_by / worn_by => actor exists
  //    - located_in => location exists + anchor present
  //    - inside => container entity exists
  //    - on => surface entity exists
  // 3) index consistency for any touched relation buckets.
  //
  // On failure: throw a typed SpineIntegrityError with machine-readable fields
  // (code, itemId/relationId/path) so turn orchestration can reject events
  // deterministically with actionable diagnostics.

  // Derive actor inventories — the one permitted spine → legacy derivation
  deriveActorInventories(state);

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
  // TODO(spine-mutation-api): This function should evolve into the only
  // sanctioned item-placement mutator and perform strict pre/post checks.
  //
  // Pre-check targets by relation type before mutating:
  // - carried_by/worn_by -> actor entity id exists in spine.entities
  // - inside -> container entity id exists and kind === 'container'
  // - on -> surface entity id exists and kind === 'surface'
  // - located_in -> location id exists in canonical locations/spine + anchor
  //
  // Post-check with the same spine commit validator used by syncWorldSpine()
  // to ensure one placement relation and no dangling references.
  //
  // Migration note:
  // Once this mutator is hardened, callers should stop writing spine.relations
  // directly and route all placement changes through this API.
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emptySpine(): SpineState {
  return {
    entities: {},
    relations: {},
    indexes: { byType: {}, byFrom: {}, byTo: {}, byRelationType: {} },
    schedules: {},
  };
}

function deriveActorInventories(state: WorldState): void {
  const carried: Record<string, string[]> = {};
  for (const actorId of Object.keys(state.actors)) {
    carried[actorId] = [];
  }
  for (const itemId of Object.keys(state.items)) {
    const placement = getItemPlacement(state.spine, itemId);
    if (placement && (placement.type === 'carried_by' || placement.type === 'worn_by')) {
      (carried[placement.actorId] ||= []).push(itemId);
    }
  }
  for (const actorId of Object.keys(state.actors)) {
    state.actors[actorId] = {
      ...state.actors[actorId],
      inventory: carried[actorId] || [],
    };
  }
}

function placementFromInput(location: ItemLocationInput, locations: Record<string, LocationPOI>): ItemPlacement {
  if (location.kind === 'inventory') {
    return { type: 'carried_by', actorId: location.actorId };
  }
  if (location.kind === 'container') {
    return { type: 'inside', containerId: location.containerId };
  }
  return {
    type: 'located_in',
    locationId: findContainingLocationId(location.pos, locations) || findNearestLocationId(location.pos, locations) || 'unknown-location',
    anchor: location.pos,
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
