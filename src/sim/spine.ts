import type { Actor, FactionEntity, GridPos, Item, ItemLifecycleState, ItemLocationInput, LocationPOI, WorldState } from './state';
import {
  SpineIntegrityError,
  type SpineIntegrityIssue,
  type SpinePlacementType,
} from '../engine/errors';
import { getArchetypePreset, mergeItemComponents } from './archetypes';
import { runDecayCatchUp } from './systems/decay';
import { runReputationDrift } from './systems/reputation';

export type SpineEntityId = string;
export type SpineRelationId = string;
export type SpineScheduleId = string;

export interface SpineEntity {
  id: SpineEntityId;
  kind: 'actor' | 'item' | 'location' | 'container' | 'surface' | 'structure' | 'faction';
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
      lastSimulatedAtMinutes?: number;
    };
    lifecycle?: {
      state?: ItemLifecycleState;
    };
    /** Faction-specific metadata. Only populated when kind === 'faction'. */
    faction?: {
      territory?: string;
      agenda?: string;
      memberCount?: number;
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
    | 'connected_to'
    | 'member_of'
    | 'allied_with'
    | 'rival_of';
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

export interface SpineValidationContext {
  actorIds?: Iterable<string>;
  itemIds?: Iterable<string>;
  locationIds?: Iterable<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the initial spine for a new world. Item placements are provided
 * explicitly — this is the only path that converts ItemLocationInput into
 * spine relations.
 */
export function buildInitialSpine(
  state: Pick<WorldState, 'actors' | 'items' | 'locations' | 'factions'>,
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

  for (const faction of Object.values(state.factions || {})) {
    entities[faction.id] = buildFactionEntity(faction);
    for (const memberId of faction.memberIds) {
      addRelation(relations, { type: 'member_of', from: memberId, to: faction.id });
    }
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

  for (const faction of Object.values(state.factions || {})) {
    entities[faction.id] = buildFactionEntity(faction);
    for (const memberId of faction.memberIds) {
      addRelation(relations, { type: 'member_of', from: memberId, to: faction.id });
    }
  }

  state.spine = {
    entities,
    relations,
    indexes: buildIndexes(entities, relations),
    schedules: previous.schedules || {},
  };
  runDecayCatchUp(state);
  runReputationDrift(state);
  validateSpineOrThrow(state.spine, {
    actorIds: Object.keys(state.actors),
    itemIds: Object.keys(state.items),
    locationIds: Object.keys(state.locations),
  });

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
  validatePlacementTargetOrThrow(spine, itemId, placement, locations);

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
  validateSpineOrThrow(spine, {
    itemIds: collectEntityIdsByKind(spine, 'item'),
    actorIds: collectEntityIdsByKind(spine, 'actor'),
    locationIds: Object.keys(locations),
  });
}

export function clearItemPlacement(
  spine: SpineState,
  itemId: string,
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
  entity.components.location = undefined;
  spine.entities[itemId] = entity;
  spine.indexes = buildIndexes(spine.entities, spine.relations);
  validateSpineOrThrow(spine, {
    itemIds: collectEntityIdsByKind(spine, 'item'),
    actorIds: collectEntityIdsByKind(spine, 'actor'),
    locationIds: Object.keys(locations),
  });
}

export function validateSpine(
  spine: SpineState,
  context: SpineValidationContext = {},
): SpineIntegrityIssue[] {
  const issues: SpineIntegrityIssue[] = [];
  const actorIds = new Set(context.actorIds ?? collectEntityIdsByKind(spine, 'actor'));
  const itemIds = new Set(context.itemIds ?? collectEntityIdsByKind(spine, 'item'));
  const locationIds = new Set(context.locationIds ?? collectEntityIdsByKind(spine, 'location'));

  for (const itemId of itemIds) {
    const placements = getItemPlacementRelationsFromRelations(spine, itemId);
    if (placements.length !== 1) {
      issues.push({
        code: placements.length === 0 ? 'missing_item_placement' : 'multiple_item_placements',
        path: `spine.relations.${itemId}`,
        message: placements.length === 0
          ? `Expected exactly one item placement relation, found 0`
          : `Expected exactly one item placement relation, found ${placements.length}`,
        itemId,
        relationId: placements[0]?.id,
      });
      continue;
    }

    const relation = placements[0]!;
    if (relation.type === 'carried_by' || relation.type === 'worn_by') {
      validateEntityTarget(
        issues,
        spine,
        relation,
        itemId,
        actorIds.has(relation.to),
        'actor',
        `Placement references non-existent actor ${relation.to}`,
      );
      continue;
    }

    if (relation.type === 'located_in') {
      validateEntityTarget(
        issues,
        spine,
        relation,
        itemId,
        locationIds.has(relation.to),
        'location',
        `Placement references non-existent location ${relation.to}`,
      );
      if (!readStoredItemAnchor(spine, itemId, relation)) {
        issues.push({
          code: 'missing_location_anchor',
          path: `spine.entities.${itemId}.components.location.anchor`,
          message: `Located item ${itemId} is missing an anchor`,
          itemId,
          relationId: relation.id,
          placementType: relation.type,
        });
      }
      continue;
    }

    if (relation.type === 'inside') {
      validateEntityTarget(
        issues,
        spine,
        relation,
        itemId,
        true,
        'container',
        `Placement references non-existent container ${relation.to}`,
      );
      continue;
    }

    validateEntityTarget(
      issues,
      spine,
      relation,
      itemId,
      true,
      'surface',
      `Placement references non-existent surface ${relation.to}`,
    );
  }

  appendRelationIndexIssues(issues, spine, 'byFrom', spine.indexes.byFrom, buildIndexes({}, spine.relations).byFrom);
  appendRelationIndexIssues(issues, spine, 'byTo', spine.indexes.byTo, buildIndexes({}, spine.relations).byTo);
  appendRelationIndexIssues(
    issues,
    spine,
    'byRelationType',
    spine.indexes.byRelationType,
    buildIndexes({}, spine.relations).byRelationType,
  );

  return issues;
}

export function validateSpineOrThrow(
  spine: SpineState,
  context: SpineValidationContext = {},
): void {
  const issues = validateSpine(spine, context);
  if (issues.length) {
    throw new SpineIntegrityError({ issues });
  }
}

export interface ItemComponentSummary {
  lifecycle?: ItemLifecycleState;
  material?: string;
  condition?: string;
  sealed?: boolean;
  broken?: boolean;
  owner?: string;
}

/**
 * Derive a concise component summary suitable for LLM context windows.
 * Returns undefined when the entity has no meaningful component data.
 */
export function summarizeItemComponents(spine: SpineState, itemId: string): ItemComponentSummary | undefined {
  const entity = spine.entities[itemId];
  if (!entity || entity.kind !== 'item') return undefined;

  const summary: ItemComponentSummary = {};
  let populated = false;

  const lifecycle = getItemLifecycleState(spine, itemId);
  if (lifecycle !== 'intact') {
    summary.lifecycle = lifecycle;
    populated = true;
  }

  if (entity.components.material?.primary) {
    summary.material = entity.components.material.primary;
    populated = true;
  }

  if (entity.components.condition) {
    const c = entity.components.condition;
    if (lifecycle === 'consumed') {
      summary.condition = 'consumed';
    } else if (lifecycle === 'unusable') {
      summary.condition = 'unusable';
    } else if (lifecycle === 'ruined') {
      summary.condition = 'ruined';
    } else if (c.broken || lifecycle === 'broken') {
      summary.condition = 'broken';
      summary.broken = true;
    } else if (lifecycle === 'opened') {
      summary.condition = 'opened';
    } else if (lifecycle === 'empty') {
      summary.condition = 'empty';
    } else if (c.durability !== undefined) {
      const parts: string[] = [];
      if ((c.rust ?? 0) >= 30) parts.push('rusty');
      if ((c.rot ?? 0) >= 30) parts.push('rotting');
      if (c.durability >= 80) parts.push(parts.length ? 'good' : 'good');
      else if (c.durability >= 50) parts.push('worn');
      else if (c.durability >= 20) parts.push('damaged');
      else parts.push('ruined');
      summary.condition = parts.join(', ');
    } else {
      const parts: string[] = [];
      if ((c.rust ?? 0) >= 30) parts.push('rusty');
      if ((c.rot ?? 0) >= 30) parts.push('rotting');
      if (parts.length) summary.condition = parts.join(', ');
    }
    populated = true;
  }

  if (entity.components.container?.sealed !== undefined) {
    summary.sealed = entity.components.container.sealed;
    populated = true;
  }

  if (entity.components.ownership?.legalOwnerId) {
    summary.owner = entity.components.ownership.legalOwnerId;
    populated = true;
  }

  return populated ? summary : undefined;
}

export function getItemLifecycleState(spine: SpineState, itemId: string): ItemLifecycleState {
  const entity = spine.entities[itemId];
  const explicit = entity?.components.lifecycle?.state;
  if (explicit) return explicit;
  if (entity?.components.condition?.broken) return 'broken';
  return 'intact';
}

export function isItemVisible(spine: SpineState, itemId: string): boolean {
  return getItemLifecycleState(spine, itemId) !== 'consumed';
}

export function isItemInteractable(spine: SpineState, itemId: string): boolean {
  const lifecycle = getItemLifecycleState(spine, itemId);
  return lifecycle !== 'consumed' && lifecycle !== 'broken' && lifecycle !== 'ruined' && lifecycle !== 'unusable';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validatePlacementTargetOrThrow(
  spine: SpineState,
  itemId: string,
  placement: ItemPlacement,
  locations: Record<string, LocationPOI>,
) {
  if (placement.type === 'carried_by' || placement.type === 'worn_by') {
    const actor = spine.entities[placement.actorId];
    if (!actor || actor.kind !== 'actor') {
      throw new SpineIntegrityError({
        issues: [{
          code: !actor ? 'missing_placement_target' : 'invalid_placement_target_kind',
          path: `spine.relations.${placement.type}:${itemId}:${placement.actorId}`,
          message: `Placement references non-existent actor ${placement.actorId}`,
          itemId,
          targetId: placement.actorId,
          placementType: placement.type,
        }],
      });
    }
    return;
  }

  if (placement.type === 'inside') {
    const container = spine.entities[placement.containerId];
    if (!container || container.kind !== 'container') {
      throw new SpineIntegrityError({
        issues: [{
          code: !container ? 'missing_placement_target' : 'invalid_placement_target_kind',
          path: `spine.relations.inside:${itemId}:${placement.containerId}`,
          message: !container
            ? `Placement references non-existent container ${placement.containerId}`
            : `Placement target ${placement.containerId} must be a container`,
          itemId,
          targetId: placement.containerId,
          placementType: placement.type,
        }],
      });
    }
    return;
  }

  if (placement.type === 'on') {
    const surface = spine.entities[placement.surfaceId];
    if (!surface || surface.kind !== 'surface') {
      throw new SpineIntegrityError({
        issues: [{
          code: !surface ? 'missing_placement_target' : 'invalid_placement_target_kind',
          path: `spine.relations.on:${itemId}:${placement.surfaceId}`,
          message: !surface
            ? `Placement references non-existent surface ${placement.surfaceId}`
            : `Placement target ${placement.surfaceId} must be a surface`,
          itemId,
          targetId: placement.surfaceId,
          placementType: placement.type,
        }],
      });
    }
    return;
  }

  if (!locations[placement.locationId]) {
    throw new SpineIntegrityError({
      issues: [{
        code: 'missing_placement_target',
        path: `spine.relations.located_in:${itemId}:${placement.locationId}`,
        message: `Placement references non-existent location ${placement.locationId}`,
        itemId,
        targetId: placement.locationId,
        placementType: placement.type,
      }],
    });
  }
  if (!isGridPos(placement.anchor)) {
    throw new SpineIntegrityError({
      issues: [{
        code: 'missing_location_anchor',
        path: `spine.entities.${itemId}.components.location.anchor`,
        message: `Located item ${itemId} is missing an anchor`,
        itemId,
        placementType: placement.type,
      }],
    });
  }
}

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

function buildFactionEntity(faction: FactionEntity): SpineEntity {
  return {
    id: faction.id,
    kind: 'faction',
    archetype: 'faction.group',
    name: faction.name,
    tags: faction.tags,
    components: {
      identity: { tags: faction.tags },
      faction: { memberCount: faction.memberIds.length },
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
  const preset = getArchetypePreset(item.archetype);
  const merged = mergeItemComponents(preset, item.components);

  merged.identity = item.description
    ? { ...merged.identity, aliases: [item.description, ...(merged.identity?.aliases ?? [])] }
    : merged.identity;

  merged.location = placement.type === 'located_in'
    ? {
        ...merged.location,
        anchor: placement.anchor,
        terrain: locations[placement.locationId]?.terrain ?? resolveContainingLocation(placement.anchor, locations)?.terrain,
      }
    : undefined;

  return {
    id: item.id,
    kind: 'item',
    archetype: item.archetype || 'item.generic',
    name: item.name,
    tags: item.tags,
    components: merged,
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

function collectEntityIdsByKind(spine: SpineState, kind: SpineEntity['kind']): string[] {
  const indexed = spine.indexes.byType[kind];
  if (indexed?.length) return [...indexed];
  return Object.values(spine.entities)
    .filter(entity => entity.kind === kind)
    .map(entity => entity.id);
}

function getItemPlacementRelations(spine: SpineState, itemId: string): SpineRelation[] {
  const relationIds = spine.indexes.byFrom[itemId] || Object.keys(spine.relations);
  return relationIds
    .map(id => spine.relations[id])
    .filter((relation): relation is SpineRelation => {
      return !!relation && relation.from === itemId && ITEM_PLACEMENT_RELATION_TYPES.includes(relation.type as ItemPlacementRelationType);
    });
}

function getItemPlacementRelationsFromRelations(spine: SpineState, itemId: string): SpineRelation[] {
  return Object.values(spine.relations).filter(relation => {
    return relation.from === itemId && ITEM_PLACEMENT_RELATION_TYPES.includes(relation.type as ItemPlacementRelationType);
  });
}

function validateEntityTarget(
  issues: SpineIntegrityIssue[],
  spine: SpineState,
  relation: SpineRelation,
  itemId: string,
  existsInContext: boolean,
  expectedKind: SpineEntity['kind'],
  missingMessage: string,
) {
  const target = spine.entities[relation.to];
  if (!existsInContext || !target) {
    issues.push({
      code: 'missing_placement_target',
      path: `spine.relations.${relation.id}`,
      message: missingMessage,
      itemId,
      relationId: relation.id,
      targetId: relation.to,
      placementType: relation.type as SpinePlacementType,
    });
    return;
  }
  if (target.kind !== expectedKind) {
    issues.push({
      code: 'invalid_placement_target_kind',
      path: `spine.relations.${relation.id}`,
      message: `Placement target ${relation.to} must be a ${expectedKind}`,
      itemId,
      relationId: relation.id,
      targetId: relation.to,
      placementType: relation.type as SpinePlacementType,
    });
  }
}

function appendRelationIndexIssues(
  issues: SpineIntegrityIssue[],
  spine: SpineState,
  indexName: 'byFrom' | 'byTo' | 'byRelationType',
  actual: Record<string, SpineRelationId[]>,
  expected: Record<string, SpineRelationId[]>,
) {
  const bucketKeys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const bucketKey of bucketKeys) {
    const actualBucket = actual[bucketKey] || [];
    const expectedBucket = expected[bucketKey] || [];
    const actualSet = new Set(actualBucket);
    const expectedSet = new Set(expectedBucket);

    if (actualSet.size !== actualBucket.length) {
      issues.push({
        code: 'index_relation_mismatch',
        path: `spine.indexes.${indexName}.${bucketKey}`,
        message: `Index ${indexName}.${bucketKey} contains duplicate relation ids`,
      });
    }

    for (const relationId of expectedBucket) {
      if (!actualSet.has(relationId)) {
        issues.push({
          code: 'index_missing_relation',
          path: `spine.indexes.${indexName}.${bucketKey}`,
          message: `Index ${indexName}.${bucketKey} is missing relation ${relationId}`,
          relationId,
        });
      }
    }

    for (const relationId of actualBucket) {
      if (expectedSet.has(relationId)) continue;
      const relation = spine.relations[relationId];
      issues.push({
        code: relation ? 'index_relation_mismatch' : 'index_dangling_relation',
        path: `spine.indexes.${indexName}.${bucketKey}`,
        message: relation
          ? `Index ${indexName}.${bucketKey} incorrectly includes relation ${relationId}`
          : `Index ${indexName}.${bucketKey} references missing relation ${relationId}`,
        relationId,
      });
    }
  }
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

function isGridPos(value: unknown): value is GridPos {
  return !!value
    && typeof value === 'object'
    && typeof (value as GridPos).x === 'number'
    && typeof (value as GridPos).y === 'number';
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
