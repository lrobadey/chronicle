export type EntityId = string;

export type Position2D = { x: number; y: number; z?: number };
export type GeoPoint = { lat: number; lon: number; elev?: number };

export interface Entity {
  id: EntityId;
  type: 'location' | 'actor' | 'item' | 'region' | string;
  props?: Record<string, any>;
  tags?: string[];
}

export interface Relation {
  id: string;
  subj: EntityId;
  pred: string; // e.g., 'exit_to' | 'located_in' | 'contains'
  obj: EntityId;
  directed?: boolean; // default true
  props?: Record<string, any>; // e.g., { direction: 'north', cost: 1 }
  t0?: number; // created_at tick
  t1?: number; // expires_at tick
  causedBy?: string; // event id
}

export interface WorldGraph {
  entities: Record<EntityId, Entity>;
  relations: Record<string, Relation>;
  bySubj: Record<EntityId, string[]>;
  byObj: Record<EntityId, string[]>;
  byPred: Record<string, string[]>;
}

export type Direction = 'north' | 'south' | 'east' | 'west' | 'up' | 'down' | string;

export const P = {
  exit_to: 'exit_to',
  located_in: 'located_in',
  contains: 'contains',
} as const;

export function createEmptyWorldGraph(): WorldGraph {
  return { entities: {}, relations: {}, bySubj: {}, byObj: {}, byPred: {} };
}

export interface PredicateSpec {
  pred: string;
  subjTypes: string[];
  objTypes: string[];
  requiredProps?: Record<string, 'string' | 'number' | 'boolean'>;
  invariants?: string[];
  symmetric?: boolean;
}

export const PREDICATES: Record<string, PredicateSpec> = {
  exit_to: {
    pred: 'exit_to',
    subjTypes: ['location'],
    objTypes: ['location'],
    requiredProps: { direction: 'string' },
  },
  located_in: {
    pred: 'located_in',
    subjTypes: ['actor', 'item'],
    objTypes: ['location'],
    invariants: ['uniqueLocatedIn'],
  },
  contains: {
    pred: 'contains',
    subjTypes: ['location', 'actor'],
    objTypes: ['item'],
  },
};

export function makeEntityId(type: string, suggestedName?: string): EntityId {
  if (suggestedName) {
    const slug = suggestedName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return `${type}-${slug}`;
  }
  return `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}


