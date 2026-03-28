import type { WorldState } from './state';
import { getItemPlacement } from './spine';

export interface InvariantIssue {
  path: string;
  message: string;
}

export function checkInvariants(state: WorldState): InvariantIssue[] {
  const issues: InvariantIssue[] = [];

  for (const [id, actor] of Object.entries(state.actors)) {
    if (!actor.pos) issues.push({ path: `actors.${id}.pos`, message: 'Missing position' });
  }

  for (const [id, item] of Object.entries(state.items)) {
    const placementIds = (state.spine.indexes.byFrom[id] || [])
      .map(relationId => state.spine.relations[relationId])
      .filter(relation => {
        return relation && relation.from === id && ['located_in', 'inside', 'on', 'carried_by', 'worn_by'].includes(relation.type);
      });

    if (placementIds.length !== 1) {
      issues.push({ path: `spine.relations.${id}`, message: `Expected exactly one item placement relation, found ${placementIds.length}` });
    }

    const placement = getItemPlacement(state.spine, id);
    if (!placement || !item.location) {
      issues.push({ path: `items.${id}.location`, message: 'Missing location' });
      continue;
    }

    if (placement.type === 'located_in') {
      if (
        item.location.kind !== 'ground'
        || item.location.pos.x !== placement.anchor.x
        || item.location.pos.y !== placement.anchor.y
        || (item.location.pos.z ?? 0) !== (placement.anchor.z ?? 0)
      ) {
        issues.push({ path: `items.${id}.location`, message: 'Ground location mismatch' });
      }
      continue;
    }

    if (placement.type === 'inside' || placement.type === 'on') {
      const containerId = placement.type === 'inside' ? placement.containerId : placement.surfaceId;
      if (item.location.kind !== 'container' || item.location.containerId !== containerId) {
        issues.push({ path: `items.${id}.location`, message: 'Container location mismatch' });
      }
      continue;
    }

    if (item.location.kind !== 'inventory' || item.location.actorId !== placement.actorId) {
      issues.push({ path: `items.${id}.location`, message: 'Inventory location mismatch' });
      continue;
    }

    const owner = state.actors[placement.actorId];
    if (!owner || !owner.inventory.includes(id)) {
      issues.push({ path: `items.${id}.location`, message: 'Inventory location mismatch' });
    }
  }

  for (const [actorId, actor] of Object.entries(state.actors)) {
    const expected = Object.keys(state.items).filter(itemId => {
      const placement = getItemPlacement(state.spine, itemId);
      return placement && (placement.type === 'carried_by' || placement.type === 'worn_by') && placement.actorId === actorId;
    });
    if (actor.inventory.length !== expected.length || actor.inventory.some((itemId, index) => itemId !== expected[index])) {
      issues.push({ path: `actors.${actorId}.inventory`, message: 'Derived inventory mismatch' });
    }
  }

  return issues;
}
