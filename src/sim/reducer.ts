import type { WorldEvent } from './events';
import type { KnowledgeState, WorldState } from './state';
import { getItemPlacement, setItemPlacement, syncWorldSpine } from './spine';
import { deriveTide, isTideBlocked } from './systems/tide';
import { deriveConstraints } from './systems/constraints';
import { distance, locationsWithinRadius } from './utils';
import { resolveMoveTarget } from './validate';
import { estimateTravel, positionToward } from './systems/travel';

const DEFAULT_VIS_RADIUS = 120;

export function applyEvent(state: WorldState, event: WorldEvent): WorldState {
  return applyEvents(state, [event]);
}

export function applyEvents(state: WorldState, events: WorldEvent[]): WorldState {
  let next = state;
  for (const event of events) {
    next = syncWorldSpine(applyEventBase(next, event));
  }
  return next;
}

function applyEventBase(state: WorldState, event: WorldEvent): WorldState {
  switch (event.type) {
    case 'MoveActor':
      return applyMoveActor(state, event);
    case 'TravelToLocation':
      return applyTravelToLocation(state, event);
    case 'Explore':
      return applyExplore(state, event);
    case 'Inspect':
      return applyInspect(state, event);
    case 'RecordClue':
      return applyRecordClue(state, event);
    case 'PickUpItem':
      return applyPickUpItem(state, event);
    case 'DropItem':
      return applyDropItem(state, event);
    case 'TransferItem':
      return applyTransferItem(state, event);
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

  // Spatial movement is the unit that owns its time cost here. If the GM wants
  // to move and also "wait", that should be modeled as a second event so time
  // is not accidentally counted twice.
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

  // Tide access is checked against the projected full arrival time, then time
  // is charged only for the route actually taken (full trip or edge stop).
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
  // Explore carries a fixed search cost so the agent does not need to pair it
  // with an additional AdvanceTime event for the same action beat.
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
  // Inspect is also time-bearing; use AdvanceTime only for extra delay beyond
  // the inspection itself.
  next.systems.time.elapsedMinutes += 2;
  addLedgerInPlace(next, event.note || `Inspected ${event.subject}`);
  if (actor.kind === 'player') {
    updateKnowledgeForActor(next, actor.id);
  }
  return next;
}

function applyRecordClue(state: WorldState, event: Extract<WorldEvent, { type: 'RecordClue' }>): WorldState {
  const actor = state.actors[event.actorId];
  if (!actor) return state;

  const next = cloneState(state);
  const text = event.text.trim();
  const existing = next.knowledge[event.actorId] || {
    seenActors: {},
    seenItems: {},
    seenLocations: {},
    notes: [],
  };

  if (existing.notes.includes(text)) {
    return state;
  }

  next.knowledge[event.actorId] = {
    ...existing,
    notes: [...existing.notes, text],
  };
  addLedgerInPlace(next, event.note || `Clue recorded: ${event.subject ? `${event.subject} - ` : ''}${text}`);
  return next;
}

function applyPickUpItem(state: WorldState, event: Extract<WorldEvent, { type: 'PickUpItem' }>): WorldState {
  const actor = state.actors[event.actorId];
  const item = state.items[event.itemId];
  if (!actor || !item) return state;

  const next = cloneState(state);
  setItemPlacement(next.spine, item.id, { type: 'carried_by', actorId: actor.id }, next.locations);
  addLedgerInPlace(next, event.note || `Picked up ${item.name}`);
  if (actor.kind === 'player') updateKnowledgeForActor(next, actor.id);
  return next;
}

function applyDropItem(state: WorldState, event: Extract<WorldEvent, { type: 'DropItem' }>): WorldState {
  const actor = state.actors[event.actorId];
  const item = state.items[event.itemId];
  if (!actor || !item) return state;

  const next = cloneState(state);
  const anchor = event.at || actor.pos;
  const locationId = resolvePlacementLocationId(next, anchor);
  if (!locationId) return state;

  setItemPlacement(next.spine, item.id, { type: 'located_in', locationId, anchor }, next.locations);
  addLedgerInPlace(next, event.note || `Dropped ${item.name}`);
  if (actor.kind === 'player') updateKnowledgeForActor(next, actor.id);
  return next;
}

function applyTransferItem(state: WorldState, event: Extract<WorldEvent, { type: 'TransferItem' }>): WorldState {
  const itemId = event.itemId || event.item?.id;
  if (!itemId) return state;

  const next = cloneState(state);
  const existingItem = next.items[itemId];
  if (!existingItem && !event.item) return state;

  if (!existingItem && event.item) {
    next.items[itemId] = {
      id: event.item.id,
      name: event.item.name,
      description: event.item.description ?? undefined,
      tags: event.item.tags,
    };
  }

  const item = next.items[itemId];
  if (!item) return state;

  if (event.toActorId) {
    const actor = next.actors[event.toActorId];
    if (!actor) return state;
    setItemPlacement(next.spine, item.id, { type: 'carried_by', actorId: actor.id }, next.locations);
    addLedgerInPlace(next, event.note || `${actor.name} receives ${item.name}`);
    if (actor.kind === 'player') updateKnowledgeForActor(next, actor.id);
    return next;
  }

  if (!event.at) return state;
  const locationId = resolvePlacementLocationId(next, event.at);
  if (!locationId) return state;

  setItemPlacement(next.spine, item.id, { type: 'located_in', locationId, anchor: event.at }, next.locations);
  addLedgerInPlace(next, event.note || `${item.name} is set down`);
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
      description: event.entity.data.description ?? undefined,
      tags: event.entity.data.tags,
    };
    if (event.entity.data.location.kind === 'inventory') {
      setItemPlacement(
        next.spine,
        event.entity.data.id,
        { type: 'carried_by', actorId: event.entity.data.location.actorId },
        next.locations,
      );
    } else if (event.entity.data.location.kind === 'container') {
      setItemPlacement(
        next.spine,
        event.entity.data.id,
        { type: 'inside', containerId: event.entity.data.location.containerId },
        next.locations,
      );
    } else {
      const locationId = resolvePlacementLocationId(next, event.entity.data.location.pos);
      if (locationId) {
        setItemPlacement(
          next.spine,
          event.entity.data.id,
          { type: 'located_in', locationId, anchor: event.entity.data.location.pos },
          next.locations,
        );
      }
    }
  } else if (event.entity.kind === 'npc') {
    const inventory = Array.from(new Set(event.entity.data.inventory || []));
    next.actors[event.entity.data.id] = {
      id: event.entity.data.id,
      kind: 'npc',
      name: event.entity.data.name,
      pos: event.entity.data.pos,
      facing: event.entity.data.facing,
      inventory,
      stats: event.entity.data.stats,
      tags: event.entity.data.tags,
      persona: event.entity.data.persona,
      relationships: event.entity.data.relationships,
    };
    for (const itemId of inventory) {
      if (next.items[itemId]) {
        setItemPlacement(next.spine, itemId, { type: 'carried_by', actorId: event.entity.data.id }, next.locations);
      }
    }
  } else if (event.entity.kind === 'location') {
    next.locations[event.entity.data.id] = {
      id: event.entity.data.id,
      name: event.entity.data.name,
      description: event.entity.data.description,
      anchor: event.entity.data.anchor,
      radiusCells: event.entity.data.radiusCells,
      tideAccess: event.entity.data.tideAccess,
      terrain: event.entity.data.terrain,
      tags: event.entity.data.tags,
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
    const placement = getItemPlacement(state.spine, item.id);
    if (placement?.type === 'located_in' && distance(actor.pos, placement.anchor) <= DEFAULT_VIS_RADIUS) {
      knowledge.seenItems[item.id] = true;
    }
    if (placement && (placement.type === 'carried_by' || placement.type === 'worn_by') && placement.actorId === actor.id) {
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

function resolvePlacementLocationId(state: WorldState, pos: { x: number; y: number; z?: number }) {
  const containing = Object.values(state.locations)
    .filter(location => distance(pos, location.anchor) <= (location.radiusCells ?? 0))
    .sort((a, b) => distance(pos, a.anchor) - distance(pos, b.anchor));
  if (containing[0]) return containing[0].id;

  const nearest = Object.values(state.locations)
    .sort((a, b) => distance(pos, a.anchor) - distance(pos, b.anchor))[0];
  return nearest?.id || null;
}
