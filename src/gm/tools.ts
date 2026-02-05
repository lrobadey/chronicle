/**
 * Chronicle v4 - GM Tools
 * 
 * Tool definitions and runtime for GM agent.
 * OpenAI function calling format.
 */

import type { World, Position } from '../core/world';
import { ensureSeededFromWorld, P, type GraphStore } from '../core/graph';
import { calculateTravel } from '../core/travel';
import { applyPatches, type Patch } from '../core/arbiter';
import { getTimeState } from '../core/systems';

// ============================================================================
// TOOL DEFINITIONS (OpenAI format)
// ============================================================================

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'query_world',
      description: 'Inspect current location, items, and player state. Call this first every turn.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'travel_to_location',
      description: 'Travel to a known location. Advances time automatically based on distance and terrain.',
      parameters: {
        type: 'object',
        properties: {
          locationId: { type: 'string', description: 'ID of destination location' },
          note: { type: 'string', description: 'Optional ledger note' },
        },
        required: ['locationId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'apply_patches',
      description: 'Apply state changes. Use for inventory, time advancement, and other updates.',
      parameters: {
        type: 'object',
        properties: {
          patches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: ['set', 'merge'] },
                path: { type: 'string', description: 'JSON pointer (e.g., /player/inventory)' },
                value: { description: 'Value to set or merge' },
                note: { type: 'string', description: 'Ledger note' },
              },
              required: ['op', 'path', 'value'],
            },
          },
        },
        required: ['patches'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_entity',
      description: 'Create a new entity (location, item, actor) in the world.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Entity type: location, item, actor' },
          props: { type: 'object', description: 'Properties like name, description' },
          id: { type: 'string', description: 'Optional ID (auto-generated if omitted)' },
        },
        required: ['type'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'estimate_travel',
      description: 'Get distance and ETA without moving. Use when player asks "how far?".',
      parameters: {
        type: 'object',
        properties: {
          locationId: { type: 'string', description: 'Destination location ID' },
        },
        required: ['locationId'],
        additionalProperties: false,
      },
    },
  },
];

// ============================================================================
// TOOL RUNTIME
// ============================================================================

export interface ToolRuntime {
  query_world(): QueryWorldOutput;
  travel_to_location(input: { locationId: string; note?: string }): TravelOutput;
  apply_patches(input: { patches: Patch[] }): { ok: true };
  create_entity(input: { type: string; props?: Record<string, unknown>; id?: string }): { id: string };
  estimate_travel(input: { locationId: string }): EstimateTravelOutput;
}

interface QueryWorldOutput {
  player: { id: string; location: string; position: Position; inventory: { id: string; name: string }[] };
  currentLocation: { id: string; name: string; description: string; items: { id: string; name: string }[] };
}

interface TravelOutput {
  ok: true;
  position: Position;
  locationId: string;
  distance: number;
  travelTimeMinutes: number;
  note: string;
}

interface EstimateTravelOutput {
  from: Position;
  to: Position;
  distanceMeters: number;
  etaMinutes: number;
  terrainMultiplier: number;
}

export function createToolRuntime(
  getWorld: () => World,
  setWorld: (w: World) => void
): ToolRuntime {
  function query_world(): QueryWorldOutput {
    const world = getWorld();
    const store = ensureSeededFromWorld(world);
    const locId = world.player.location;
    const loc = world.locations[locId];
    
    // Get items in location
    const contains = store.getRelationsBySubject(locId).filter(r => r.pred === P.contains);
    const items = contains.map(r => {
      const e = store.getEntity(r.obj);
      return e ? { id: e.id, name: String(e.props?.name || e.id) } : null;
    }).filter(Boolean) as { id: string; name: string }[];

    return {
      player: {
        id: world.player.id,
        location: locId,
        position: world.player.pos,
        inventory: world.player.inventory,
      },
      currentLocation: {
        id: locId,
        name: loc?.name || locId,
        description: loc?.description || '',
        items,
      },
    };
  }

  function travel_to_location(input: { locationId: string; note?: string }): TravelOutput {
    const world = getWorld();
    const dest = world.locations[input.locationId];
    if (!dest) throw new Error(`Location '${input.locationId}' not found`);
    if (!dest.coords) throw new Error(`Location '${input.locationId}' has no coordinates`);

    const result = calculateTravel(world, world.player.pos, input.locationId);
    const travelMinutes = Math.max(1, Math.round(result.adjustedMinutes));
    
    // Update player position
    const newWorld = JSON.parse(JSON.stringify(world)) as World;
    newWorld.player.pos = dest.coords;
    newWorld.player.location = input.locationId;
    
    // Advance time
    const currentElapsed = newWorld.systems?.time?.elapsedMinutes ?? 0;
    if (newWorld.systems?.time) {
      newWorld.systems.time.elapsedMinutes = currentElapsed + travelMinutes;
    }
    
    // Add ledger entry
    const note = input.note || `Traveled to ${dest.name} (~${Math.round(result.distanceMeters)}m, ${travelMinutes} min)`;
    newWorld.ledger = [...newWorld.ledger, note];
    
    setWorld(newWorld);

    return {
      ok: true,
      position: dest.coords,
      locationId: input.locationId,
      distance: result.distanceMeters,
      travelTimeMinutes: travelMinutes,
      note,
    };
  }

  function apply_patches_fn(input: { patches: Patch[] }): { ok: true } {
    const world = getWorld();
    const next = applyPatches(world, input.patches || []);
    setWorld(next);
    return { ok: true };
  }

  function create_entity(input: { type: string; props?: Record<string, unknown>; id?: string }): { id: string } {
    const world = getWorld();
    const store = ensureSeededFromWorld(world);
    const result = store.createEntity(input);
    
    // If creating a location, add to world.locations
    if (input.type === 'location' && input.props?.name) {
      const newWorld = JSON.parse(JSON.stringify(world)) as World;
      newWorld.locations[result.id] = {
        id: result.id,
        name: String(input.props.name),
        description: String(input.props.description || ''),
        coords: input.props.pos as Position | undefined,
        terrain: 'unknown',
      };
      setWorld(newWorld);
    }
    
    return result;
  }

  function estimate_travel(input: { locationId: string }): EstimateTravelOutput {
    const world = getWorld();
    const dest = world.locations[input.locationId];
    if (!dest?.coords) throw new Error(`Location '${input.locationId}' not found or has no coordinates`);

    const result = calculateTravel(world, world.player.pos, input.locationId);
    
    return {
      from: world.player.pos,
      to: dest.coords,
      distanceMeters: Math.round(result.distanceMeters),
      etaMinutes: Math.max(1, Math.round(result.adjustedMinutes)),
      terrainMultiplier: result.terrainMultiplier,
    };
  }

  return {
    query_world,
    travel_to_location,
    apply_patches: apply_patches_fn,
    create_entity,
    estimate_travel,
  };
}

// ============================================================================
// TOOL DISPATCHER
// ============================================================================

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  runtime: ToolRuntime
): Promise<unknown> {
  switch (name) {
    case 'query_world':
      return runtime.query_world();
    case 'travel_to_location':
      return runtime.travel_to_location(args as { locationId: string; note?: string });
    case 'apply_patches':
      return runtime.apply_patches(args as { patches: Patch[] });
    case 'create_entity':
      return runtime.create_entity(args as { type: string; props?: Record<string, unknown>; id?: string });
    case 'estimate_travel':
      return runtime.estimate_travel(args as { locationId: string });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

