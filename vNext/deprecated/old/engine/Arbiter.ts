// Arbiter.ts – Central validation & commit layer for Chronicle V2
// ===============================================================
// The Arbiter receives PatchSets from one or more systems, validates
// them, detects conflicts, applies them immutably to the GTWG, then
// records the authoritative changes in the Canon Ledger.
//
// NOTE:  This first implementation purposefully keeps validation rules
// simple.  More sophisticated ownership, bounds-checking, and expression
// evaluation will be added incrementally.

import type { Patch, PatchSet } from './PressurePatch';
import { validatePatchSet } from './PressurePatch';
import type { CanonLedger } from '../data/CanonLedger';
import { addEntry } from '../data/CanonLedger';
import type { GTWG } from '../types/GTWGTypes.js';
import {
  getEntity,
  updateEntity,
  cloneGTWG,
  getRelation,
} from '../data/GTWG';

// ---------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------
function validatePatchSetAgainstGTWG(gtwg: GTWG, patches: PatchSet): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  patches.forEach((p, idx) => {
    // Special-case: allow metadata mutations via entity="__meta__"
    if (p.entity === '__meta__') {
      if (!(p.op === 'set' || p.op === 'replace')) {
        errors.push(`Patch #${idx} metadata change must use set/replace`);
      }
      if (p.field !== 'worldTime') {
        errors.push(`Patch #${idx} metadata change only supports field 'worldTime'`);
      }
      if (!p.value || typeof p.value !== 'string') {
        errors.push(`Patch #${idx} metadata worldTime must be an ISO string`);
      }
      return; // Skip normal entity validation
    }
    if (p.op === 'create_entity') {
      // entity field is the new entity id here
      const existing = getEntity(gtwg, p.entity);
      if (existing) errors.push(`Patch #${idx} create_entity id '${p.entity}' already exists`);
      if (!p.value || typeof p.value !== 'object') errors.push(`Patch #${idx} create_entity missing value payload`);
      return;
    }
    if (p.op === 'delete_entity') {
      const existing = getEntity(gtwg, p.entity);
      if (!existing) errors.push(`Patch #${idx} delete_entity missing entity '${p.entity}'`);
      return;
    }
    if (p.op === 'create_relation') {
      // entity field is relation id; value must be GTWGRelation with from/to
      const existingRel = getRelation(gtwg, p.entity);
      if (existingRel) errors.push(`Patch #${idx} create_relation id '${p.entity}' already exists`);
      const rel: any = p.value;
      if (!rel || typeof rel !== 'object' || !rel.from || !rel.to || !rel.type) {
        errors.push(`Patch #${idx} create_relation missing relation payload (from,to,type)`);
      } else {
        if (!getEntity(gtwg, rel.from)) errors.push(`Patch #${idx} create_relation from '${rel.from}' missing`);
        if (!getEntity(gtwg, rel.to)) errors.push(`Patch #${idx} create_relation to '${rel.to}' missing`);
      }
      return;
    }
    if (p.op === 'delete_relation') {
      const rel = getRelation(gtwg, p.entity);
      if (!rel) errors.push(`Patch #${idx} delete_relation missing relation '${p.entity}'`);
      return;
    }

    const entity = getEntity(gtwg, p.entity);
    if (!entity) {
      errors.push(`Patch #${idx} references missing entity '${p.entity}'`);
    } else if (!(p.field in entity)) {
      // Allow creating new fields with 'add' / 'set'
      if (p.op === 'increment' || p.op === 'decrement') {
        errors.push(`Patch #${idx} cannot ${p.op} non-existent field '${p.field}' on '${p.entity}'`);
      }
    }
  });
  return { valid: errors.length === 0, errors };
}

function detectConflicts(patches: PatchSet): { ok: boolean; conflicts: string[] } {
  const seen = new Map<string, Patch>();
  const conflicts: string[] = [];
  patches.forEach((p) => {
    const key = `${p.entity}:${p.field}`;
    if (seen.has(key)) {
      conflicts.push(`Multiple patches modify the same property (${key}) in the same PatchSet.`);
    } else {
      seen.set(key, p);
    }
  });
  return { ok: conflicts.length === 0, conflicts };
}

