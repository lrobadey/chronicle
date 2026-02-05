import type { WorldEvent } from './events';
import type { KnowledgeState, WorldState } from './state';
import { deriveWeather, weatherTravelMultiplier } from './systems/weather';
import { distance, findNearestLocation, locationsWithinRadius } from './utils';
import { resolveMoveTarget } from './validate';

const DEFAULT_VIS_RADIUS = 120;

export function applyEvent(state: WorldState, event: WorldEvent): WorldState {
  switch (event.type) {
    case 'MoveActor':
      return applyMoveActor(state, event);
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

  const distMeters = distance(actor.pos, dest) * state.map.cellSizeMeters;
  const weather = deriveWeather(state);
  const weatherMult = weatherTravelMultiplier(weather);
  const terrainMult = getTerrainMultiplier(state, dest);
  const baseSpeed = event.mode === 'run' ? 2.0 : 1.4;
  const minutes = Math.max(1, Math.round((distMeters / baseSpeed / 60) * terrainMult * weatherMult));

  next.systems.time.elapsedMinutes += minutes;
  addLedgerInPlace(next, event.note || `Traveled ${Math.round(distMeters)}m in ${minutes} min`);

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

function getTerrainMultiplier(state: WorldState, pos: { x: number; y: number; z?: number }): number {
  const loc = findNearestLocation(state, pos);
  const terrain = loc?.terrain ?? 'unknown';
  switch (terrain) {
    case 'road': return 0.8;
    case 'path': return 1.0;
    case 'beach': return 1.2;
    case 'forest': return 1.5;
    case 'mountain': return 2.5;
    case 'water': return 3.0;
    case 'interior': return 0.9;
    case 'cavern': return 1.4;
    case 'unknown': default: return 1.0;
  }
}

function cloneState(state: WorldState): WorldState {
  return JSON.parse(JSON.stringify(state)) as WorldState;
}
