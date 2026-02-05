// dynamic/types.ts - Artifact definitions (what) for dynamic loading
// =================================================================

import { z } from 'zod';

export const SystemArtifactSchema = z.object({
  kind: z.literal('system'),
  id: z.string().min(1),
  version: z.string().min(1), // semver string
  description: z.string().optional(),
  tickRate: z.enum(['per_action', 'hourly', 'daily']),
  ownership: z.array(z.string()),
  dependencies: z.array(z.object({ id: z.string(), version: z.string() })).optional(),
  code: z.string().min(1), // JS expression returning a function (gtwg, action, pressures) => Patch[]
});

export type SystemArtifact = z.infer<typeof SystemArtifactSchema>;

export const ToolArtifactSchema = z.object({
  kind: z.literal('tool'),
  id: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  // For simplicity, accept any-typed input; schema hardening can follow later
  // code must evaluate to async function (input, deps) => any
  code: z.string().min(1),
});

export type ToolArtifact = z.infer<typeof ToolArtifactSchema>;


