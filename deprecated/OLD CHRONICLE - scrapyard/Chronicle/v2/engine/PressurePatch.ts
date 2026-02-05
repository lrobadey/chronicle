// PressurePatch.ts - Core kernel types for Chronicle V2
// ======================================================
// This file defines the canonical Pressure and Patch types used by all
// V2 systems plus a few convenience helpers and validators.  Keeping
// these definitions in one place ensures every reducer and kernel
// component speaks the same language when exchanging data.

// --------------------------------------------------------------------
// PRESSURE — normalised system inputs
// --------------------------------------------------------------------
// Example: WeatherSystem might publish a pressure:
//   { domain: 'weather', key: 'travel_difficulty', loc: 'region-3', value: 0.35 }
// Systems that care about travel difficulty (Travel, Economy) can use
// these inputs without needing direct knowledge of Weather internals.
export interface Pressure {
  domain: string;   // Which system produced this input (e.g. 'weather')
  key: string;      // What the input represents (e.g. 'travel_difficulty')
  loc: string;      // GTWG entity the input applies to (region, location, etc.)
  value: number;    // Normalised numeric value – systems decide semantics
  timestamp?: string; // ISO timestamp for debugging / time-series analysis
  tick?: number;      // Game tick when created
}

export type PatchOperation =
  | 'add'
  | 'remove'
  | 'set'
  | 'replace'
  | 'increment'
  | 'decrement'
  // Lifecycle extensions
  | 'create_entity'
  | 'delete_entity'
  | 'create_relation'
  | 'delete_relation';

// --------------------------------------------------------------------
// PATCH — authoritative state changes proposed by systems
// --------------------------------------------------------------------
// Patches are *proposals* until the Arbiter validates and commits them
// to the Canon Ledger.  They must be deterministic, conflict-free and
// reference only existing entities + fields owned by the proposing
// system.
export interface Patch {
  op: PatchOperation;
  entity: string;      // GTWG entity ID to modify
  field: string;       // Entity field path (dot notation allowed, but flat preferred)
  value?: any;         // New value (omitted for remove)
  proposer: string;    // System id proposing the change
  tick?: number;       // Game tick when generated
  metadata?: Record<string, any>; // Optional extra info for debugging
}

export type PatchSet = Patch[];
export type PressureSet = Pressure[];

// --------------------------------------------------------------------
// Helper factories – syntactic sugar for reducers
// --------------------------------------------------------------------
export function set(entity: string, field: string, value: any, proposer: string): Patch {
  return { op: 'set', entity, field, value, proposer };
}

export function add(entity: string, field: string, value: any, proposer: string): Patch {
  return { op: 'add', entity, field, value, proposer };
}

export function remove(entity: string, field: string, proposer: string): Patch {
  return { op: 'remove', entity, field, proposer };
}

// --------------------------------------------------------------------
// Basic validators — lightweight sanity checks before Arbiter rules
// --------------------------------------------------------------------
export function isValidPressure(p: Pressure): boolean {
  return typeof p.domain === 'string' && typeof p.key === 'string' && typeof p.loc === 'string' && typeof p.value === 'number';
}

export function isValidPatch(p: Patch): boolean {
  if (typeof p.entity !== 'string' || typeof p.field !== 'string' || typeof p.op !== 'string' || typeof p.proposer !== 'string') {
    return false;
  }
  // remove op has no value
  if (p.op === 'remove' || p.op === 'delete_entity' || p.op === 'delete_relation') return true;
  // create operations and set/replace/add/increment/decrement require a value
  return 'value' in p;
}

export function validatePatchSet(patches: PatchSet): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  patches.forEach((p, idx) => {
    if (!isValidPatch(p)) {
      errors.push(`Patch #${idx} is invalid: ${JSON.stringify(p)}`);
    }
  });
  return { valid: errors.length === 0, errors };
}
