import { createEmptyWorldGraph, type Direction, type Entity, type EntityId, type Relation, type WorldGraph, P, PREDICATES, makeEntityId, type Position2D } from './graph';

export interface GraphStore {
  graph: WorldGraph;
  addEntity(entity: Entity): void;
  updateEntity(id: EntityId, props: Partial<Entity['props']> & Record<string, any>): void;
  getEntity(id: EntityId): Entity | undefined;
  addRelation(rel: Relation): void;
  removeRelation(id: string): void;
  getRelationsBySubject(id: EntityId): Relation[];
  getRelationsByPredicate(pred: string): Relation[];
  getRelationsByObject(id: EntityId): Relation[];
  // Spatial helpers
  getLocatedIn(entityId: EntityId): Relation | undefined;
  getExitsFrom(locationId: EntityId): Array<{ direction: string; to: EntityId }>;
  getPosition(id: EntityId): Position2D | undefined;
  setPosition(id: EntityId, pos: Position2D): { ok: true };
  distance(a: EntityId, b: EntityId): number | undefined;
  getExitsWithCosts(locationId: EntityId): Array<{ direction: string; to: EntityId; cost: number }>;
  // Write operations
  createEntity(params: { type: string; props?: Record<string, any>; tags?: string[]; id?: EntityId }): { id: EntityId };
  updateEntityProps(id: EntityId, props: Record<string, any>): { ok: true };
  createRelation(params: { subj: EntityId; pred: string; obj: EntityId; props?: Record<string, any> }): { id: string };
  moveEntity(params: { entityId: EntityId; toLocationId: EntityId }): { ok: true; note: string };
  transferItem(params: { itemId: EntityId; fromEntityId: EntityId; toEntityId: EntityId }): { ok: true; note: string };
}

