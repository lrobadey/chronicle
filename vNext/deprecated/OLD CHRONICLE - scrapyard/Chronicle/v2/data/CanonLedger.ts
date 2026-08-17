// CanonLedger.ts - Append-only event-sourced history for Chronicle V2
// ================================================================
// The Canon Ledger stores every validated PatchSet that changes the
// Ground-Truth World Graph (GTWG).  Because GTWG itself is immutable
// (functions always return a *new* object), replaying the ledger from an
// initial seed state will deterministically reconstruct any historical
// world state.

import type { PatchSet, Patch } from '../engine/PressurePatch';
import type { GTWG } from '../types/GTWGTypes.js';

// --------------------------------------------------------------------
// CanonEntry – one timeline entry representing *one* Arbiter commit
// --------------------------------------------------------------------
export interface CanonEntry {
  id: string;          // Deterministic hash (seed, tick, proposer, content)
  timestamp: string;   // ISO timestamp when committed
  tick: number;        // Game tick (monotonically increasing)
  proposer: string;    // Which system initiated this change (or 'arbiter')
  action?: any;        // Optional original Action that triggered this entry
  patches: PatchSet;   // State changes applied by Arbiter
  gtwgHash: string;    // Hash of world state after applying patches
}

export interface CanonLedger {
  entries: CanonEntry[];
  metadata: {
    version: string;
    createdAt: string;
  };
}

// --------------------------------------------------------------------
// Simple hash helper – *NOT* cryptographically secure, good enough for
// determinism checks in development.  Replace with proper hash later.
// --------------------------------------------------------------------
function simpleHash(obj: unknown): string {
  const str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

// --------------------------------------------------------------------
// Creation utilities
// --------------------------------------------------------------------
export function createEmptyCanonLedger(): CanonLedger {
  return {
    entries: [],
    metadata: {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
    },
  };
}

// --------------------------------------------------------------------
// Record a new entry.  Caller must supply *validated* PatchSet.
// --------------------------------------------------------------------
export function addEntry(
  ledger: CanonLedger,
  gtwg: GTWG,
  patches: PatchSet,
  tick: number,
  proposer: string,
  action?: any,
): CanonLedger {
  const entry: CanonEntry = {
    id: simpleHash({ tick, proposer, patches }),
    timestamp: new Date().toISOString(),
    tick,
    proposer,
    action,
    patches,
    gtwgHash: simpleHash(gtwg),
  };
  return {
    ...ledger,
    entries: [...ledger.entries, entry],
  };
}

// --------------------------------------------------------------------
// Retrieve ledger information
// --------------------------------------------------------------------
export function getEntries(ledger: CanonLedger): CanonEntry[] {
  return ledger.entries;
}

export function getLatestEntry(ledger: CanonLedger): CanonEntry | null {
  return ledger.entries.length ? ledger.entries[ledger.entries.length - 1] : null;
}

// --------------------------------------------------------------------
// Replay utility – rebuild GTWG by applying PatchSets in order.
// NOTE: This requires a reducer function that can take a GTWG and a
// Patch and return a new GTWG.  We accept it as a dependency injection
// to avoid circular imports with Arbiter.
// --------------------------------------------------------------------
export async function replayLedger(
  seedGTWG: GTWG,
  ledger: CanonLedger,
  applyPatch: (gtwg: GTWG, patch: Patch) => GTWG,
): Promise<GTWG> {
  let state: GTWG = seedGTWG;
  for (const entry of ledger.entries) {
    for (const patch of entry.patches) {
      state = applyPatch(state, patch);
    }
  }
  return state;
}
