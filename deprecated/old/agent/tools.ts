// tools.ts - Tool definitions (how) and DynamicStructuredTool bindings for LangChain
// ==================================================================================

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type {
  AgentTool,
  RunSystemInput,
  RunSystemOutput,
  ApplyPatchesInput,
  ApplyPatchesOutput,
  ProjectPKGInput,
  ProjectPKGOutput,
  QueryInput,
  QueryOutput,
  ConversationHistoryInput,
  ConversationHistoryOutput,
  PatchLike,
} from './types.js';
import { commitPatchSet } from '../engine/Arbiter.js';
import type { GTWG } from '../types/GTWGTypes.js';
import { getSystem } from '../engine/SystemSpec.js';
import type { SystemSpec } from '../engine/SystemSpec.js';
import { createTravelReducer } from '../travel/TravelReducer.js';
import { getEntity } from '../data/GTWG.js';
import { calculateDistanceAndEta } from '../travel/Distance.js';
import { addMinutesToIso, summarizeBoundaryCrossings, getSeason, getTimeOfDay } from '../engine/WorldTime.js';

// -----------------------------------------------------------------------------
// Utility (how) helpers local to tools layer
// -----------------------------------------------------------------------------

interface ToolRuntimeDeps {
  getGTWG: () => GTWG;
  setGTWG: (gtwg: GTWG) => void;
  getLedger: () => any;
  setLedger: (ledger: any) => void;
  getTick: () => number;
  getConversation: (n: number) => Promise<string[]>;
  projectPKG: (input: ProjectPKGInput) => Promise<ProjectPKGOutput>;
  queryGTWG: (q: Record<string, any>) => Promise<any>;
  queryPKG: (q: Record<string, any>) => Promise<any>;
  // PKG mutation for discovery
  getPKG?: () => any;
  setPKG?: (pkg: any) => void;
  getPlayerId?: () => string;
  // Optional: dynamic tool registration (how)
  registerDynamicTool?: (tool: AgentTool<any, any>, schema: z.ZodTypeAny) => void;
}

// Convert PatchLike to engine Patch while keeping fields aligned
function normalizePatches(patches: PatchLike[], proposerFallback = 'agent') {
  return patches.map((p) => ({ ...p, proposer: p.proposer || proposerFallback }));
}