export function createGraphStore(): GraphStore {
  const graph = createEmptyWorldGraph();

  function indexRelation(rel: Relation) {
    (graph.bySubj[rel.subj] ||= []).push(rel.id);
    (graph.byObj[rel.obj] ||= []).push(rel.id);
    (graph.byPred[rel.pred] ||= []).push(rel.id);
  }

  function deindexRelation(rel: Relation) {
    const pull = (arr?: string[]) => arr ? arr.filter((x) => x !== rel.id) : arr;
    graph.bySubj[rel.subj] = pull(graph.bySubj[rel.subj]) || [];
    graph.byObj[rel.obj] = pull(graph.byObj[rel.obj]) || [];
    graph.byPred[rel.pred] = pull(graph.byPred[rel.pred]) || [];
  }

  function assertEntityType(id: EntityId, type: string) {
    const e = graph.entities[id];
    if (!e) throw new Error(`Entity ${id} not found`);
    if (e.type !== type) throw new Error(`Entity ${id} must be type ${type}, got ${e.type}`);
  }

  function addEntity(entity: Entity) {
    if (graph.entities[entity.id]) throw new Error(`Entity ${entity.id} already exists`);
    graph.entities[entity.id] = { ...entity, props: entity.props || {}, tags: entity.tags || [] };
  }

  function updateEntity(id: EntityId, props: Record<string, any>) {
    const e = graph.entities[id];
    if (!e) throw new Error(`Entity ${id} not found`);
    e.props = { ...(e.props || {}), ...props };
  }

  function getEntity(id: EntityId) {
    return graph.entities[id];
  }

  function validateRelation(rel: Relation, allowReplacement = false) {
    const spec = PREDICATES[rel.pred];
    if (spec) {
      // Validate subject type
      const subjEntity = graph.entities[rel.subj];
      if (!subjEntity) throw new Error(`Subject entity ${rel.subj} not found`);
      if (!spec.subjTypes.includes(subjEntity.type)) {
        throw new Error(`Predicate ${rel.pred} requires subject type in [${spec.subjTypes.join(', ')}], got ${subjEntity.type}`);
      }
      // Validate object type
      const objEntity = graph.entities[rel.obj];
      if (!objEntity) throw new Error(`Object entity ${rel.obj} not found`);
      if (!spec.objTypes.includes(objEntity.type)) {
        throw new Error(`Predicate ${rel.pred} requires object type in [${spec.objTypes.join(', ')}], got ${objEntity.type}`);
      }
      // Validate required props
      if (spec.requiredProps) {
        for (const [key, expectedType] of Object.entries(spec.requiredProps)) {
          const value = rel.props?.[key];
          if (value === undefined) throw new Error(`Predicate ${rel.pred} requires prop.${key}`);
          const actualType = typeof value;
          if (actualType !== expectedType) {
            throw new Error(`Predicate ${rel.pred} prop.${key} must be ${expectedType}, got ${actualType}`);
          }
        }
      }
      // Check invariants
      if (spec.invariants?.includes('uniqueLocatedIn')) {
        const existing = getLocatedIn(rel.subj);
        if (existing && existing.id !== rel.id && !allowReplacement) {
          throw new Error(`Entity ${rel.subj} already has located_in: ${existing.obj}`);
        }
      }
    } else {
      // Unknown predicate - allow but warn
      console.warn(`Unknown predicate: ${rel.pred}`);
    }
  }

  function addRelation(rel: Relation, allowReplacement = false) {
    if (graph.relations[rel.id] && !allowReplacement) throw new Error(`Relation ${rel.id} already exists`);
    validateRelation(rel, allowReplacement);
    graph.relations[rel.id] = { ...rel, directed: rel.directed !== false };
    indexRelation(rel);
  }

  function removeRelation(id: string) {
    const rel = graph.relations[id];
    if (!rel) return;
    deindexRelation(rel);
    delete graph.relations[id];
  }

  function byIds(ids: string[]): Relation[] {
    return ids.map((id) => graph.relations[id]).filter(Boolean) as Relation[];
  }

  function getRelationsBySubject(id: EntityId): Relation[] {
    return byIds(graph.bySubj[id] || []);
  }

  function getRelationsByPredicate(pred: string): Relation[] {
    return byIds(graph.byPred[pred] || []);
  }

  function getRelationsByObject(id: EntityId): Relation[] {
    return byIds(graph.byObj[id] || []);
  }

  function getLocatedIn(entityId: EntityId): Relation | undefined {
    const candidates = getRelationsBySubject(entityId).filter((r) => r.pred === P.located_in);
    return candidates[0];
  }

  function getExitsFrom(locationId: EntityId): Array<{ direction: string; to: EntityId }> {
    return getRelationsBySubject(locationId)
      .filter((r) => r.pred === P.exit_to)
      .map((r) => ({ direction: String(r.props?.direction || ''), to: r.obj }));
  }

  function getPosition(id: EntityId): Position2D | undefined {
    const e = getEntity(id);
    const pos = e?.props?.pos;
    if (pos && typeof pos === 'object' && typeof pos.x === 'number' && typeof pos.y === 'number') {
      return { x: pos.x, y: pos.y, z: typeof pos.z === 'number' ? pos.z : undefined };
    }
    return undefined;
  }

  function setPosition(id: EntityId, pos: Position2D): { ok: true } {
    updateEntity(id, { pos });
    return { ok: true };
  }

  function distance(a: EntityId, b: EntityId): number | undefined {
    const pa = getPosition(a);
    const pb = getPosition(b);
    if (!pa || !pb) return undefined;
    const dx = pa.x - pb.x;
    const dy = pa.y - pb.y;
    const dz = (pa.z ?? 0) - (pb.z ?? 0);
    return Math.hypot(dx, dy, dz);
  }

  function getExitsWithCosts(locationId: EntityId): Array<{ direction: string; to: EntityId; cost: number }> {
    return getExitsFrom(locationId).map((e) => ({
      direction: e.direction,
      to: e.to,
      cost: distance(locationId, e.to) ?? 1,
    }));
  }

  // Write operations
  function createEntity(params: { type: string; props?: Record<string, any>; tags?: string[]; id?: EntityId }): { id: EntityId } {
    const id = params.id || makeEntityId(params.type, params.props?.name);
    const entity: Entity = {
      id,
      type: params.type,
      props: params.props || {},
      tags: params.tags || [],
    };
    addEntity(entity);
    return { id };
  }

  function updateEntityProps(id: EntityId, props: Record<string, any>): { ok: true } {
    updateEntity(id, props);
    return { ok: true };
  }

  function createRelation(params: { subj: EntityId; pred: string; obj: EntityId; props?: Record<string, any> }): { id: string } {
    const relId = `${params.pred}:${params.subj}:${params.obj}:${JSON.stringify(params.props || {})}`;
    const rel: Relation = {
      id: relId,
      subj: params.subj,
      pred: params.pred,
      obj: params.obj,
      props: params.props || {},
      directed: true,
    };
    addRelation(rel);
    return { id: relId };
  }

  function moveEntity(params: { entityId: EntityId; toLocationId: EntityId }): { ok: true; note: string } {
    const current = getLocatedIn(params.entityId);
    if (!current) throw new Error(`Entity ${params.entityId} has no current location`);
    const fromLocId = current.obj;
    if (fromLocId === params.toLocationId) {
      return { ok: true, note: `Entity ${params.entityId} is already at ${params.toLocationId}` };
    }
    // Movement is now coordinate-based; no exit validation needed
    // Remove old, add new
    removeRelation(current.id);
    const newRelId = `located_in:${params.entityId}`;
    addRelation({ id: newRelId, subj: params.entityId, pred: P.located_in, obj: params.toLocationId }, true);
    const fromEntity = getEntity(fromLocId);
    const toEntity = getEntity(params.toLocationId);
    const note = `Moved ${params.entityId} from ${fromEntity?.props?.name || fromLocId} to ${toEntity?.props?.name || params.toLocationId}`;
    return { ok: true, note };
  }

  function transferItem(params: { itemId: EntityId; fromEntityId: EntityId; toEntityId: EntityId }): { ok: true; note: string } {
    const fromRels = getRelationsBySubject(params.fromEntityId).filter((r) => r.pred === P.contains && r.obj === params.itemId);
    if (!fromRels.length) {
      throw new Error(`Entity ${params.fromEntityId} does not contain item ${params.itemId}`);
    }
    const oldRel = fromRels[0];
    removeRelation(oldRel.id);
    const newRelId = `contains:${params.toEntityId}:${params.itemId}`;
    addRelation({ id: newRelId, subj: params.toEntityId, pred: P.contains, obj: params.itemId });
    const fromEntity = getEntity(params.fromEntityId);
    const toEntity = getEntity(params.toEntityId);
    const itemEntity = getEntity(params.itemId);
    const note = `Transferred ${itemEntity?.props?.name || params.itemId} from ${fromEntity?.props?.name || params.fromEntityId} to ${toEntity?.props?.name || params.toEntityId}`;
    return { ok: true, note };
  }

  const store: GraphStore = {
    graph,
    addEntity,
    updateEntity,
    getEntity,
    addRelation,
    removeRelation,
    getRelationsBySubject,
    getRelationsByPredicate,
    getRelationsByObject,
    getLocatedIn,
    getExitsFrom,
    getPosition,
    setPosition,
    distance,
    getExitsWithCosts,
    createEntity,
    updateEntityProps,
    createRelation,
    moveEntity,
    transferItem,
  };

  return store;
}

