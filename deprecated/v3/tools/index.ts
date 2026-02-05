import type { SimpleWorld, SimpleWorldPosition } from '../state/world';
import { applyPatches as apply, Patch as StatePatch } from '../state/arbiter';
import { projectPKGFromGraph as projectGraph } from '../state/pkg';
import { ensureSeededFromWorld } from '../state/graphContext';
import { P } from '../state/graph';
import { calculateTravelTime } from '../state/travel';
import {
  QuerySchema,
  ApplyPatchesSchema,
  ProjectPKGSchema,
  CreateEntitySchema,
  CreateRelationSchema,
  MoveToPositionSchema,
  TravelToLocationSchema,
  AdvanceTimeSchema,
  type QueryWorldInput,
  type QueryWorldOutput,
  type ApplyPatchesInput,
  type ApplyPatchesOutput,
  type ProjectPKGOutput,
  type ProjectPKGInput,
  type Patch,
  type CreateEntityInput,
  type CreateEntityOutput,
  type CreateRelationInput,
  type CreateRelationOutput,
  type MoveToPositionInput,
  type MoveToPositionOutput,
  type TravelToLocationInput,
  type TravelToLocationOutput,
  type EstimateTravelInput,
  type EstimateTravelOutput,
  type AdvanceTimeInput,
  type AdvanceTimeOutput,
  EstimateTravelSchema,
} from './types';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { getTimeState } from '../state/time';

type Position = { x: number; y: number; z?: number };

function cloneWorld(world: SimpleWorld): SimpleWorld {
  return JSON.parse(JSON.stringify(world)) as SimpleWorld;
}

function coercePosition(pos: Position | SimpleWorldPosition | null | undefined): Position | undefined {
  if (!pos) return undefined;
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return undefined;
  const result: Position = { x: pos.x, y: pos.y };
  if (typeof (pos as any).z === 'number') {
    result.z = (pos as any).z;
  }
  return result;
}

function ensurePlayerPosition(world: SimpleWorld): Position {
  return (
    coercePosition(world.player.pos as Position) ||
    coercePosition(world.locations[world.player.location]?.coords || null) ||
    { x: 0, y: 0 }
  );
}

function computeTargetPosition(current: Position, input: MoveToPositionInput): Position {
  if (input.to) {
    const to = input.to;
    return {
      x: to.x,
      y: to.y,
      ...(to.z !== null && to.z !== undefined ? { z: to.z } : current.z !== undefined ? { z: current.z } : {}),
    };
  }
  const delta = input.delta || {};
  const dx = typeof delta.dx === 'number' ? delta.dx : 0;
  const dy = typeof delta.dy === 'number' ? delta.dy : 0;
  const dz = typeof delta.dz === 'number' ? delta.dz : undefined;
  const z = current.z !== undefined || dz !== undefined ? (current.z ?? 0) + (dz ?? 0) : undefined;
  return {
    x: current.x + dx,
    y: current.y + dy,
    ...(z !== undefined ? { z } : {}),
  };
}

function distanceBetween(a: Position, b: Position): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

function findNearestLocation(world: SimpleWorld, store: ReturnType<typeof ensureSeededFromWorld>, pos: Position, fallback: string) {
  let nearestId: string = fallback;
  let nearestDistance = Number.POSITIVE_INFINITY;
  const entities = Object.values(store.graph.entities);
  for (const entity of entities) {
    if (entity.type !== 'location') continue;
    const landmark = store.getPosition(entity.id) || coercePosition(entity.props?.pos as Position | undefined);
    if (!landmark) continue;
    const d = distanceBetween(pos, landmark);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearestId = entity.id;
    }
  }
  return { id: nearestId, distance: nearestDistance };
}

export type ExecTool = (name: string, args: any) => Promise<any>;

