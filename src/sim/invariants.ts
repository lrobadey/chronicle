import type { WorldState } from './state';

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
    if (!item.location) {
      issues.push({ path: `items.${id}.location`, message: 'Missing location' });
      continue;
    }
    if (item.location.kind === 'inventory') {
      const owner = state.actors[item.location.actorId];
      if (!owner || !owner.inventory.includes(id)) {
        issues.push({ path: `items.${id}.location`, message: 'Inventory location mismatch' });
      }
    }
  }

  return issues;
}
