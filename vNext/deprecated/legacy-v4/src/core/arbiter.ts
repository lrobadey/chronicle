/**
 * Chronicle v4 - Arbiter (Patch Application)
 * 
 * Handles applying patches to world state with provenance tracking.
 */

import type { World } from './world';

// ============================================================================
// PATCH TYPES
// ============================================================================

export interface Patch {
  op: 'set' | 'merge';
  path: string;
  value: unknown;
  note?: string;
  by?: string;      // 'GM' | 'system' | 'narrator'
  turn?: number;
  seed?: string;
}

// ============================================================================
// PATCH APPLICATION
// ============================================================================

export function applyPatches(world: World, patches: Patch[], defaultNote = 'State updated'): World {
  const next = JSON.parse(JSON.stringify(world)) as World;
  
  // Increment turn counter
  if (next.meta) {
    next.meta.turn = (next.meta.turn || 0) + 1;
  }
  
  for (const patch of patches) {
    if (patch.op === 'set') {
      applyJsonPointer(next, patch.path, patch.value);
    } else if (patch.op === 'merge') {
      mergeAtPath(next, patch.path, patch.value as Record<string, unknown>);
    }
    
    // Add to ledger with provenance
    const ledgerEntry = patch.note || defaultNote;
    const provenance = patch.by ? ` [${patch.by}${patch.turn ? ` T${patch.turn}` : ''}]` : '';
    next.ledger = [...next.ledger, ledgerEntry + provenance];
  }
  
  return next;
}

// ============================================================================
// JSON POINTER HELPERS
// ============================================================================

function applyJsonPointer(root: unknown, path: string, value: unknown): void {
  if (!path.startsWith('/')) throw new Error('Path must start with "/"');
  
  const parts = path.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = root as Record<string, unknown>;
  
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] === undefined) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  
  current[parts[parts.length - 1]] = value;
}

function mergeAtPath(root: unknown, path: string, value: Record<string, unknown>): void {
  if (!path.startsWith('/')) throw new Error('Path must start with "/"');
  
  const parts = path.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = root as Record<string, unknown>;
  
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (current[key] === undefined) current[key] = {};
    
    if (i === parts.length - 1) {
      current[key] = { ...(current[key] as Record<string, unknown> || {}), ...value };
    } else {
      current = current[key] as Record<string, unknown>;
    }
  }
}

// ============================================================================
// SYSTEM PATCHES (Reactive to GM patches)
// ============================================================================

/**
 * Compute system patches that react to GM patches.
 * Called after GM makes changes (especially time changes).
 */
export function computeSystemPatches(world: World, gmPatches: Patch[]): Patch[] {
  const systemPatches: Patch[] = [];
  
  // Check if time was updated
  const timePatched = gmPatches.some(p => p.path.includes('/systems/time'));
  
  if (timePatched && world.systems?.tide) {
    // Tide phase may need updating based on new time
    const elapsed = world.systems.time?.elapsedMinutes ?? 0;
    const cycleMinutes = world.systems.tide.cycleMinutes || 720;
    const normalized = (elapsed % cycleMinutes) / cycleMinutes;
    const level = 0.5 + 0.5 * Math.sin(2 * Math.PI * normalized);
    const derivative = Math.cos(2 * Math.PI * normalized);
    
    const newPhase: 'low' | 'rising' | 'high' | 'falling' = 
      level < 0.25 ? 'low' :
      level > 0.75 ? 'high' :
      derivative > 0 ? 'rising' : 'falling';
    
    if (newPhase !== world.systems.tide.phase) {
      systemPatches.push({
        op: 'set',
        path: '/systems/tide/phase',
        value: newPhase,
        note: `Tide shifts to ${newPhase}`,
        by: 'system',
      });
    }
  }
  
  return systemPatches;
}

