import type { AffectItemEffect, WorldEvent } from './events';
import type { Item, ItemLifecycleState, WorldState } from './state';
import { getItemLifecycleState, getItemPlacement, setItemPlacement } from './spine';
import { distance, getActor } from './utils';

export function validateAffectItem(
  state: WorldState,
  event: Extract<WorldEvent, { type: 'AffectItem' }>,
): { ok: boolean; reason?: string } {
  const actor = getActor(state, event.actorId);
  if (!actor) return { ok: false, reason: 'actor_not_found' };

  const item = state.items[event.itemId];
  if (!item) return { ok: false, reason: 'item_not_found' };

  const placement = getItemPlacement(state.spine, event.itemId);
  if (!placement) return { ok: false, reason: 'item_missing_placement' };

  const lifecycle = getItemLifecycleState(state.spine, event.itemId);
  if (lifecycle === 'consumed') return { ok: false, reason: 'item_already_consumed' };

  switch (event.effect) {
    case 'pick_up':
      if (lifecycle === 'broken' || lifecycle === 'ruined') return { ok: false, reason: 'item_not_portable' };
      if (placement.type !== 'located_in') return { ok: false, reason: 'item_not_pickup_accessible' };
      if (distance(actor.pos, placement.anchor) > 2) return { ok: false, reason: 'item_too_far' };
      return { ok: true };
    case 'drop':
      return isHeldByActor(event.itemId, event.actorId, state)
        ? { ok: true }
        : { ok: false, reason: 'item_not_in_inventory' };
    case 'transfer':
      if (typeof event.targetActorId === 'string' && !state.actors[event.targetActorId]) {
        return { ok: false, reason: 'transfer_target_actor_not_found' };
      }
      if (!isHeldByActor(event.itemId, event.actorId, state)) {
        if (!(placement.type === 'located_in' && distance(actor.pos, placement.anchor) <= 2)) {
          return { ok: false, reason: 'item_not_transfer_accessible' };
        }
      }
      if (!event.targetActorId && !event.at) return { ok: false, reason: 'transfer_destination_required' };
      return { ok: true };
    case 'open':
      if (!isAccessibleToActor(event.itemId, event.actorId, state)) return { ok: false, reason: 'item_not_accessible' };
      if (lifecycle === 'broken' || lifecycle === 'ruined') return { ok: false, reason: 'item_cannot_be_opened' };
      if (item.components?.container && item.components.container.sealed === false) {
        return { ok: false, reason: 'item_already_open' };
      }
      return { ok: true };
    case 'close':
      if (!isAccessibleToActor(event.itemId, event.actorId, state)) return { ok: false, reason: 'item_not_accessible' };
      if (item.components?.container?.sealed === true) return { ok: false, reason: 'item_already_closed' };
      if (lifecycle === 'broken' || lifecycle === 'ruined') {
        return { ok: false, reason: 'item_cannot_be_closed' };
      }
      return { ok: true };
    case 'break':
    case 'ruin':
      return isAccessibleToActor(event.itemId, event.actorId, state)
        ? { ok: true }
        : { ok: false, reason: 'item_not_accessible' };
    case 'consume':
      if (!isAccessibleToActor(event.itemId, event.actorId, state)) return { ok: false, reason: 'item_not_accessible' };
      if (lifecycle === 'broken' || lifecycle === 'ruined') return { ok: false, reason: 'item_not_consumable' };
      return { ok: true };
    case 'empty':
      if (!isAccessibleToActor(event.itemId, event.actorId, state)) return { ok: false, reason: 'item_not_accessible' };
      if (lifecycle === 'broken' || lifecycle === 'ruined') return { ok: false, reason: 'item_cannot_be_emptied' };
      return { ok: true };
    case 'fill':
      if (!isAccessibleToActor(event.itemId, event.actorId, state)) return { ok: false, reason: 'item_not_accessible' };
      if (lifecycle === 'broken' || lifecycle === 'ruined') return { ok: false, reason: 'item_cannot_be_filled' };
      return { ok: true };
    default:
      return { ok: false, reason: 'unknown_item_effect' };
  }
}

