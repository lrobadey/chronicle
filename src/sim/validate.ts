import type { WorldEvent } from './events';
import type { PendingPrompt, WorldState } from './state';
import { getItemPlacement } from './spine';
import { validateAffectItem } from './itemEffects';
import { deriveTide, isTideBlocked } from './systems/tide';
import { deriveConstraints } from './systems/constraints';
import { distance, findNearestLocation, getActor, isWithinBounds } from './utils';
import { estimateTravel, LONG_TRAVEL_MINUTES } from './systems/travel';

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateEvent(state: WorldState, event: WorldEvent, pendingPrompt?: PendingPrompt): ValidationResult {
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
      const placement = getItemPlacement(state.spine, event.itemId);
      if (!placement || placement.type !== 'located_in') return { ok: false, reason: 'item_not_on_ground' };
      if (distance(actor.pos, placement.anchor) > 2) return { ok: false, reason: 'item_too_far' };
      return { ok: true };
    }
    case 'DropItem': {
      const actor = getActor(state, event.actorId);
      if (!actor) return { ok: false, reason: 'actor_not_found' };
      const placement = getItemPlacement(state.spine, event.itemId);
      if (
        !placement
        || (placement.type !== 'carried_by' && placement.type !== 'worn_by')
        || placement.actorId !== actor.id
      ) {
        return { ok: false, reason: 'item_not_in_inventory' };
      }
      return { ok: true };
    }
    case 'AffectItem':
      return validateAffectItem(state, event);
    case 'TransferItem':
      return validateTransferItem(state, event);
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
      if (estimate.minutes > LONG_TRAVEL_MINUTES && !hasMatchingTravelConfirmation(pendingPrompt, event.locationId, event.confirmId)) {
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
    case 'RecordClue': {
      const actor = getActor(state, event.actorId);
      if (!actor) return { ok: false, reason: 'actor_not_found' };
      if (!event.text?.trim()) return { ok: false, reason: 'clue_text_required' };
      const knowledge = state.knowledge[event.actorId];
      if (knowledge?.notes.includes(event.text.trim())) return { ok: false, reason: 'clue_already_known' };
      return { ok: true };
    }
    case 'CreateEntity':
      return validateCreateEntity(state, event);
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

function hasMatchingTravelConfirmation(pendingPrompt: PendingPrompt | undefined, locationId: string, confirmId: string | undefined) {
  if (!confirmId) return false;
  if (!pendingPrompt || pendingPrompt.kind !== 'confirm_travel' || pendingPrompt.id !== confirmId) return false;
  const pendingLocationId = pendingPrompt.data?.locationId;
  return typeof pendingLocationId === 'string' && pendingLocationId === locationId;
}

function validateCreateEntity(state: WorldState, event: Extract<WorldEvent, { type: 'CreateEntity' }>): ValidationResult {
  if (event.entity.kind === 'item') {
    const { data } = event.entity;
    if (typeof data.id !== 'string' || typeof data.name !== 'string' || !data.location) return { ok: false, reason: 'invalid_item_payload' };
    if (state.items[data.id]) return { ok: false, reason: 'item_already_exists' };
    if (!data.name.trim()) return { ok: false, reason: 'item_name_required' };
    if (data.location.kind === 'ground') {
      if (!isWithinBounds(state, data.location.pos)) return { ok: false, reason: 'item_location_out_of_bounds' };
    }
    if (data.location.kind === 'inventory') {
      const owner = state.actors[data.location.actorId];
      if (!owner) return { ok: false, reason: 'item_inventory_owner_not_found' };
    }
    return { ok: true };
  }

  if (event.entity.kind === 'npc') {
    const { data } = event.entity;
    if (typeof data.id !== 'string' || typeof data.name !== 'string' || !data.pos) return { ok: false, reason: 'invalid_npc_payload' };
    if (state.actors[data.id]) return { ok: false, reason: 'actor_already_exists' };
    if (!data.name.trim()) return { ok: false, reason: 'npc_name_required' };
    if (!isWithinBounds(state, data.pos)) return { ok: false, reason: 'npc_position_out_of_bounds' };
    if (data.persona) {
      if (!Array.isArray(data.persona.goals)) return { ok: false, reason: 'npc_persona_goals_invalid' };
      if (!data.persona.tagline.trim() || !data.persona.background.trim() || !data.persona.voice.trim()) {
        return { ok: false, reason: 'npc_persona_incomplete' };
      }
      if (!data.persona.goals.every(goal => typeof goal === 'string' && goal.trim())) {
        return { ok: false, reason: 'npc_persona_goals_invalid' };
      }
    }
    if (data.inventory) {
      for (const itemId of data.inventory) {
        if (!state.items[itemId]) return { ok: false, reason: 'npc_inventory_item_not_found' };
      }
    }
    if (data.relationships) {
      for (const relatedActorId of Object.keys(data.relationships)) {
        if (!state.actors[relatedActorId]) return { ok: false, reason: 'npc_relationship_target_not_found' };
      }
    }
    return { ok: true };
  }

  const { data } = event.entity;
  if (typeof data.id !== 'string' || typeof data.name !== 'string' || typeof data.description !== 'string' || !data.anchor) {
    return { ok: false, reason: 'invalid_location_payload' };
  }
  if (state.locations[data.id]) return { ok: false, reason: 'location_already_exists' };
  if (!data.name.trim()) return { ok: false, reason: 'location_name_required' };
  if (!data.description.trim()) return { ok: false, reason: 'location_description_required' };
  if (!isWithinBounds(state, data.anchor)) return { ok: false, reason: 'location_anchor_out_of_bounds' };
  return { ok: true };
}

function validateTransferItem(state: WorldState, event: Extract<WorldEvent, { type: 'TransferItem' }>): ValidationResult {
  const hasItemId = typeof event.itemId === 'string' && event.itemId.trim().length > 0;
  const hasItemPayload = Boolean(event.item);

  if (!hasItemId && !hasItemPayload) return { ok: false, reason: 'transfer_item_required' };

  if (event.item) {
    if (!event.item.id.trim() || !event.item.name.trim()) {
      return { ok: false, reason: 'transfer_item_payload_invalid' };
    }
    if (hasItemId && event.itemId !== event.item.id) {
      return { ok: false, reason: 'transfer_item_id_mismatch' };
    }
    if (!state.items[event.item.id] && !event.item.name.trim()) {
      return { ok: false, reason: 'transfer_item_payload_invalid' };
    }
  }

  const itemId = hasItemId ? event.itemId! : event.item!.id;
  const existingItem = state.items[itemId];
  if (!existingItem && !event.item) return { ok: false, reason: 'item_not_found' };
  if (existingItem && event.item && event.item.name.trim().length === 0) return { ok: false, reason: 'transfer_item_payload_invalid' };

  const hasDestinationActor = typeof event.toActorId === 'string' && event.toActorId.trim().length > 0;
  const hasDestinationPos = typeof event.at === 'object' && event.at !== null;
  if (hasDestinationActor === hasDestinationPos) {
    return { ok: false, reason: 'transfer_destination_required' };
  }

  if (hasDestinationActor && !getActor(state, event.toActorId!)) {
    return { ok: false, reason: 'transfer_target_actor_not_found' };
  }

  if (hasDestinationPos && !isWithinBounds(state, event.at!)) {
    return { ok: false, reason: 'item_location_out_of_bounds' };
  }

  if (existingItem && event.fromActorId) {
    const sourceActor = getActor(state, event.fromActorId);
    if (!sourceActor) return { ok: false, reason: 'transfer_source_actor_not_found' };
    const placement = getItemPlacement(state.spine, itemId);
    if (
      !placement
      || (placement.type !== 'carried_by' && placement.type !== 'worn_by')
      || placement.actorId !== event.fromActorId
    ) {
      return { ok: false, reason: 'item_not_held_by_source_actor' };
    }
  }

  return { ok: true };
}