function resolvePlayerId(runtime: ToolRuntimeDeps, explicit?: string): string {
  if (explicit && typeof explicit === 'string' && explicit.trim()) return explicit;
  if (typeof runtime.getPlayerId === 'function') {
    const candidate = runtime.getPlayerId();
    if (candidate && typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  if (typeof runtime.getPKG === 'function') {
    try {
      const pkg = runtime.getPKG();
      const candidate = (pkg as any)?.metadata?.playerId;
      if (candidate && typeof candidate === 'string' && candidate.trim()) return candidate;
    } catch {
      /* ignore runtime PKG errors during resolution */
    }
  }
  return 'player-1';
}

// -----------------------------------------------------------------------------
// AgentTool instances (what) implemented (how) via runtime deps
// -----------------------------------------------------------------------------

export function createRunSystemTool(runtime: ToolRuntimeDeps): AgentTool<RunSystemInput, RunSystemOutput> {
  return {
    name: 'run_system',
    description: 'Execute a named V2 system reducer with the provided action and return patches.',
    async call(input) {
      const spec: SystemSpec | undefined = getSystem(input.system);
      if (!spec) {
        return { patches: [], resultSummary: { error: `Unknown system '${input.system}'` } };
      }
      const gtwg = runtime.getGTWG();
      const patches = await Promise.resolve(spec.reducer(gtwg, input.action, [] as any));
      return { patches: (patches as PatchLike[]) || [], resultSummary: { system: input.system } };
    },
  };
}

export function createApplyPatchesTool(runtime: ToolRuntimeDeps): AgentTool<ApplyPatchesInput, ApplyPatchesOutput> {
  return {
    name: 'apply_patches',
    description: 'Validate and commit patches through the Arbiter to update the GTWG.',
    async call(input) {
      const gtwg = runtime.getGTWG();
      const ledger = runtime.getLedger();
      let parsed: any = input as any;
      if (typeof input === 'string') {
        try { parsed = JSON.parse(input as any); } catch { parsed = {}; }
      }
      const normalized = normalizePatches(parsed.patches || []);
      const result = commitPatchSet(gtwg, ledger, normalized as any, runtime.getTick(), 'agent');
      if (result.ok) {
        runtime.setGTWG(result.gtwg);
        runtime.setLedger(result.ledger);
        return { gtwg: result.gtwg };
      }
      return { gtwg };
    },
  };
}

export function createProjectPKGTool(runtime: ToolRuntimeDeps): AgentTool<ProjectPKGInput, ProjectPKGOutput> {
  return {
    name: 'project_pkg',
    description: 'Project GTWG to the player knowledge graph (PKG).',
    async call(input) {
      let parsed: any = input as any;
      if (typeof input === 'string') {
        try { parsed = JSON.parse(input as any); } catch { parsed = {}; }
      }
      return runtime.projectPKG(parsed);
    },
  };
}

// Record discovery of a known entity into PKG (no GTWG change)
export function createDiscoverEntityTool(runtime: ToolRuntimeDeps): AgentTool<any, any> {
  return {
    name: 'discover_entity',
    description: 'Add a discovered entity (by id or name) to the player PKG. Does not modify GTWG.',
    async call(input) {
      let parsed: any = input;
      if (typeof input === 'string') {
        try { parsed = JSON.parse(input); } catch { parsed = {}; }
      }
      const { entityId, name } = parsed || {};
      const gtwg = runtime.getGTWG();
      // Resolve id
      let id: string | undefined = entityId;
      if (!id && name) {
        const ent = (gtwg.entities || []).find((e: any) => String(e.name).toLowerCase() === String(name).toLowerCase());
        id = ent?.id;
      }
      if (!id) {
        return { ok: false, error: 'Missing entityId or resolvable name' };
      }
      // Update PKG via runtime if available; otherwise return suggested PKG delta
      if (runtime.getPKG && runtime.setPKG) {
        const current = runtime.getPKG() || { discoveredFacts: [], rumors: [], metadata: {} };
        const exists = (current.discoveredFacts || []).some((f: any) => f.entityId === id);
        if (!exists) {
          const updated = {
            ...current,
            discoveredFacts: [...(current.discoveredFacts || []), { entityId: id, discoveredAt: new Date().toISOString(), source: 'conversation' }],
            metadata: { ...(current.metadata || {}), lastModified: new Date().toISOString() }
          };
          runtime.setPKG(updated);
          return { ok: true, discoveredEntityId: id, persisted: true };
        }
        return { ok: true, discoveredEntityId: id, persisted: true };
      }
      return { ok: true, discoveredEntityId: id, persisted: false };
    },
  };
}

export function createQueryGTWGTool(runtime: ToolRuntimeDeps): AgentTool<QueryInput, QueryOutput> {
  return {
    name: 'query_gtwg',
    description: 'Query ground truth world graph.',
    async call(input) {
      const raw: any = (input as any);
      let q: any;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          q = parsed?.query ?? parsed;
        } catch {
          q = raw;
        }
      } else {
        q = raw?.query ?? raw;
      }
      const data = await runtime.queryGTWG(q);
      return { data };
    },
  };
}

export function createQueryPKGTool(runtime: ToolRuntimeDeps): AgentTool<QueryInput, QueryOutput> {
  return {
    name: 'query_pkg',
    description: 'Query player knowledge graph (what player knows).',
    async call(input) {
      const raw: any = (input as any);
      let q: any;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          q = parsed?.query ?? parsed;
        } catch {
          q = raw;
        }
      } else {
        q = raw?.query ?? raw;
      }
      const data = await runtime.queryPKG(q);
      return { data };
    },
  };
}

export function createConversationHistoryTool(runtime: ToolRuntimeDeps): AgentTool<ConversationHistoryInput, ConversationHistoryOutput> {
  return {
    name: 'get_conversation_history',
    description: 'Retrieve last N conversation messages.',
    async call(input) {
      const messages = await runtime.getConversation(input.n);
      return { messages };
    },
  };
}

