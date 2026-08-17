// types.ts - Core agent types (what), no implementation details (how)
// ==================================================================================

import type { GTWG } from '../../types.js';

export interface AgentContext {
  playerId: string;
  tick: number;
  conversation: string[]; // last N messages (plain text)
  pkg: unknown; // projected PKG snapshot (keep generic for now to avoid V1 coupling)
  gtwg: GTWG; // ground truth snapshot at the beginning of the turn
}

export interface AgentInputs {
  playerInput: string;
  context: AgentContext;
}

export interface AgentOutputs {
  narrative: string;
  proposedPatches?: PatchLike[]; // proposals to go through Arbiter
  intermediateSteps?: unknown;
  raw?: unknown;
}

// Patch-like shape that mirrors v2/engine/PressurePatch.Patch without importing to avoid cycles
export interface PatchLike {
  op: 'add' | 'remove' | 'set' | 'replace' | 'increment' | 'decrement' | 'create_entity' | 'delete_entity' | 'create_relation' | 'delete_relation';
  entity: string;
  field: string;
  value?: any;
  proposer: string;
  metadata?: Record<string, any>;
}

// Tool contract (what): pure function signatures the agent can call
export interface AgentTool<I, O> {
  name: string;
  description: string;
  // how is injected elsewhere; this file only defines the call shape
  call: (input: I) => Promise<O>;
}

export interface RunSystemInput {
  system: string; // e.g., 'travel', 'weather'
  action: unknown; // structured action object
}

export interface RunSystemOutput {
  patches: PatchLike[];
  resultSummary?: Record<string, any>;
}

export interface ApplyPatchesInput {
  patches: PatchLike[];
}

export interface ApplyPatchesOutput {
  gtwg: GTWG;
  // ledger reference can be added if needed externally
}

export interface ProjectPKGInput {
  playerId: string;
  gtwg: GTWG;
}

export interface ProjectPKGOutput {
  pkg: unknown;
}

export interface QueryInput { query: Record<string, any>; }
export interface QueryOutput { data: any; }

export interface ConversationHistoryInput { n: number; }
export interface ConversationHistoryOutput { messages: string[]; }

// ==================================================================================
// Planning & Control (what) – empower agent with plan/reflect capabilities
// ==================================================================================

export interface AgentConfig {
  maxIterations?: number;         // per ReAct executor
  maxCycles?: number;             // controller-level retries/reflections
  enablePlanning?: boolean;
  enableReflection?: boolean;
  enableDynamicTools?: boolean;
}

export interface PlanStep {
  id: string;
  goal: string;
  suggestedTool?: string;
}

export interface AgentPlan {
  summary: string;
  steps: PlanStep[];
}

export interface CritiqueResult {
  shouldRetry: boolean;
  reason?: string;
  hintToAgent?: string;
}

export interface MemoryEntry {
  tick: number;
  playerId: string;
  thought?: string;
  observation?: string;
  planSummary?: string;
  finalNarrative?: string;
}

export interface AgentMemory {
  append(entry: MemoryEntry): Promise<void>;
  getRecent(playerId: string, limit: number): Promise<MemoryEntry[]>;
}

