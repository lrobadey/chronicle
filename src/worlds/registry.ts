import { UnknownWorldError } from '../engine/errors';
import { isleOfMarrowWorldModule } from './isle-of-marrow';
import { telMoraWorldModule } from './tel-mora';
import type { WorldModule } from './types';

export const DEFAULT_WORLD_ID = 'isle-of-marrow';

const WORLD_MODULES: WorldModule[] = [
  isleOfMarrowWorldModule,
  telMoraWorldModule,
];

export function listWorldModules(): WorldModule[] {
  return [...WORLD_MODULES];
}

export function resolveWorldModule(worldId?: string): WorldModule {
  const normalized = normalizeWorldId(worldId);
  const module = WORLD_MODULES.find(entry => entry.id === normalized);
  if (!module) {
    throw new UnknownWorldError(normalized, WORLD_MODULES.map(entry => entry.id));
  }
  return module;
}

function normalizeWorldId(worldId?: string): string {
  if (!worldId) return DEFAULT_WORLD_ID;
  return worldId.trim().toLowerCase();
}
