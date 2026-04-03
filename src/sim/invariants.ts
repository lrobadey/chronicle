import type { WorldState } from './state';
import { getItemPlacement, validateSpine } from './spine';

export interface InvariantIssue {
  path: string;
  message: string;
}

export function checkInvariants(state: WorldState): InvariantIssue[] {
  const issues: InvariantIssue[] = [];

  for (const [id, actor] of Object.entries(state.actors)) {
    if (!actor.pos) issues.push({ path: `actors.${id}.pos`, message: 'Missing position' });
  }

  const spineIssues = validateSpine(state.spine, {
    actorIds: Object.keys(state.actors),
    itemIds: Object.keys(state.items),
    locationIds: Object.keys(state.locations),
  });
  for (const issue of spineIssues) {
    issues.push({ path: issue.path, message: issue.message });
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
