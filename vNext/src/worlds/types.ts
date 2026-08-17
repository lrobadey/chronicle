import type { WorldState } from '../sim/state';

export interface CreateWorldOptions {
  anchorIso?: string;
}

export interface WorldCliTheme {
  banner?: string;
  intro?: string;
  eyebrow?: string;
}

export interface WorldModule {
  id: string;
  displayName: string;
  createWorld(options?: CreateWorldOptions): WorldState;
  cliTheme?: WorldCliTheme;
  metadata?: Record<string, unknown>;
}

export interface WorldSurfaceInfo {
  id: string;
  displayName: string;
  cliTheme?: WorldCliTheme;
  metadata?: Record<string, unknown>;
}

export type WorldPresentation = WorldSurfaceInfo;

export function describeWorldModule(module: WorldModule): WorldPresentation {
  return {
    id: module.id,
    displayName: module.displayName,
    cliTheme: module.cliTheme,
    metadata: module.metadata,
  };
}