// ---------------------------------------------------------------------
// Immutable patch application
// ---------------------------------------------------------------------
export function applyPatch(gtwg: GTWG, patch: Patch): GTWG {
  // Shallow clone of GTWG handled by updateEntity, but we clone first to
  // retain immutability guarantees for unrelated fields.
  let newGTWG: GTWG = cloneGTWG(gtwg);
  const { entity, field, op, value } = patch;

  // Special-case: apply metadata mutations
  if (entity === '__meta__') {
    if (op === 'set' || op === 'replace') {
      const prevMeta: any = (newGTWG as any).metadata || {};
      const nextMeta = { ...prevMeta, [field]: value };
      newGTWG = { ...(newGTWG as any), metadata: nextMeta } as any;
    }
    return newGTWG;
  }
  const target = getEntity(newGTWG, entity);
  // Lifecycle ops handled specially; others expect target entity
  if (op !== 'create_entity' && op !== 'delete_entity' && op !== 'create_relation' && op !== 'delete_relation') {
    if (!target) return newGTWG; // Should not happen after validation
  }

  switch (op) {
    case 'create_entity': {
      // value is full GTWGEntity
      const entities = [...newGTWG.entities, value as any];
      newGTWG = { ...newGTWG, entities };
      break;
    }
    case 'delete_entity': {
      const entities = newGTWG.entities.filter((e: any) => e.id !== entity);
      const relations = newGTWG.relations.filter((r: any) => r.from !== entity && r.to !== entity);
      newGTWG = { ...newGTWG, entities, relations };
      break;
    }
    case 'create_relation': {
      const relations = [...newGTWG.relations, value as any];
      newGTWG = { ...newGTWG, relations };
      break;
    }
    case 'delete_relation': {
      const relations = newGTWG.relations.filter((r: any) => r.id !== entity);
      newGTWG = { ...newGTWG, relations };
      break;
    }
    case 'set':
    case 'replace':
      newGTWG = updateEntity(newGTWG, entity, { [field]: value });
      break;
    case 'add': {
      const current = (target as any)[field];
      const updated = Array.isArray(current) ? [...current, value] : value;
      newGTWG = updateEntity(newGTWG, entity, { [field]: updated });
      break;
    }
    case 'remove': {
      const update: any = { ...target };
      delete update[field];
      newGTWG = updateEntity(newGTWG, entity, update);
      break;
    }
    case 'increment': {
      const current = (target as any)[field] ?? 0;
      newGTWG = updateEntity(newGTWG, entity, { [field]: current + (typeof value === 'number' ? value : 1) });
      break;
    }
    case 'decrement': {
      const current = (target as any)[field] ?? 0;
      newGTWG = updateEntity(newGTWG, entity, { [field]: current - (typeof value === 'number' ? value : 1) });
      break;
    }
    default:
      // Unknown op – ignore safely
      break;
  }
  return newGTWG;
}

// ---------------------------------------------------------------------
// Public commit API – main entry point
// ---------------------------------------------------------------------
export interface CommitResult {
  ok: boolean;
  gtwg: GTWG;
  ledger: CanonLedger;
  rejected?: { reason: string; errors?: string[] };
}

export function commitPatchSet(
  gtwg: GTWG,
  ledger: CanonLedger,
  patches: PatchSet,
  tick: number,
  proposer: string,
  action?: any,
): CommitResult {
  // Step 1: structural validation
  const structural = validatePatchSet(patches);
  if (!structural.valid) {
    return { ok: false, gtwg, ledger, rejected: { reason: 'invalid_structure', errors: structural.errors } };
  }

  // Step 2: reference validation against GTWG
  const refVal = validatePatchSetAgainstGTWG(gtwg, patches);
  if (!refVal.valid) {
    return { ok: false, gtwg, ledger, rejected: { reason: 'invalid_reference', errors: refVal.errors } };
  }

  // Step 3: conflict detection within set
  const conflictCheck = detectConflicts(patches);
  if (!conflictCheck.ok) {
    return { ok: false, gtwg, ledger, rejected: { reason: 'conflicts', errors: conflictCheck.conflicts } };
  }

  // TODO: ownership / bounds validation hooks

  // Step 4: apply patches immutably
  let updatedGTWG = gtwg;
  patches.forEach((p) => {
    updatedGTWG = applyPatch(updatedGTWG, p);
  });

  // Step 5: write to Canon Ledger
  const updatedLedger = addEntry(ledger, updatedGTWG, patches, tick, proposer, action);

  return { ok: true, gtwg: updatedGTWG, ledger: updatedLedger };
}
