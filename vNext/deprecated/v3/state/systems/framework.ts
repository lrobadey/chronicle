/**
 * Reactive Systems Framework
 * 
 * Defines the interface for systems that automatically react to world state changes (deltas).
 * Based on the v2 SystemSpec architecture but adapted for v3's GM-driven flow.
 */

import type { SimpleWorld } from '../world';
import type { Patch } from '../../tools/types';

export type TickRate = 'per_action' | 'hourly' | 'daily';

export interface WorldDelta {
  /** Minutes of game time elapsed in this step */
  timeDelta: number;
  /** The world state *after* the GM's patches but *before* system reaction */
  worldAfterGM: SimpleWorld;
}

export interface SystemSpec {
  id: string;
  description?: string;
  /**
   * Pure function that takes the world state and the change context,
   * returning patches to apply.
   */
  reducer: (world: SimpleWorld, delta: WorldDelta) => Patch[];
  tickRate: TickRate;
  /** Fields this system "owns" (for documentation/conflict checking) */
  ownership?: string[];
}

// Simple in-memory registry
export const SYSTEM_REGISTRY = new Map<string, SystemSpec>();

export function registerSystem(spec: SystemSpec): void {
  if (SYSTEM_REGISTRY.has(spec.id)) {
    console.warn(`System '${spec.id}' already registered. Overwriting.`);
  }
  SYSTEM_REGISTRY.set(spec.id, spec);
}

export function getSystem(id: string): SystemSpec | undefined {
  return SYSTEM_REGISTRY.get(id);
}

export function getAllSystems(): SystemSpec[] {
  return Array.from(SYSTEM_REGISTRY.values());
}

