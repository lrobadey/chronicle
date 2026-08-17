/**
 * Chronicle v4 - Entity Graph
 * 
 * Consolidated graph system: types, store, context, and PKG projection.
 * Merged from v3's graph.ts, graphStore.ts, graphContext.ts, and pkg.ts.
 */

import type { World, Position } from './world';

// ============================================================================
// TYPES
// ============================================================================

export type EntityId = string;

export interface Entity {
  id: EntityId;
  type: 'location' | 'actor' | 'item' | 'region' | string;
  props?: Record<string, unknown>;
  tags?: string[];
}

export interface Relation {
  id: string;
  subj: EntityId;
  pred: string;
  obj: EntityId;
  directed?: boolean;
  props?: Record<string, unknown>;
}

export interface WorldGraph {
  entities: Record<EntityId, Entity>;
  relations: Record<string, Relation>;
  bySubj: Record<EntityId, string[]>;
  byObj: Record<EntityId, string[]>;
  byPred: Record<string, string[]>;
}

// Standard predicates
export const P = {
  exit_to: 'exit_to',
  located_in: 'located_in',
  contains: 'contains',
} as const;

// ============================================================================
// GRAPH STORE
// ============================================================================

export interface GraphStore {
  graph: WorldGraph;
  addEntity(entity: Entity): void;
  getEntity(id: EntityId): Entity | undefined;
  updateEntity(id: EntityId, props: Record<string, unknown>): void;
  addRelation(rel: Relation): void;
  removeRelation(id: string): void;
  getRelationsBySubject(id: EntityId): Relation[];
  getRelationsByPredicate(pred: string): Relation[];
  getRelationsByObject(id: EntityId): Relation[];
  getLocatedIn(entityId: EntityId): Relation | undefined;
  getPosition(id: EntityId): Position | undefined;
  setPosition(id: EntityId, pos: Position): void;
  createEntity(params: { type: string; props?: Record<string, unknown>; id?: EntityId }): { id: EntityId };
  createRelation(params: { subj: EntityId; pred: string; obj: EntityId; props?: Record<string, unknown> }): { id: string };
}

export function createGraphStore(): GraphStore {
  const graph: WorldGraph = { 
    entities: {}, 
    relations: {}, 
    bySubj: {}, 
    byObj: {}, 
    byPred: {} 
  };

  function indexRelation(rel: Relation) {
    (graph.bySubj[rel.subj] ||= []).push(rel.id);
    (graph.byObj[rel.obj] ||= []).push(rel.id);
    (graph.byPred[rel.pred] ||= []).push(rel.id);
  }

  function deindexRelation(rel: Relation) {
    const pull = (arr?: string[]) => arr?.filter((x) => x !== rel.id) || [];
    graph.bySubj[rel.subj] = pull(graph.bySubj[rel.subj]);
    graph.byObj[rel.obj] = pull(graph.byObj[rel.obj]);
    graph.byPred[rel.pred] = pull(graph.byPred[rel.pred]);
  }

  function addEntity(entity: Entity) {
    if (graph.entities[entity.id]) throw new Error(`Entity ${entity.id} already exists`);
    graph.entities[entity.id] = { ...entity, props: entity.props || {}, tags: entity.tags || [] };
  }

  function getEntity(id: EntityId) {
    return graph.entities[id];
  }

  function updateEntity(id: EntityId, props: Record<string, unknown>) {
    const e = graph.entities[id];
    if (!e) throw new Error(`Entity ${id} not found`);
    e.props = { ...(e.props || {}), ...props };
  }

  function addRelation(rel: Relation) {
    if (graph.relations[rel.id]) {
      // Allow replacement for located_in
      if (rel.pred === P.located_in) {
        deindexRelation(graph.relations[rel.id]);
      } else {
        throw new Error(`Relation ${rel.id} already exists`);
      }
    }
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
    return getRelationsBySubject(entityId).find((r) => r.pred === P.located_in);
  }

  function getPosition(id: EntityId): Position | undefined {
    const e = getEntity(id);
    const pos = e?.props?.pos as Position | undefined;
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      return { x: pos.x, y: pos.y, z: typeof pos.z === 'number' ? pos.z : undefined };
    }
    return undefined;
  }

  function setPosition(id: EntityId, pos: Position) {
    updateEntity(id, { pos });
  }

  function createEntity(params: { type: string; props?: Record<string, unknown>; id?: EntityId }): { id: EntityId } {
    const id = params.id || makeEntityId(params.type, params.props?.name as string | undefined);
    addEntity({ id, type: params.type, props: params.props || {} });
    return { id };
  }

  function createRelation(params: { subj: EntityId; pred: string; obj: EntityId; props?: Record<string, unknown> }): { id: string } {
    const id = `${params.pred}:${params.subj}:${params.obj}`;
    addRelation({ id, subj: params.subj, pred: params.pred, obj: params.obj, props: params.props || {} });
    return { id };
  }

  return {
    graph,
    addEntity,
    getEntity,
    updateEntity,
    addRelation,
    removeRelation,
    getRelationsBySubject,
    getRelationsByPredicate,
    getRelationsByObject,
    getLocatedIn,
    getPosition,
    setPosition,
    createEntity,
    createRelation,
  };
}

