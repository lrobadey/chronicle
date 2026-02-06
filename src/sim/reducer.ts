import type { WorldEvent } from './events';
import type { KnowledgeState, WorldState } from './state';
import { deriveTide, isTideBlocked } from './systems/tide';
import { deriveConstraints } from './systems/constraints';
import { distance, locationsWithinRadius } from './utils';
import { resolveMoveTarget } from './validate';
import { estimateTravel, positionToward } from './systems/travel';

const DEFAULT_VIS_RADIUS = 120;

export function applyEvent(state: WorldState, event: WorldEvent): WorldState {
  switch (event.type) {
    case 'MoveActor':
      return applyMoveActor(state, event);
    case 'TravelToLocation':
      return applyTravelToLocation(state, event);
    case 'Explore':
      return applyExplore(state, event);
    case 'Inspect':
      return applyInspect(state, event);
    case 'PickUpItem':
      return applyPickUpItem(state, event);
    case 'DropItem':
      return applyDropItem(state, event);
    case 'Speak':
      return addLedger(state, event.note || `${state.actors[event.actorId]?.name || 'Someone'} speaks`);
    case 'AdvanceTime':
      return advanceTime(state, event.minutes, event.note);
    case 'CreateEntity':
      return applyCreateEntity(state, event);
    case 'SetFlag':
      return addLedger(state, event.note || `Flag ${event.key} updated`);
    default:
      return state;
  }
}

export function applyEvents(state: WorldState, events: WorldEvent[]): WorldState {
  let next = state;
  for (const event of events) {
    next = applyEvent(next, event);
  }
  return next;
}

function applyMoveActor(state: WorldState, event: Extract<WorldEvent, { type: 'MoveActor' }>): WorldState {
  const actor = state.actors[event.actorId];
  if (!actor) return state;
  const dest = resolveMoveTarget(state, event);
  if (!dest) return state;

  const next = cloneState(state);
  next.actors[event.actorId] = { ...actor, pos: dest };

  const estimate = estimateTravel(state, actor.pos, dest, event.mode === 'run' ? 'run' : 'walk');
  const minutes = estimate.minutes;
  const distMeters = estimate.distanceMeters;

  next.systems.time.elapsedMinutes += minutes;
  addLedgerInPlace(next, event.note || `Traveled ${Math.round(distMeters)}m in ${minutes} min`);

  if (actor.kind === 'player') {
    updateKnowledgeForActor(next, actor.id);
  }

  return next;
}

function applyTravelToLocation(state: WorldState, event: Extract<WorldEvent, { type: 'TravelToLocation' }>): WorldState {
  const actor = state.actors[event.actorId];
  const location = state.locations[event.locationId];
  if (!actor || !location) return state;

  const next = cloneState(state);
  const pace = event.pace === 'run' ? 'run' : 'walk';
  const fullEstimate = estimateTravel(next, actor.pos, location.anchor, pace);
  const arrivalElapsed = next.systems.time.elapsedMinutes + fullEstimate.minutes;
  const tideBlocked = isLocationBlockedAtElapsed(next, location.id, arrivalElapsed);

  let destination = location.anchor;
  let note = event.note;

  if (tideBlocked) {
    const stopCells = (location.radiusCells ?? 20) + 1;
    destination = positionToward(location.anchor, actor.pos, stopCells);
    note = note || `Reached the edge of ${location.name}, but tide blocks entry`;
  } else {
    note = note || `Traveled to ${location.name}`;
  }

  const estimate = estimateTravel(next, actor.pos, destination, pace);
  next.actors[event.actorId] = { ...actor, pos: destination };
  next.systems.time.elapsedMinutes += estimate.minutes;
  addLedgerInPlace(next, note);

  if (actor.kind === 'player') {
    updateKnowledgeForActor(next, actor.id);
  }
  return next;
}

function applyExplore(state: WorldState, event: Extract<WorldEvent, { type: 'Explore' }>): WorldState {
  const actor = state.actors[event.actorId];
  if (!actor) return state;

  const next = cloneState(state);
  const constraints = deriveConstraints(next);
  const exploreMeters = Math.min(80, Math.max(20, Math.round(constraints.maxMoveMeters * 0.15)));
  const exploreCells = exploreMeters / state.map.cellSizeMeters;
  const vector = resolveExploreVector(event.area, event.direction);
  const candidate = {
    x: actor.pos.x + vector.x * exploreCells,
    y: actor.pos.y + vector.y * exploreCells,
    z: actor.pos.z ?? 0,
  };
  const destination = clampToBounds(next, candidate);

  next.actors[event.actorId] = { ...actor, pos: destination };
  next.systems.time.elapsedMinutes += 5;
  addLedgerInPlace(next, event.note || `Explored ${event.area.replace('_', ' ')}`);
  if (actor.kind === 'player') {
    updateKnowledgeForActor(next, actor.id);
  }
  return next;
}

function applyInspect(state: WorldState, event: Extract<WorldEvent, { type: 'Inspect' }>): WorldState {
  const actor = state.actors[event.actorId];
  if (!actor) return state;
  const next = cloneState(state);
  next.systems.time.elapsedMinutes += 2;
  addLedgerInPlace(next, event.note || `Inspected ${event.subject}`);
  if (actor.kind === 'player') {
    updateKnowledgeForActor(next, actor.id);
  }
  return next;
}

