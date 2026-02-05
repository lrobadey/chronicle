import { z } from 'zod';

export interface QueryWorldInput { query?: string }
export interface QueryWorldOutput {
  player: {
    id: string;
    location: string;
    inventory: { id: string; name: string }[];
    position?: { x: number; y: number; z?: number };
  };
  currentLocation: {
    id: string;
    name: string;
    description: string;
    items?: { id: string; name: string }[];
    position?: { x: number; y: number; z?: number };
  };
}

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

export interface ApplyPatchesInput { patches: Patch[]; defaultNote?: string }
export interface ApplyPatchesOutput { ok: true }

export interface ProjectPKGInput { }
export interface ProjectPKGOutput { 
  playerId: string; 
  currentLocationId: string; 
  knownLocations: Array<{
    id: string;
    name: string;
    visited: boolean;
    lastVisitedTurn?: number;
  }>;
  knownNPCs: Array<{
    id: string;
    name: string;
    lastSeenLocationId?: string;
    lastSeenTurn?: number;
  }>;
  knownItems: Array<{
    id: string;
    name: string;
    lastSeenLocationId?: string;
    inInventory: boolean;
  }>;
  nearbyDirections: Array<{
    direction: string;
    locationId?: string;
    locationName?: string;
    distance?: number;
  }>;
}

export interface MoveToPositionInput {
  to?: { x: number; y: number; z?: number } | null;
  delta?: { dx?: number | null; dy?: number | null; dz?: number | null } | null;
  speedMetersPerSecond?: number | null;
  note?: string | null;
}

export interface MoveToPositionOutput {
  ok: true;
  position: { x: number; y: number; z?: number };
  locationId: string;
  distance: number;
  note: string;
}

export interface TravelToLocationInput {
  locationId: string;
  baseSpeedMetersPerSecond?: number | null;
  note?: string | null;
}

export interface TravelToLocationOutput {
  ok: true;
  position: { x: number; y: number; z?: number };
  locationId: string;
  distance: number;
  travelTimeMinutes: number;
  terrainMultiplier: number;
  note: string;
}

// New: estimate_travel (ETA without moving)
export interface EstimateTravelInput {
  to?: { x: number; y: number; z?: number } | null;
  locationId?: string | null;
  baseSpeedMetersPerSecond?: number | null;
}

export interface EstimateTravelOutput {
  from: { x: number; y: number; z?: number };
  to: { x: number; y: number; z?: number; locationId?: string };
  distanceMeters: number;
  etaSeconds: number;
  terrainMultiplier: number;
  speedMetersPerSecond: number;
  notes?: string[];
}

export const PatchSchema = z.object({
  op: z.enum(['set', 'merge']),
  path: z.string().min(1),
  value: z.any(),
  note: z.string().nullable().optional(),
  // NEW: Optional provenance
  by: z.string().nullable().optional(),
  turn: z.number().int().nullable().optional(),
  seed: z.string().nullable().optional(),
});

export const QuerySchema = z.object({
  query: z.string().nullable().optional(),
}).passthrough();

export const ApplyPatchesSchema = z.object({
  patches: z.array(PatchSchema),
  defaultNote: z.string().nullable().optional(),
});

export const ProjectPKGSchema = z.object({}).passthrough();

export const MoveToPositionSchema = z
  .object({
    to: z
      .object({
        x: z.number(),
        y: z.number(),
        z: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
    delta: z
      .object({
        dx: z.number().nullable().optional(),
        dy: z.number().nullable().optional(),
        dz: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
    speedMetersPerSecond: z.number().positive().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const hasTo = !!data.to;
    const delta = data.delta || {};
    const hasDelta = delta.dx !== undefined || delta.dy !== undefined || delta.dz !== undefined;
    if (!hasTo && !hasDelta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'move_to_position requires either "to" coordinates or a delta with at least one component.',
      });
    }
  });

export const TravelToLocationSchema = z.object({
  locationId: z.string().min(1),
  baseSpeedMetersPerSecond: z.number().positive().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const EstimateTravelSchema = z
  .object({
    to: z
      .object({
        x: z.number(),
        y: z.number(),
        z: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
    locationId: z.string().min(1).nullable().optional(),
    baseSpeedMetersPerSecond: z.number().positive().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const hasTo = !!data.to;
    const hasLoc = typeof data.locationId === 'string' && data.locationId.length > 0;
    if (!hasTo && !hasLoc) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'estimate_travel requires either "to" coordinates or a locationId.' });
    }
  });

export interface CreateEntityInput {
  type: string;
  props?: Record<string, any>;
  tags?: string[];
  id?: string;
}

export interface CreateEntityOutput {
  ok: true;
  id: string;
  note?: string;
}

export interface CreateRelationInput {
  subj: string;
  pred: string;
  obj: string;
  props?: Record<string, any>;
}

export interface CreateRelationOutput {
  ok: true;
  id: string;
  note?: string;
}

export const CreateEntitySchema = z.object({
  type: z.string().min(1),
  props: z.record(z.any()).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  id: z.string().nullable().optional(),
});

export const CreateRelationSchema = z.object({
  subj: z.string().min(1),
  pred: z.string().min(1),
  obj: z.string().min(1),
  props: z.record(z.any()).nullable().optional(),
});

export interface AdvanceTimeInput {
  minutes: number;
  reason?: string;
}

export interface AdvanceTimeOutput {
  ok: true;
  patches: Patch[];
  timeAdvanced: {
    minutes: number;
    previousElapsedMinutes: number;
    newElapsedMinutes: number;
    description: string;
  };
}

export const AdvanceTimeSchema = z.object({
  minutes: z.number().positive().int(),
  reason: z.string().nullable().optional(),
});