function makeEntityId(type: string, suggestedName?: string): EntityId {
  if (suggestedName) {
    const slug = suggestedName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return `${type}-${slug}`;
  }
  return `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// GRAPH CONTEXT (Seeding from World)
// ============================================================================

let globalStore: GraphStore | null = null;
let seededSignature: string | null = null;

function worldSignature(world: World): string {
  return JSON.stringify({
    player: world.player.id,
    locs: Object.keys(world.locations).sort(),
  });
}

export function ensureSeededFromWorld(world: World): GraphStore {
  const sig = worldSignature(world);
  
  if (globalStore && seededSignature === sig) {
    return globalStore;
  }

  globalStore = createGraphStore();
  seedGraphFromWorld(globalStore, world);
  seededSignature = sig;
  return globalStore;
}

export function getGraphStore(): GraphStore {
  if (!globalStore) throw new Error('Graph store not initialized');
  return globalStore;
}

/** Reset the cached graph store (useful for testing) */
export function resetGraphStore(): void {
  globalStore = null;
  seededSignature = null;
}

function seedGraphFromWorld(store: GraphStore, world: World) {
  // Add player
  const playerPos = world.player.pos || world.locations[world.player.location]?.coords;
  store.addEntity({ 
    id: world.player.id, 
    type: 'actor', 
    props: playerPos ? { pos: playerPos } : {} 
  });

  // Add locations and items
  for (const [locId, loc] of Object.entries(world.locations)) {
    const props: Record<string, unknown> = { name: loc.name, description: loc.description };
    if (loc.coords) props.pos = loc.coords;
    store.addEntity({ id: locId, type: 'location', props });
    
    for (const item of loc.items || []) {
      if (!store.getEntity(item.id)) {
        store.addEntity({ id: item.id, type: 'item', props: { name: item.name } });
      }
      store.addRelation({ id: `contains:${locId}:${item.id}`, subj: locId, pred: P.contains, obj: item.id });
    }
  }

  // Player location
  store.addRelation({ 
    id: `located_in:${world.player.id}`, 
    subj: world.player.id, 
    pred: P.located_in, 
    obj: world.player.location 
  });
}

// ============================================================================
// PKG (Player Knowledge Graph) PROJECTION
// ============================================================================

export interface PKG {
  playerId: string;
  currentLocationId: string;
  knownLocations: Array<{
    id: string;
    name: string;
    visited: boolean;
  }>;
  knownNPCs: Array<{
    id: string;
    name: string;
    location?: string;
  }>;
  knownItems: Array<{
    id: string;
    name: string;
    inInventory: boolean;
  }>;
  nearbyDirections: Array<{
    direction: string;
    locationId?: string;
    locationName?: string;
    distance?: number;
  }>;
}

export function projectPKG(world: World): PKG {
  const store = ensureSeededFromWorld(world);
  const playerId = world.player.id;
  const located = store.getLocatedIn(playerId);
  const currentLocationId = located?.obj || world.player.location;
  
  // Parse ledger to find visited locations
  const visitedLocations = new Set<string>([currentLocationId]);
  const ledgerText = world.ledger.join(' ').toLowerCase();
  for (const [id, loc] of Object.entries(world.locations)) {
    if (ledgerText.includes(loc.name.toLowerCase()) || ledgerText.includes(id.toLowerCase())) {
      visitedLocations.add(id);
    }
  }

  // Known locations
  const playerPos = world.player.pos || world.locations[currentLocationId]?.coords || { x: 0, y: 0 };
  const knownLocations: PKG['knownLocations'] = [];
  
  for (const [id, loc] of Object.entries(world.locations)) {
    const visited = visitedLocations.has(id);
    const locPos = loc.coords;
    const isNearby = locPos && id !== currentLocationId && 
      Math.hypot(locPos.x - playerPos.x, locPos.y - playerPos.y) < 100;
    
    if (visited || isNearby || id === currentLocationId) {
      knownLocations.push({ id, name: loc.name, visited });
    }
  }

  // Known NPCs
  const knownNPCs: PKG['knownNPCs'] = [];
  if (world.npcs) {
    for (const [id, npc] of Object.entries(world.npcs)) {
      if (npc.location === currentLocationId || ledgerText.includes(npc.name.toLowerCase())) {
        knownNPCs.push({ id, name: npc.name, location: npc.location });
      }
    }
  }

  // Known items
  const knownItems: PKG['knownItems'] = [];
  const contains = store.getRelationsBySubject(currentLocationId).filter((r) => r.pred === P.contains);
  
  for (const item of world.player.inventory) {
    knownItems.push({ id: item.id, name: item.name, inInventory: true });
  }
  
  for (const rel of contains) {
    const entity = store.getEntity(rel.obj);
    if (entity) {
      knownItems.push({ 
        id: entity.id, 
        name: String(entity.props?.name || entity.id), 
        inInventory: false 
      });
    }
  }

  // Nearby directions
  const nearbyDirections: PKG['nearbyDirections'] = [];
  for (const [id, loc] of Object.entries(world.locations)) {
    if (id === currentLocationId || !loc.coords) continue;
    
    const dx = loc.coords.x - playerPos.x;
    const dy = loc.coords.y - playerPos.y;
    const dist = Math.hypot(dx, dy);
    
    if (dist < 150 && dist > 0.1) {
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const direction = angle >= -45 && angle < 45 ? 'east' :
                       angle >= 45 && angle < 135 ? 'north' :
                       angle >= 135 || angle < -135 ? 'west' : 'south';
      
      nearbyDirections.push({ direction, locationId: id, locationName: loc.name, distance: Math.round(dist) });
    }
  }

  return { playerId, currentLocationId, knownLocations, knownNPCs, knownItems, nearbyDirections };
}