function applyPickUpItem(state: WorldState, event: Extract<WorldEvent, { type: 'PickUpItem' }>): WorldState {
  const actor = state.actors[event.actorId];
  const item = state.items[event.itemId];
  if (!actor || !item) return state;

  const next = cloneState(state);
  next.actors[event.actorId] = { ...actor, inventory: [...actor.inventory, item.id] };
  next.items[item.id] = { ...item, location: { kind: 'inventory', actorId: actor.id } };

  addLedgerInPlace(next, event.note || `Picked up ${item.name}`);
  if (actor.kind === 'player') updateKnowledgeForActor(next, actor.id);
  return next;
}

function applyDropItem(state: WorldState, event: Extract<WorldEvent, { type: 'DropItem' }>): WorldState {
  const actor = state.actors[event.actorId];
  const item = state.items[event.itemId];
  if (!actor || !item) return state;

  const next = cloneState(state);
  next.actors[event.actorId] = { ...actor, inventory: actor.inventory.filter(i => i !== item.id) };
  next.items[item.id] = { ...item, location: { kind: 'ground', pos: event.at || actor.pos } };
  addLedgerInPlace(next, event.note || `Dropped ${item.name}`);
  if (actor.kind === 'player') updateKnowledgeForActor(next, actor.id);
  return next;
}

function advanceTime(state: WorldState, minutes: number, note?: string): WorldState {
  const next = cloneState(state);
  next.systems.time.elapsedMinutes += minutes;
  addLedgerInPlace(next, note || `${minutes} minutes pass`);
  return next;
}

function applyCreateEntity(state: WorldState, event: Extract<WorldEvent, { type: 'CreateEntity' }>): WorldState {
  const next = cloneState(state);
  if (event.entity.kind === 'item') {
    next.items[event.entity.data.id] = {
      id: event.entity.data.id,
      name: event.entity.data.name,
      description: event.entity.data.description,
      location: event.entity.data.location,
    };
  } else if (event.entity.kind === 'npc') {
    next.actors[event.entity.data.id] = {
      id: event.entity.data.id,
      kind: 'npc',
      name: event.entity.data.name,
      pos: event.entity.data.pos,
      inventory: [],
    };
  } else if (event.entity.kind === 'location') {
    next.locations[event.entity.data.id] = {
      id: event.entity.data.id,
      name: event.entity.data.name,
      description: event.entity.data.description,
      anchor: event.entity.data.anchor,
    };
  }
  addLedgerInPlace(next, event.note || `Created ${event.entity.kind} ${event.entity.data.id}`);
  return next;
}

function addLedger(state: WorldState, text: string): WorldState {
  const next = cloneState(state);
  addLedgerInPlace(next, text);
  return next;
}

function addLedgerInPlace(state: WorldState, text: string) {
  state.ledger = [...state.ledger, { turn: state.meta.turn, text }];
}

function updateKnowledgeForActor(state: WorldState, actorId: string) {
  const actor = state.actors[actorId];
  if (!actor) return;
  const knowledge = state.knowledge[actorId] || { seenActors: {}, seenItems: {}, seenLocations: {}, notes: [] };

  const nearLocations = locationsWithinRadius(state, actor.pos, DEFAULT_VIS_RADIUS);
  for (const loc of nearLocations) {
    knowledge.seenLocations[loc.id] = true;
  }

  for (const other of Object.values(state.actors)) {
    if (distance(actor.pos, other.pos) <= DEFAULT_VIS_RADIUS) {
      knowledge.seenActors[other.id] = true;
    }
  }

  for (const item of Object.values(state.items)) {
    if (item.location.kind === 'ground' && distance(actor.pos, item.location.pos) <= DEFAULT_VIS_RADIUS) {
      knowledge.seenItems[item.id] = true;
    }
    if (item.location.kind === 'inventory' && item.location.actorId === actor.id) {
      knowledge.seenItems[item.id] = true;
    }
  }

  state.knowledge[actorId] = knowledge;
}

function cloneState(state: WorldState): WorldState {
  return JSON.parse(JSON.stringify(state)) as WorldState;
}

function isLocationBlockedAtElapsed(state: WorldState, locationId: string, elapsedMinutes: number) {
  const snapshot = cloneState(state);
  snapshot.systems.time.elapsedMinutes = elapsedMinutes;
  const location = snapshot.locations[locationId];
  if (!location) return false;
  return isTideBlocked(location, deriveTide(snapshot));
}

function resolveExploreVector(area: 'shoreline' | 'docks' | 'under_ribs' | 'around_here', direction?: 'east' | 'west' | 'north' | 'south') {
  if (direction === 'east') return { x: 1, y: 0 };
  if (direction === 'west') return { x: -1, y: 0 };
  if (direction === 'north') return { x: 0, y: 1 };
  if (direction === 'south') return { x: 0, y: -1 };
  if (area === 'shoreline') return { x: 1, y: 0 };
  if (area === 'docks') return { x: 0.5, y: 0.5 };
  if (area === 'under_ribs') return { x: 0, y: 1 };
  return { x: 0.7, y: 0.3 };
}

function clampToBounds(state: WorldState, pos: { x: number; y: number; z?: number }) {
  const { minX, minY, maxX, maxY } = state.map;
  return {
    x: Math.max(minX, Math.min(maxX, pos.x)),
    y: Math.max(minY, Math.min(maxY, pos.y)),
    z: pos.z ?? 0,
  };
}
