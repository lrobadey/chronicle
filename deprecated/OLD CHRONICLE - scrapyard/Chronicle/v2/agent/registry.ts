// registry.ts - Dynamic tool registry (how) to empower agent with runtime-extensible tools
// ========================================================================================

import type { AgentTool } from './types.js';
import type { z } from 'zod';
import { asDynamicStructuredTool } from './tools.js';

type DynamicEntry = { tool: AgentTool<any, any>; schema: z.ZodTypeAny };

const dynamicTools: DynamicEntry[] = [];

export function registerDynamicTool(tool: AgentTool<any, any>, schema: z.ZodTypeAny) {
  dynamicTools.push({ tool, schema });
}

export function listDynamicTools(): DynamicEntry[] {
  return [...dynamicTools];
}

export function asLangChainTools(): any[] {
  return dynamicTools.map(({ tool, schema }) => asDynamicStructuredTool(tool, schema));
}

export function clearDynamicTools() {
  dynamicTools.length = 0;
}

