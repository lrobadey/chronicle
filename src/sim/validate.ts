import type { WorldEvent } from './events';
import type { WorldState } from './state';
import { deriveTide, isTideBlocked } from './systems/tide';
import { deriveConstraints } from './systems/constraints';
import { distance, findNearestLocation, getActor, isWithinBounds } from './utils';
import { estimateTravel, LONG_TRAVEL_MINUTES } from './systems/travel';

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateEvent(state: WorldState, event: WorldEvent): ValidationResult {
  switch (event.type) {
    case 'MoveActor': {
      const actor = getActor(state, event.actorId);
      if (!actor) return { ok: false, reason: 'actor_not_found' };
      const dest = resolveMoveTarget(state, event);
      if (!dest) return { ok: false, reason: 'invalid_destination' };
      if (!isWithinBounds(state, dest)) return { ok: false, reason: 'out_of_bounds' };

      const tide = deriveTide(state);
      const nearest = findNearestLocation(state, dest);
      if (nearest && isTideBlocked(nearest, tide) && distance(nearest.anchor, dest) <= (nearest.radiusCells ?? 20)) {
        return { ok: false, reason: `tide_blocks_${nearest.id}` };
      }

      const moveMeters = distance(actor.pos, dest) * state.map.cellSizeMeters;
      const constraints = deriveConstraints(state);
      if (moveMeters > constraints.maxMoveMeters) {
        return { ok: false, reason: 'move_exceeds_turn_limit' };
      }

      return { ok: true };
    }
    case 'PickUpItem': {
      const actor = getActor(state, event.actorId);
      if (!actor) return { ok: false, reason: 'actor_not_found' };
      const item = state.items[event.itemId];
      if (!item) return { ok: false, reason: 'item_not_found' };
      if (item.location.kind !== 'ground') return { ok: false, reason: 'item_not_on_ground' };
      if (distance(actor.pos, item.location.pos) > 2) return { ok: false, reason: 'item_too_far' };
      return { ok: true };
    }
    case 'DropItem': {
      const actor = getActor(state, event.actorId);
      if (!actor) return { ok: false, reason: 'actor_not_found' };
      if (!actor.inventory.includes(event.itemId)) return { ok: false, reason: 'item_not_in_inventory' };
      return { ok: true };
    }
    case 'Speak': {
      const actor = getActor(state, event.actorId);
      if (!actor) return { ok: false, reason: 'actor_not_found' };
      return { ok: true };
    }
    case 'AdvanceTime': {
      if (event.minutes <= 0) return { ok: false, reason: 'invalid_minutes' };
      return { ok: true };
    }
    case 'TravelToLocation': {
      const actor = getActor(state, event.actorId);
      if (!actor) return { ok: false, reason: 'actor_not_found' };
      const location = state.locations[event.locationId];
      if (!location) return { ok: false, reason: 'location_not_found' };
      const estimate = estimateTravel(state, actor.pos, location.anchor, event.pace || 'walk');
      if (estimate.minutes > LONG_TRAVEL_MINUTES && !hasMatchingTravelConfirmation(state, event.locationId, event.confirmId)) {
        return { ok: false, reason: 'travel_requires_confirmation' };
      }
      return { ok: true };
    }
    case 'Explore': {
      const actor = getActor(state, event.actorId);
      if (!actor) return { ok: false, reason: 'actor_not_found' };
      return { ok: true };
    }
    case 'Inspect': {
      const actor = getActor(state, event.actorId);
      if (!actor) return { ok: false, reason: 'actor_not_found' };
      if (!event.subject?.trim()) return { ok: false, reason: 'inspect_subject_required' };
      return { ok: true };
    }
    case 'CreateEntity':
    case 'SetFlag':
      return { ok: true };
    default:
      return { ok: false, reason: 'unknown_event' };
  }
}

export function resolveMoveTarget(state: WorldState, event: Extract<WorldEvent, { type: 'MoveActor' }>) {
  if (event.toLocationId) {
    const loc = state.locations[event.toLocationId];
    if (!loc) return null;
    return loc.anchor;
  }
  return event.to;
}

function hasMatchingTravelConfirmation(state: WorldState, locationId: string, confirmId: string | undefined) {
  if (!confirmId) return false;
  const pending = state.meta.pendingPrompt;
  if (!pending || pending.kind !== 'confirm_travel' || pending.id !== confirmId) return false;
  const pendingLocationId = pending.data?.locationId;
  return typeof pendingLocationId === 'string' && pendingLocationId === locationId;
}