export function createToolRuntime(getWorld: () => SimpleWorld, setWorld: (w: SimpleWorld) => void) {
  return {
    async query_world(_input: QueryWorldInput): Promise<QueryWorldOutput> {
      const world = getWorld();
      const store = ensureSeededFromWorld(world);
      const playerId = world.player.id;
      const located = store.getLocatedIn(playerId);
      const locId = located?.obj || world.player.location;
      const locEntity = store.getEntity(locId);
      const playerPos = ensurePlayerPosition(world);
      // Items via contains edges
      const contains = store.getRelationsBySubject(locId).filter((r) => r.pred === P.contains);
      const items = contains
        .map((r) => store.getEntity(r.obj))
        .filter(Boolean)
        .map((e) => ({ id: e!.id, name: String(e!.props?.name || e!.id) }));
      // Position if available
      const position = store.getPosition(locId);
      return {
        player: {
          id: world.player.id,
          location: locId,
          inventory: world.player.inventory,
          position: playerPos,
        },
        currentLocation: {
          id: locId,
          name: String(locEntity?.props?.name || locId),
          description: String(locEntity?.props?.description || ''),
          items,
          ...(position ? { position } : {}),
        },
      };
    },

    async apply_patches(input: ApplyPatchesInput): Promise<ApplyPatchesOutput> {
      const world = getWorld();
      const rawPatches = (input as any)?.patches;
      const patchesArray: Patch[] = Array.isArray(rawPatches) ? rawPatches : [];

      if (!Array.isArray(rawPatches)) {
        console.warn('apply_patches called without a valid patches array; treating as no-op.', {
          inputSnapshot: input,
        });
      }

      if (patchesArray.length === 0) {
        return { ok: true };
      }

      const patches: StatePatch[] = patchesArray.map((p) => (p as any));
      const next = apply(world, patches, input.defaultNote);
      setWorld(next);
      return { ok: true };
    },

    async move_to_position(input: MoveToPositionInput): Promise<MoveToPositionOutput> {
      const world = getWorld();
      const store = ensureSeededFromWorld(world);
      const currentPos = ensurePlayerPosition(world);
      const targetPos = computeTargetPosition(currentPos, input);
      const distance = distanceBetween(currentPos, targetPos);
      const { id: nearestLocId, distance: nearestDist } = findNearestLocation(world, store, targetPos, world.player.location);
      const nextWorld = cloneWorld(world);
      nextWorld.player.pos = {
        x: targetPos.x,
        y: targetPos.y,
        ...(targetPos.z !== undefined ? { z: targetPos.z } : {}),
      };
      nextWorld.player.location = nearestLocId;
      const nearestEntity = store.getEntity(nearestLocId);
      const nearestName =
        nextWorld.locations[nearestLocId]?.name ||
        (typeof nearestEntity?.props?.name === 'string' ? nearestEntity.props.name : undefined) ||
        nearestLocId;
      const speed = typeof input.speedMetersPerSecond === 'number' && input.speedMetersPerSecond! > 0 ? input.speedMetersPerSecond! : undefined;
      const etaSeconds = speed && Number.isFinite(distance) && distance > 0 ? distance / speed : undefined;
      const autoDetails: string[] = [];
      autoDetails.push(
        `Player moved to (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}${
          targetPos.z !== undefined ? `, ${targetPos.z.toFixed(1)}` : ''
        })`
      );
      if (Number.isFinite(distance) && distance > 0.01) {
        autoDetails.push(`distance ≈ ${distance.toFixed(1)}m`);
      }
      if (etaSeconds !== undefined && Number.isFinite(etaSeconds)) {
        autoDetails.push(`ETA ${etaSeconds.toFixed(1)}s @ ${speed!.toFixed(1)}m/s`);
      }
      if (Number.isFinite(nearestDist)) {
        autoDetails.push(`nearest ${nearestName}`);
      }
      const autoNote = autoDetails.join(' | ');
      const ledgerNote = (input.note && input.note.trim().length > 0) ? input.note.trim() : autoNote;
      nextWorld.ledger = [...nextWorld.ledger, ledgerNote];

      // Update graph store: player position and containment relation
      store.setPosition(world.player.id, targetPos);
      const located = store.getLocatedIn(world.player.id);
      if (located?.obj !== nearestLocId) {
        if (located) store.removeRelation(located.id);
        store.addRelation({ id: `located_in:${world.player.id}`, subj: world.player.id, pred: P.located_in, obj: nearestLocId });
      }

      setWorld(nextWorld);

      return {
        ok: true,
        position: targetPos,
        locationId: nearestLocId,
        distance,
        note: ledgerNote,
      };
    },

    async travel_to_location(input: TravelToLocationInput): Promise<TravelToLocationOutput> {
      if (!input?.locationId) {
        throw new Error('travel_to_location requires a locationId');
      }

      const world = getWorld();
      const destination = world.locations[input.locationId];
      if (!destination) {
        throw new Error(`Location '${input.locationId}' not found`);
      }
      if (!destination.coords) {
        throw new Error(`Location '${input.locationId}' is missing coordinates`);
      }

      const playerPos = ensurePlayerPosition(world);
      const calc = calculateTravelTime(world, playerPos, input.locationId, {
        baseSpeedMetersPerSecond: input.baseSpeedMetersPerSecond ?? undefined,
      });

      const roundedMinutes = Math.max(1, Math.round(calc.adjustedMinutes || 0));
      const distanceLabel = Math.round(calc.distanceMeters);
      const defaultNote = `Traveled to ${destination.name} (~${distanceLabel}m, terrain x${calc.terrainMultiplier.toFixed(2)})`;
      const note = input.note?.trim().length ? input.note.trim() : defaultNote;

      const moveResult = await this.move_to_position({
        to: destination.coords,
        speedMetersPerSecond: calc.speedMetersPerSecond,
        note,
      });

      const worldAfterMove = getWorld();
      const currentElapsed = worldAfterMove.systems?.time?.elapsedMinutes ?? 0;
      const newElapsed = currentElapsed + roundedMinutes;

      await this.apply_patches({
        patches: [
          {
            op: 'set',
            path: '/systems/time/elapsedMinutes',
            value: newElapsed,
            note: `Time passes: ${roundedMinutes} minutes (travel to ${destination.name})`,
          },
        ],
      });

      return {
        ok: true,
        position: moveResult.position,
        locationId: moveResult.locationId,
        distance: calc.distanceMeters,
        travelTimeMinutes: roundedMinutes,
        terrainMultiplier: calc.terrainMultiplier,
        note: moveResult.note,
      };
    },

    async project_pkg(): Promise<ProjectPKGOutput> {
      const world = getWorld();
      // Seed graph (idempotent) and project from graph relations
      ensureSeededFromWorld(world);
      return projectGraph(world);
    },

    async create_entity(input: CreateEntityInput): Promise<CreateEntityOutput> {
      const world = getWorld();
      const store = ensureSeededFromWorld(world);
      try {
        // If creating a location, prevent duplicates by fuzzy name reuse
        if (input.type === 'location') {
          const desiredName = String(input.props?.name || '').trim();
          const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          const target = norm(desiredName);
          if (target) {
            for (const [locId, loc] of Object.entries(world.locations)) {
              const thisName = String(loc.name || locId);
              const n = norm(thisName);
              // Exact normalized match, or user said a generic alias like 'market' matching a name containing 'market'
              if (n === target || (target.length >= 6 && n.includes(target))) {
                return { ok: true, id: locId, note: `Reused existing location: ${thisName}` };
              }
              // Handle very generic alias cases
              if ((target === 'market' && n.includes('market')) || (target === 'tavern' && n.includes('vertebra'))) {
                return { ok: true, id: locId, note: `Reused existing location (alias): ${thisName}` };
              }
            }
          }
          // Default description for locations if missing
          if (!input.props?.description) {
            input.props = { ...(input.props || {}), description: '' };
          }
        }
        const { id } = store.createEntity(input);
        const note = `Created ${input.type} entity: ${id}`;
        return { ok: true, id, note };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`create_entity failed: ${msg}`);
      }
    },

    async create_relation(input: CreateRelationInput): Promise<CreateRelationOutput> {
      const world = getWorld();
      const store = ensureSeededFromWorld(world);
      try {
        const { id } = store.createRelation(input);
        const subjEntity = store.getEntity(input.subj);
        const objEntity = store.getEntity(input.obj);
        const note = `Created ${input.pred} relation: ${subjEntity?.props?.name || input.subj} → ${objEntity?.props?.name || input.obj}`;
        return { ok: true, id, note };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`create_relation failed: ${msg}`);
      }
    },

    async estimate_travel(input: EstimateTravelInput): Promise<EstimateTravelOutput> {
      const world = getWorld();
      const playerPos = ensurePlayerPosition(world);

      let destPos: Position | undefined;
      if (input.locationId) {
        const dest = world.locations[input.locationId];
        const coords = (dest as any)?.coords || (dest as any)?.pos;
        if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
          destPos = { x: coords.x, y: coords.y, ...(typeof coords.z === 'number' ? { z: coords.z } : {}) };
        }
      }
      if (!destPos && input.to) {
        destPos = { x: input.to.x, y: input.to.y, ...(typeof input.to.z === 'number' ? { z: input.to.z } : {}) };
      }
      if (!destPos) {
        // Unresolvable destination; return zeroed estimate with note
        return {
          from: playerPos,
          to: { ...playerPos },
          distanceMeters: 0,
          etaSeconds: 0,
          terrainMultiplier: 1.0,
          speedMetersPerSecond: input.baseSpeedMetersPerSecond ?? 1.4,
          notes: ['Destination not resolvable; returning zero estimate.'],
        };
      }

      const calc = calculateTravelTime(
        world,
        { x: playerPos.x, y: playerPos.y, ...(playerPos.z !== undefined ? { z: playerPos.z } : {}) },
        { x: destPos.x, y: destPos.y, ...(destPos.z !== undefined ? { z: destPos.z } : {}) },
        { baseSpeedMetersPerSecond: input.baseSpeedMetersPerSecond ?? undefined }
      );

      return {
        from: playerPos,
        to: { ...destPos, ...(input.locationId ? { locationId: input.locationId } : {}) },
        distanceMeters: Math.round(calc.distanceMeters),
        etaSeconds: Math.max(0, Math.round((calc.adjustedMinutes || 0) * 60)),
        terrainMultiplier: calc.terrainMultiplier,
        speedMetersPerSecond: calc.speedMetersPerSecond,
      };
    },

    async advance_time(input: AdvanceTimeInput): Promise<AdvanceTimeOutput> {
      const world = getWorld();
      const timeState = getTimeState(world);
      
      if (!timeState) {
        throw new Error('Time system not initialized in world state');
      }

      const minutes = Math.max(1, Math.floor(input.minutes));
      const previousElapsedMinutes = timeState.elapsedMinutes;
      const newElapsedMinutes = previousElapsedMinutes + minutes;

      // Generate human-readable description
      let description = '';
      if (minutes >= 24 * 60) {
        const days = Math.floor(minutes / (24 * 60));
        const rem = minutes % (24 * 60);
        const hours = Math.floor(rem / 60);
        const mins = rem % 60;
        const parts: string[] = [];
        if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
        if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
        if (mins > 0) parts.push(`${mins} minute${mins !== 1 ? 's' : ''}`);
        description = parts.join(' ');
      } else if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        description = `${hours} hour${hours !== 1 ? 's' : ''}`;
        if (mins > 0) {
          description += ` and ${mins} minute${mins !== 1 ? 's' : ''}`;
        }
      } else {
        description = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
      }

      // Create patch for time advancement
      const patch: Patch = {
        op: 'set',
        path: '/systems/time/elapsedMinutes',
        value: newElapsedMinutes,
        note: input.reason || `Time passes: ${description}`,
      };

      return {
        ok: true,
        patches: [patch],
        timeAdvanced: {
          minutes,
          previousElapsedMinutes,
          newElapsedMinutes,
          description,
        },
      };
    },
  };
}

