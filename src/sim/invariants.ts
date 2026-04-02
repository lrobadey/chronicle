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

  for (const [id] of Object.entries(state.items)) {
    const placementRelations = (state.spine.indexes.byFrom[id] || [])
      .map(relationId => state.spine.relations[relationId])
      .filter(relation => {
        return relation && relation.from === id && ['located_in', 'inside', 'on', 'carried_by', 'worn_by'].includes(relation.type);
      });

    if (placementRelations.length !== 1) {
      issues.push({ path: `spine.relations.${id}`, message: `Expected exactly one item placement relation, found ${placementRelations.length}` });
      continue;
    }

    const placement = getItemPlacement(state.spine, id);
    if (!placement) {
      issues.push({ path: `spine.${id}`, message: 'Missing placement' });
      continue;
    }

    if (placement.type === 'carried_by' || placement.type === 'worn_by') {
      if (!state.actors[placement.actorId]) {
        issues.push({ path: `spine.${id}`, message: `Placement references non-existent actor ${placement.actorId}` });
      }
    } else if (placement.type === 'located_in') {
      if (!state.locations[placement.locationId]) {
        issues.push({ path: `spine.${id}`, message: `Placement references non-existent location ${placement.locationId}` });
      }
    }
  }

  for (const [actorId, actor] of Object.entries(state.actors)) {
    const expected = Object.keys(state.items).filter(itemId => {
      const placement = getItemPlacement(state.spine, itemId);
      return placement && (placement.type === 'carried_by' || placement.type === 'worn_by') && placement.actorId === actorId;
    });
    if (actor.inventory.length !== expected.length || !actor.inventory.every(id => expected.includes(id))) {
      issues.push({ path: `actors.${actorId}.inventory`, message: 'Inventory does not match spine placement' });
    }
  }

  return issues;
}
