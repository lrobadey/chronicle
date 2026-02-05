// dynamic/loader.ts - Loader (how) to validate/compile/register artifacts
// ================================================================

import { z } from 'zod';
import { SystemArtifactSchema, ToolArtifactSchema, type SystemArtifact, type ToolArtifact } from './types.js';
import { validateSystemSpec, registerSystem } from '../../engine/SystemSpec.js';
import type { SystemSpec } from '../../engine/SystemSpec.js';
import { registerDynamicTool } from '../registry.js';
import { z as zod } from 'zod';
import { asDynamicStructuredTool } from '../tools.js';

type LoadResult = { ok: true } | { ok: false; error: string };

function safeEvalFunction<T>(code: string, allowedGlobals: Record<string, unknown>): T | null {
  try {
    const fn = new Function(...Object.keys(allowedGlobals), `return (${code});`);
    return fn(...Object.values(allowedGlobals)) as T;
  } catch (e: any) {
    return null;
  }
}

export async function loadSystemArtifact(artifact: unknown): Promise<LoadResult> {
  const parsed = SystemArtifactSchema.safeParse(artifact);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const a: SystemArtifact = parsed.data;

  // Compile reducer from code string (no workers yet; use soft isolation)
  const reducer = safeEvalFunction<SystemSpec['reducer']>(a.code, {});
  if (!reducer) return { ok: false, error: 'Failed to compile system reducer' };

  const spec: SystemSpec = {
    id: a.id,
    reducer,
    tickRate: a.tickRate,
    ownership: a.ownership,
    description: a.description,
    version: a.version,
    dependencies: a.dependencies?.map((d) => d.id) || [],
  };

  const val = validateSystemSpec(spec);
  if (!val.ok) return { ok: false, error: val.error || 'Invalid SystemSpec' };
  const reg = registerSystem(spec);
  if (!reg.ok) return { ok: false, error: reg.error };
  return { ok: true };
}

export async function loadToolArtifact(artifact: unknown): Promise<LoadResult> {
  const parsed = ToolArtifactSchema.safeParse(artifact);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const a: ToolArtifact = parsed.data;

  // Compile tool function; contract: async (input, deps) => any
  const callable = safeEvalFunction<(input: any, deps: any) => Promise<any> | any>(a.code, {});
  if (!callable) return { ok: false, error: 'Failed to compile tool function' };

  // For now accept any input; future: parse via provided schema
  const schema = zod.object({ input: zod.any().optional() }).passthrough();

  // Register into dynamic registry
  registerDynamicTool(
    {
      name: a.id,
      description: a.description,
      call: async (input: any) => callable(input, {}),
    },
    schema
  );

  return { ok: true };
}