export type ToolRuntime = ReturnType<typeof createToolRuntime>;

export function createLangChainTools(runtime: ToolRuntime) {
  return [
    new DynamicStructuredTool({
      name: 'query_world',
      description: 'Inspect the current location, exits, items, and player state before acting.',
      schema: QuerySchema,
      func: async (input) => {
        const result = await runtime.query_world(input as QueryWorldInput);
        return JSON.stringify(result);
      },
    }),
    new DynamicStructuredTool({
      name: 'apply_patches',
      description: 'Apply validated patches to world state and append ledger notes.',
      schema: ApplyPatchesSchema,
      func: async (input) => {
        const result = await runtime.apply_patches(input as ApplyPatchesInput);
        return JSON.stringify(result);
      },
    }),
    new DynamicStructuredTool({
      name: 'move_to_position',
      description: 'Move the player by absolute coordinates or deltas; keeps spatial state and nearest location in sync.',
      schema: MoveToPositionSchema,
      func: async (input) => {
        const result = await runtime.move_to_position(input as MoveToPositionInput);
        return JSON.stringify(result);
      },
    }),
    new DynamicStructuredTool({
      name: 'travel_to_location',
      description: 'Travel to a known location using coordinates. Applies terrain modifiers, moves the player, and advances time.',
      schema: TravelToLocationSchema,
      func: async (input) => {
        const result = await runtime.travel_to_location(input as TravelToLocationInput);
        return JSON.stringify(result);
      },
    }),
    new DynamicStructuredTool({
      name: 'project_pkg',
      description: 'Project the ground truth world into what the player currently knows.',
      schema: ProjectPKGSchema,
      func: async (_input) => {
        const result = await runtime.project_pkg();
        return JSON.stringify(result);
      },
    }),
    new DynamicStructuredTool({
      name: 'create_entity',
      description: 'Create a new entity in the world graph (location, actor, item, etc.). Use this to add new places, characters, or objects.',
      schema: CreateEntitySchema,
      func: async (input) => {
        const result = await runtime.create_entity(input as CreateEntityInput);
        return JSON.stringify(result);
      },
    }),
    new DynamicStructuredTool({
      name: 'create_relation',
      description: 'Create a relationship between two entities (located_in, contains, etc.).',
      schema: CreateRelationSchema,
      func: async (input) => {
        const result = await runtime.create_relation(input as CreateRelationInput);
        return JSON.stringify(result);
      },
    }),
    new DynamicStructuredTool({
      name: 'estimate_travel',
      description: 'Estimate distance and ETA to a destination without moving or patching state.',
      schema: EstimateTravelSchema,
      func: async (input) => {
        const result = await (runtime as any).estimate_travel(input as EstimateTravelInput);
        return JSON.stringify(result as EstimateTravelOutput);
      },
    }),
    new DynamicStructuredTool({
      name: 'advance_time',
      description: 'Advance world time by a specified number of minutes. Returns patches ready to apply. Use for waiting, searching, conversations, crafting, resting.',
      schema: AdvanceTimeSchema,
      func: async (input) => {
        const result = await (runtime as any).advance_time(input as AdvanceTimeInput);
        return JSON.stringify(result as AdvanceTimeOutput);
      },
    }),
  ];
}