export function createRunTravelSystemTool(runtime: ToolRuntimeDeps): AgentTool<any, any> {
  return {
    name: 'run_travel_system',
    description: 'Execute travel system to calculate route and generate patches for player movement. Returns route details and patches to apply.',
    async call(input) {
      let parsed: any = input;
      if (typeof input === 'string') {
        try { parsed = JSON.parse(input); } catch { parsed = {}; }
      }
      const { fromLocationId, toLocationId, action = 'travel', playerId: inputPlayerId } = parsed;
      const playerId = resolvePlayerId(runtime, inputPlayerId);

      // Get current GTWG and PKG (project full PKG, not adapter response)
      const gtwg = runtime.getGTWG();
      const projected = await runtime.projectPKG({ playerId, gtwg } as any);
      const pkg = (projected as any)?.pkg;

      // Create travel reducer with default config
      const travelReducer = createTravelReducer();

      // Calculate route and generate patches
      const route = await travelReducer.calculateRoute(gtwg, pkg, fromLocationId, toLocationId);
      
      if (!route.success) {
        return {
          success: false,
          error: (route.blockedReasons && route.blockedReasons[0]) || 'Route not found',
          patches: []
        };
      }

      // Generate patches for the travel action
      const player = getEntity(gtwg, playerId) as any;
      if (!player) {
        return {
          success: false,
          error: `Player entity '${playerId}' not found in GTWG`,
          patches: []
        };
      }
      const existingContain = (gtwg.relations as any[]).find(r => r.type === 'contained_in' && r.from === playerId);
      const travelRoute = route.route!;
      const etaMinutes = Math.max(0, Math.round(travelReducer.estimateTravelTime(travelRoute)));
      const currentIso = ((gtwg as any)?.metadata?.worldTime) || new Date().toISOString();
      const newIso = addMinutesToIso(currentIso, etaMinutes);
      const relationId = playerId === 'player-1'
        ? `rel-player-in-${toLocationId}`
        : `rel-${playerId}-in-${toLocationId}`;
      const patches = [
        // Update player properties.current_location (merge properties)
        {
          op: 'set',
          entity: playerId,
          field: 'properties',
          value: { ...(player?.properties || {}), current_location: toLocationId },
          proposer: 'travel_system'
        },
        // Advance world time by ETA minutes
        {
          op: 'set',
          entity: '__meta__',
          field: 'worldTime',
          value: newIso,
          proposer: 'travel_system'
        },
        // Remove old containment relation if present
        ...(existingContain ? [{
          op: 'delete_relation',
          entity: existingContain.id,
          field: 'relation'
        } as any] : []),
        // Create new containment relation to destination
        {
          op: 'create_relation',
          entity: relationId,
          field: 'relation',
          value: { id: relationId, type: 'contained_in', from: playerId, to: toLocationId },
          proposer: 'travel_system'
        }
      ];

      return {
        success: true,
        route: {
          from: fromLocationId,
          to: toLocationId,
          etaMinutes,
          distance: travelRoute.totalDistance,
          segments: travelRoute.segments,
          newWorldTime: newIso
        },
        patches
      };
    },
  };
}

// Minimal calculation-only travel tool
export function createCalcTravelTool(runtime: ToolRuntimeDeps): AgentTool<any, any> {
  return {
    name: 'calc_travel',
    description: 'Calculate straight-line distance and walking ETA between two locations using grid coords and world scale.',
    async call(input) {
      let parsed: any = input;
      if (typeof input === 'string') {
        try { parsed = JSON.parse(input); } catch { parsed = {}; }
      }
      const { fromLocationId, toLocationId, walkingMetersPerMinute } = parsed;
      const gtwg = runtime.getGTWG();
      function resolveEntityId(value: string): string | null {
        if (!value) return null;
        const byId = (gtwg.entities || []).find((e: any) => e.id === value);
        if (byId) return byId.id;
        const byName = (gtwg.entities || []).find((e: any) => String(e.name).toLowerCase() === String(value).toLowerCase());
        return byName ? byName.id : null;
      }

      const fromId = resolveEntityId(fromLocationId) || fromLocationId;
      const toId = resolveEntityId(toLocationId) || toLocationId;
      const result = calculateDistanceAndEta(gtwg, fromId, toId, walkingMetersPerMinute);
      const timestamp = (gtwg as any)?.metadata?.worldTime || new Date().toISOString();
      return { ...result, timestamp };
    },
  };
}