// Seeding from the current SimpleWorld (temporary bootstrap)
import type { SimpleWorld } from './world';

function autoLayoutMissingPositions(store: GraphStore): void {
  const dirVec: Record<string, { dx: number; dy: number }> = {
    north: { dx: 0, dy: -1 },
    south: { dx: 0, dy: 1 },
    east: { dx: 1, dy: 0 },
    west: { dx: -1, dy: 0 },
  };

  const locIds = Object.values(store.graph.entities)
    .filter((e) => e.type === 'location')
    .map((e) => e.id);

  if (!locIds.length) return;

  const pos = new Map<EntityId, { x: number; y: number }>();
  const visited = new Set<EntityId>();

  // Find starting location (prefer player's location, otherwise first location)
  let start: EntityId | undefined;
  const actors = Object.values(store.graph.entities).filter((e) => e.type === 'actor');
  if (actors.length > 0) {
    const playerLoc = store.getLocatedIn(actors[0].id);
    start = playerLoc?.obj;
  }
  if (!start) {
    start = locIds[0];
  }
  
  if (!start) return;

  // Check if start already has position
  const startEntity = store.getEntity(start);
  if (startEntity?.props?.pos) {
    const p = startEntity.props.pos as Position2D;
    pos.set(start, { x: p.x, y: p.y });
  } else {
    pos.set(start, { x: 0, y: 0 });
  }

  const queue: EntityId[] = [start];
  visited.add(start);

  while (queue.length > 0) {
    const from = queue.shift()!;
    const fromPos = pos.get(from);
    if (!fromPos) continue;

    const exits = store.getExitsFrom(from);
    for (const { direction, to } of exits) {
      if (visited.has(to)) continue;

      const entity = store.getEntity(to);
      // Skip if already has position
      if (entity?.props?.pos) {
        const p = entity.props.pos as Position2D;
        pos.set(to, { x: p.x, y: p.y });
        visited.add(to);
        continue;
      }

      const vec = dirVec[direction];
      if (vec) {
        pos.set(to, { x: fromPos.x + vec.dx, y: fromPos.y + vec.dy });
        visited.add(to);
        queue.push(to);
      }
    }
  }

  // Update entities with missing positions
  for (const id of locIds) {
    const p = pos.get(id);
    const e = store.getEntity(id);
    if (p && e && !e.props?.pos) {
      store.updateEntityProps(id, { pos: p });
    }
  }
}

export function seedGraphFromSimpleWorld(store: GraphStore, world: SimpleWorld) {
  // Entities
  const startingLoc = world.locations[world.player.location];
  const playerPos = world.player.pos || startingLoc?.coords;
  const actorProps: Record<string, any> = {};
  if (playerPos) {
    actorProps.pos = { x: playerPos.x, y: playerPos.y, ...(playerPos.z !== undefined ? { z: playerPos.z } : {}) };
  }
  store.addEntity({ id: world.player.id, type: 'actor', props: actorProps });
  for (const [locId, loc] of Object.entries(world.locations)) {
    // Copy coords from SimpleWorldLocation to entity props.pos
    const pos = loc.coords ? { x: loc.coords.x, y: loc.coords.y, z: loc.coords.z } : undefined;
    const props: Record<string, any> = { name: loc.name, description: loc.description };
    if (pos) {
      props.pos = pos;
    }
    store.addEntity({ id: locId, type: 'location', props });
    for (const item of loc.items || []) {
      if (!store.getEntity(item.id)) store.addEntity({ id: item.id, type: 'item', props: { name: item.name } });
      store.addRelation({ id: `contains:${locId}:${item.id}`, subj: locId, pred: P.contains, obj: item.id });
    }
  }
  // No exit system; movement is coordinate-based
  // Player position
  store.addRelation({ id: `located_in:${world.player.id}`, subj: world.player.id, pred: P.located_in, obj: world.player.location });
  
  // Auto-layout missing positions
  autoLayoutMissingPositions(store);
}


