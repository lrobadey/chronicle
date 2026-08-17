import type { SimpleWorld } from './world';

export type Patch =
  | { 
      op: 'set'; 
      path: string; 
      value: any; 
      note?: string;
      // NEW: Provenance fields
      by?: string;      // 'GM' | 'narrator' | 'system'
      turn?: number;    // Turn number when applied
      seed?: string;    // Seed used for this turn
    }
  | { 
      op: 'merge'; 
      path: string; 
      value: Record<string, any>; 
      note?: string;
      // NEW: Provenance fields
      by?: string;
      turn?: number;
      seed?: string;
    };

function applyJsonPointer(root: any, path: string, value: any) {
  if (!path.startsWith('/')) throw new Error('Path must start with "/"');
  const parts = path
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = root as any;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] === undefined) current[key] = {};
    current = current[key];
  }
  const last = parts[parts.length - 1];
  current[last] = value;
}

function mergeAtPath(root: any, path: string, value: Record<string, any>) {
  if (!path.startsWith('/')) throw new Error('Path must start with "/"');
  const parts = path
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = root as any;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (current[key] === undefined) current[key] = {};
    if (i === parts.length - 1) {
      current[key] = { ...(current[key] || {}), ...value };
    } else {
      current = current[key];
    }
  }
}

export function applyPatches(world: SimpleWorld, patches: Patch[], defaultNote = 'State updated'): SimpleWorld {
  const next = JSON.parse(JSON.stringify(world)) as SimpleWorld;
  
  // Increment turn counter
  if (next.meta) {
    next.meta.turn = (next.meta.turn || 0) + 1;
  }
  
  for (const p of patches) {
    if (p.op === 'set') {
      applyJsonPointer(next, p.path, p.value);
      // Enhanced ledger entry with provenance
      const ledgerEntry = p.note || defaultNote;
      const provenance = p.by ? ` [${p.by}${p.turn ? ` T${p.turn}` : ''}]` : '';
      next.ledger = [...next.ledger, ledgerEntry + provenance];
    } else if (p.op === 'merge') {
      mergeAtPath(next, p.path, p.value);
      const ledgerEntry = p.note || defaultNote;
      const provenance = p.by ? ` [${p.by}${p.turn ? ` T${p.turn}` : ''}]` : '';
      next.ledger = [...next.ledger, ledgerEntry + provenance];
    }
  }
  return next;
}