export function applyAffectItem(
  state: WorldState,
  event: Extract<WorldEvent, { type: 'AffectItem' }>,
): WorldState {
  const actor = state.actors[event.actorId];
  const item = state.items[event.itemId];
  if (!actor || !item) return state;

  const next = cloneState(state);
  const nextItem = ensureMutableItem(next, event.itemId);
  const targetAnchor = event.at || actor.pos;

  switch (event.effect) {
    case 'pick_up':
      setItemPlacement(next.spine, event.itemId, { type: 'carried_by', actorId: event.actorId }, next.locations);
      setLifecycle(nextItem, 'intact');
      break;
    case 'drop':
      setItemPlacement(next.spine, event.itemId, toGroundPlacement(next, targetAnchor), next.locations);
      break;
    case 'transfer':
      if (event.targetActorId) {
        setItemPlacement(next.spine, event.itemId, { type: 'carried_by', actorId: event.targetActorId }, next.locations);
      } else {
        setItemPlacement(next.spine, event.itemId, toGroundPlacement(next, targetAnchor), next.locations);
      }
      break;
    case 'open':
      ensureContainer(nextItem).sealed = false;
      if (getItemLifecycleState(next.spine, event.itemId) !== 'empty') setLifecycle(nextItem, 'opened');
      break;
    case 'close':
      ensureContainer(nextItem).sealed = true;
      if ((nextItem.components?.lifecycle?.state || 'intact') === 'opened') setLifecycle(nextItem, 'intact');
      break;
    case 'break':
      ensureCondition(nextItem).broken = true;
      ensureCondition(nextItem).durability = 0;
      ensureContainer(nextItem).sealed = false;
      setLifecycle(nextItem, 'broken');
      setItemPlacement(next.spine, event.itemId, toGroundPlacement(next, targetAnchor), next.locations);
      break;
    case 'consume':
      ensureContainer(nextItem).sealed = false;
      setLifecycle(nextItem, 'consumed');
      if (isHeldByActor(event.itemId, event.actorId, next)) {
        setItemPlacement(next.spine, event.itemId, toGroundPlacement(next, targetAnchor), next.locations);
      }
      break;
    case 'empty':
      ensureContainer(nextItem).sealed = false;
      setLifecycle(nextItem, 'empty');
      break;
    case 'fill':
      setLifecycle(nextItem, 'intact');
      break;
    case 'ruin':
      ensureCondition(nextItem).durability = Math.min(ensureCondition(nextItem).durability ?? 10, 10);
      ensureContainer(nextItem).sealed = false;
      setLifecycle(nextItem, 'ruined');
      if (isHeldByActor(event.itemId, event.actorId, next)) {
        setItemPlacement(next.spine, event.itemId, toGroundPlacement(next, targetAnchor), next.locations);
      }
      break;
  }

  return next;
}

export function isHeldByActor(itemId: string, actorId: string, state: WorldState): boolean {
  const placement = getItemPlacement(state.spine, itemId);
  return Boolean(
    placement &&
    (placement.type === 'carried_by' || placement.type === 'worn_by') &&
    placement.actorId === actorId,
  );
}

export function isAccessibleToActor(itemId: string, actorId: string, state: WorldState): boolean {
  const actor = state.actors[actorId];
  const placement = getItemPlacement(state.spine, itemId);
  if (!actor || !placement) return false;
  if (placement.type === 'carried_by' || placement.type === 'worn_by') return placement.actorId === actorId;
  return placement.type === 'located_in' && distance(actor.pos, placement.anchor) <= 2;
}

function ensureMutableItem(state: WorldState, itemId: string): Item {
  const item = state.items[itemId];
  if (!item) throw new Error(`missing_item:${itemId}`);
  state.items[itemId] = {
    ...item,
    components: {
      ...item.components,
      condition: item.components?.condition ? { ...item.components.condition } : item.components?.condition,
      container: item.components?.container ? { ...item.components.container } : item.components?.container,
      lifecycle: item.components?.lifecycle ? { ...item.components.lifecycle } : item.components?.lifecycle,
    },
  };
  return state.items[itemId]!;
}

function ensureCondition(item: Item) {
  item.components = item.components || {};
  item.components.condition = item.components.condition || {};
  return item.components.condition;
}

function ensureContainer(item: Item) {
  item.components = item.components || {};
  item.components.container = item.components.container || {};
  return item.components.container;
}

function setLifecycle(item: Item, state: ItemLifecycleState) {
  item.components = item.components || {};
  item.components.lifecycle = { state };
}

function toGroundPlacement(state: WorldState, anchor: { x: number; y: number; z?: number }) {
  const locationId = resolvePlacementLocationId(state, anchor);
  if (!locationId) throw new Error('item_location_out_of_bounds');
  return { type: 'located_in' as const, locationId, anchor };
}

function resolvePlacementLocationId(state: WorldState, anchor: { x: number; y: number; z?: number }) {
  let bestId: string | null = null;
  let bestRadius = Number.POSITIVE_INFINITY;
  for (const location of Object.values(state.locations)) {
    const radius = location.radiusCells ?? 20;
    if (distance(anchor, location.anchor) <= radius && radius < bestRadius) {
      bestId = location.id;
      bestRadius = radius;
    }
  }
  return bestId;
}

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
