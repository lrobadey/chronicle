export type GridPos = { x: number; y: number; z?: number };

export type Facing = 'north' | 'south' | 'east' | 'west';

export type Terrain =
  | 'road'
  | 'path'
  | 'beach'
  | 'forest'
  | 'mountain'
  | 'water'
  | 'interior'
  | 'cavern'
  | 'unknown';

export interface GridMap {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cellSizeMeters: number;
}

export type ActorId = string;
export type ItemId = string;
export type LocationId = string;

export interface Actor {
  id: ActorId;
  kind: 'player' | 'npc';
  name: string;
  pos: GridPos;
  facing?: Facing;
  inventory: ItemId[];
  stats?: Record<string, number>;
  tags?: string[];
  persona?: {
    tagline: string;
    background: string;
    voice: string;
    goals: string[];
  };
  relationships?: Record<ActorId, { trust: number; fear: number; affinity: number }>;
}

export interface Item {
  id: ItemId;
  name: string;
  description?: string;
  location:
    | { kind: 'ground'; pos: GridPos }
    | { kind: 'inventory'; actorId: ActorId }
    | { kind: 'container'; containerId: string };
  tags?: string[];
}

export interface LocationPOI {
  id: LocationId;
  name: string;
  description: string;
  anchor: GridPos;
  radiusCells?: number;
  tideAccess?: 'always' | 'low' | 'high';
  terrain?: Terrain;
  tags?: string[];
}

export interface TimeConfig {
  anchorIso: string;
  startHour: number;
}

export interface TimeState {
  elapsedMinutes: number;
}

export interface TideConfig {
  cycleMinutes: number;
}

export interface WeatherConfig {
  climate:
    | 'tropical'
    | 'desert'
    | 'temperate'
    | 'cold'
    | 'arctic'
    | 'mediterranean'
    | 'high_altitude';
  seed: string;
  cadenceMinutes: number;
}

export interface EconomyConfig {
  goods: Record<string, 'abundant' | 'scarce'>;
}

export interface SystemsState {
  time: TimeState;
  timeConfig: TimeConfig;
  tideConfig: TideConfig;
  weatherConfig: WeatherConfig;
  economyConfig?: EconomyConfig;
}

export interface WorldMeta {
  worldId: string;
  seed: string;
  version: string;
  turn: number;
  pendingPrompt?: PendingPrompt;
}

export interface PendingPrompt {
  id: string;
  kind: 'confirm_travel' | 'clarify_target' | 'clarify_explore';
  question: string;
  options?: Array<{ key: string; label: string }>;
  data?: Record<string, unknown>;
  createdTurn: number;
}

export interface KnowledgeState {
  seenLocations: Record<LocationId, true>;
  seenActors: Record<ActorId, true>;
  seenItems: Record<ItemId, true>;
  notes: string[];
}

export interface WorldState {
  meta: WorldMeta;
  map: GridMap;
  actors: Record<ActorId, Actor>;
  items: Record<ItemId, Item>;
  locations: Record<LocationId, LocationPOI>;
  systems: SystemsState;
  ledger: Array<{ turn: number; text: string; tags?: string[] }>;
  knowledge: Record<ActorId, KnowledgeState>;
}