function parseDurationInput(input: any): { minutes: number; label: string } {
  // Supports { minutes }, { hours }, { days }, or duration strings: "15m", "4h", "1d2h30m"
  if (typeof input === 'number') return { minutes: input, label: `${input}m` };
  if (typeof input === 'object' && input !== null) {
    const d = input as any;
    const total = (d.days ? d.days * 24 * 60 : 0) + (d.hours ? d.hours * 60 : 0) + (d.minutes ? d.minutes : 0);
    if (total > 0) {
      const parts: string[] = [];
      if (d.days) parts.push(`${d.days}d`);
      if (d.hours) parts.push(`${d.hours}h`);
      if (d.minutes) parts.push(`${d.minutes}m`);
      return { minutes: total, label: parts.join(' ') };
    }
  }
  if (typeof input === 'string') {
    const regex = /(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?/i;
    const m = input.trim().match(regex);
    if (m) {
      const days = m[1] ? parseInt(m[1], 10) : 0;
      const hours = m[2] ? parseInt(m[2], 10) : 0;
      const mins = m[3] ? parseInt(m[3], 10) : 0;
      const total = days * 24 * 60 + hours * 60 + mins;
      if (total > 0) {
        const parts: string[] = [];
        if (days) parts.push(`${days}d`);
        if (hours) parts.push(`${hours}h`);
        if (mins) parts.push(`${mins}m`);
        return { minutes: total, label: parts.join(' ') };
      }
    }
  }
  return { minutes: 0, label: '' };
}

// Time advancement tool - allows AI to advance time for non-travel actions
export function createAdvanceTimeTool(runtime: ToolRuntimeDeps): AgentTool<any, any> {
  return {
    name: 'advance_time',
    description: 'Advance world time by a specified duration (minutes/hours/days). Use for waiting, searching, conversations, crafting, resting.',
    async call(input) {
      let parsed: any = input;
      if (typeof input === 'string') {
        try { parsed = JSON.parse(input); } catch { parsed = { duration: input }; }
      }
      
      const { minutes: simpleMinutes, reason, duration } = parsed;
      const dur = duration !== undefined ? duration : simpleMinutes;
      const { minutes, label } = parseDurationInput(dur);
      
      // Validate
      if (typeof minutes !== 'number' || minutes <= 0) {
        return { success: false, error: 'Provide a positive number of minutes or a duration string (e.g., { minutes: 15 } or "1d2h30m").', patches: [] };
      }
      
      const gtwg = runtime.getGTWG();
      const currentIso = ((gtwg as any)?.metadata?.worldTime) || new Date().toISOString();
      const newIso = addMinutesToIso(currentIso, minutes);

      const boundaries = summarizeBoundaryCrossings(currentIso, newIso);
      const newSeason = getSeason(newIso);
      const newTod = getTimeOfDay(newIso);
      
      // Patch to advance time
      const patches = [
        {
          op: 'set',
          entity: '__meta__',
          field: 'worldTime',
          value: newIso,
          proposer: 'time_system',
          metadata: {
            reason: reason || 'AI time advancement',
            minutesAdvanced: minutes,
            humanDuration: label || `${minutes}m`,
            previousTime: currentIso,
            boundary: boundaries,
            season: newSeason,
            timeOfDay: newTod
          }
        }
      ];
      
      // Human narrative
      const oldDate = new Date(currentIso);
      const newDate = new Date(newIso);
      const hoursAdvanced = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      
      let timeDescription = '';
      if (minutes >= 24 * 60) {
        const days = Math.floor(minutes / (24 * 60));
        const rem = minutes % (24 * 60);
        const h = Math.floor(rem / 60);
        const m = rem % 60;
        timeDescription = `${days} day${days !== 1 ? 's' : ''}${h ? ` ${h} hour${h !== 1 ? 's' : ''}` : ''}${m ? ` ${m} minute${m !== 1 ? 's' : ''}` : ''}`.trim();
      } else if (hoursAdvanced > 0) {
        timeDescription = `${hoursAdvanced} hour${hoursAdvanced > 1 ? 's' : ''}`;
        if (remainingMinutes > 0) timeDescription += ` and ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`;
      } else {
        timeDescription = `${minutes} minute${minutes > 1 ? 's' : ''}`;
      }
      
      const boundaryNotes: string[] = [];
      if (boundaries.hour) boundaryNotes.push('hour');
      if (boundaries.day) boundaryNotes.push('day');
      if (boundaries.month) boundaryNotes.push('month');
      if (boundaries.year) boundaryNotes.push('year');
      const boundaryText = boundaryNotes.length ? ` (crossed ${boundaryNotes.join('/')})` : '';
      
      return {
        success: true,
        timeAdvanced: {
          minutes,
          hours: hoursAdvanced,
          remainingMinutes,
          previousTime: currentIso,
          newTime: newIso,
          timeDescription,
          boundaries,
          season: newSeason,
          timeOfDay: newTod
        },
        patches,
        narrative: `Time advances by ${timeDescription}${boundaryText}. The world moves forward from ${oldDate.toLocaleTimeString()} to ${newDate.toLocaleTimeString()}.`
      };
    },
  };
}

// -----------------------------------------------------------------------------
// LangChain bindings (how): create DynamicStructuredTool for each AgentTool
// -----------------------------------------------------------------------------

export function asDynamicStructuredTool<I, O>(tool: AgentTool<I, O>, schema: z.ZodTypeAny) {
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema,
    func: async (input: any) => {
      const result = await tool.call(input as I);
      return JSON.stringify(result);
    },
  });
}

// Zod schemas for tools
export const RunSystemSchema = z.object({ system: z.string(), action: z.any() });
export const ApplyPatchesSchema = z.object({ patches: z.array(z.object({
  op: z.enum(['add', 'remove', 'set', 'replace', 'increment', 'decrement', 'create_entity', 'delete_entity', 'create_relation', 'delete_relation']),
  entity: z.string(),
  field: z.string(),
  value: z.any().optional(),
  proposer: z.string().optional(),
  metadata: z.record(z.any()).optional(),
}))});
export const ProjectPKGSchema = z.object({ playerId: z.string(), gtwg: z.any() });
export const QuerySchema = z.any();
export const ConversationHistorySchema = z.object({ n: z.number().int().min(1).max(50) });

