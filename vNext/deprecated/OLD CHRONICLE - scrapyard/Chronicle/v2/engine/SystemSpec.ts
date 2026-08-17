// SystemSpec.ts – Runtime system definition & validation for Chronicle V2
// ======================================================================
// A *System* in Chronicle V2 is a pure function `(gtwg, action, pressures) => PatchSet`.
// Each system is described by a "spec" that tells the kernel when and how
// to execute it.  This module provides the canonical `SystemSpec` type,
// parsing / validation helpers, and a tiny in-memory registry.

import type { PatchSet, PressureSet } from './PressurePatch';
import type { GTWG } from '../types/GTWGTypes.js';

// ---------------------------------------------------------------------
// Core type definition
// ---------------------------------------------------------------------
export type TickRate = 'per_action' | 'hourly' | 'daily';

export interface SystemReducer {
  (gtwg: GTWG, action: unknown, pressures?: PressureSet): PatchSet;
}

export interface SystemSpec {
  id: string;                   // Unique system identifier
  reducer: SystemReducer;       // Pure function implementing system logic
  tickRate: TickRate;           // Execution frequency
  ownership: string[];          // Which GTWG fields this system owns
  dependencies?: string[];      // Other systems required *before* this runs
  description?: string;         // Human-readable summary
  version?: string;             // Optional semantic version
}

// ---------------------------------------------------------------------
// Registry – simple in-process storage until we add dynamic loading
// ---------------------------------------------------------------------
const registry = new Map<string, SystemSpec>();

export function registerSystem(spec: SystemSpec): { ok: true } | { ok: false; error: string } {
  const validation = validateSystemSpec(spec);
  if (!validation.ok) return { ok: false, error: validation.error };
  if (registry.has(spec.id)) return { ok: false, error: `System '${spec.id}' already registered` };
  registry.set(spec.id, spec);
  return { ok: true };
}

export function getSystem(id: string): SystemSpec | undefined {
  return registry.get(id);
}

export function getAllSystems(): SystemSpec[] {
  return Array.from(registry.values());
}

// ---------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------
export function validateSystemSpec(raw: Partial<SystemSpec>): { ok: boolean; error?: string } {
  if (!raw.id || typeof raw.id !== 'string') return { ok: false, error: 'Missing or invalid id' };
  if (!raw.reducer || typeof raw.reducer !== 'function') return { ok: false, error: 'Missing reducer function' };
  if (!raw.tickRate || !['per_action', 'hourly', 'daily'].includes(raw.tickRate)) {
    return { ok: false, error: 'Invalid tickRate' };
  }
  if (!Array.isArray(raw.ownership)) return { ok: false, error: 'ownership must be an array' };
  return { ok: true };
}
