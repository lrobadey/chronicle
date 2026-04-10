import type { SpineState } from './spine';
import type { ItemComponents } from './archetypes';

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
export type FactionId = string;
export type ItemId = string;
export type LocationId = string;
export type ItemLifecycleState = 'intact' | 'opened' | 'broken' | 'empty' | 'consumed' | 'ruined' | 'unusable';

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
  /** Standing with each faction. Range: −100 (hostile) to 100 (revered). 0 = neutral/unknown. */
  factionStandings?: Record<FactionId, number>;
}

/**
 * A faction is a named group with shared interests, territory, or identity.
 * Factions are first-class Spine entities (North Star §4.1, §4.2.1).
 */
export interface FactionEntity {
  id: FactionId;
  name: string;
  description: string;
  tags?: string[];
  /** Actor IDs who are members of this faction. */
  memberIds: ActorId[];
}

export type ItemLocationInput =
  | { kind: 'ground'; pos: GridPos }
  | { kind: 'inventory'; actorId: ActorId }
  | { kind: 'container'; containerId: string };

export interface Item {
  id: ItemId;
  name: string;
  description?: string;
  tags?: string[];
  archetype?: string;
  components?: ItemComponents;
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
  openingSpec?: OpeningSpec;
  openingNarration?: string;
  pendingPrompt?: PendingPrompt;
}

export interface OpeningSpec {
  focalActorId: ActorId;
  focusLocationId: LocationId;
  hookText: string;
  playerQuestion: string;
}

export interface PendingPrompt {
  id: string;
  kind: 'confirm_travel' | 'clarify_target' | 'clarify_explore';
  question: string;
  options?: Array<{ key: string; label: string }>;
  data?: PendingPromptData;
  createdTurn: number;
}

export interface PendingPromptData {
  locationId?: string;
  estimatedMinutes?: number;
  subject?: string;
  area?: string;
  direction?: 'east' | 'west' | 'north' | 'south';
}

export interface KnowledgeState {
  seenLocations: Record<LocationId, true>;
  seenActors: Record<ActorId, true>;
  seenItems: Record<ItemId, true>;
  notes: string[];
  /** Rumors received by this actor — filtered knowledge about the social world. */
  rumors: string[];
}

export interface SceneAgenda {
  currentFocus?: string;
  pressures: string[];
  unresolvedBeats: string[];
  immediateTensions: string[];
}

export interface WorldAgenda {
  activeThreads: string[];
  introductionOpportunities: string[];
  escalationHooks: string[];
}

export interface ActiveThread {
  id: string;
  name: string;
  pressure: number;
  domain?: string;
  status: 'rising' | 'stable' | 'cooling';
  createdTurn: number;
  lastUpdatedTurn: number;
}

export interface HeldBeat {
  id: string;
  note: string;
  releaseConditions?: string[];
  createdTurn: number;
}

export interface PendingWorldEvent {
  id: string;
  summary: string;
  dueTurn?: number;
  pressure?: number;
  domain?: string;
  createdTurn: number;
}

export interface DirectorState {
  scene: SceneAgenda;
  world: WorldAgenda;
  activeThreads: ActiveThread[];
  heldBeats: HeldBeat[];
  pendingWorldEvents: PendingWorldEvent[];
  playerBehaviorPatterns: {
    favoredDomains?: string[];
    favoredActions?: string[];
  };
  capabilityCandidates: Array<{
    packId: string;
    score: number;
    reason: string;
  }>;
  /** Tracks faction momentum visible to the Steward for narrative pressure decisions. */
  factionPressures: Array<{
    factionId: FactionId;
    pressure: number;
    trend: 'rising' | 'stable' | 'falling';
  }>;
  /**
   * Internal: elapsed minutes at the last reputation drift pass.
   * Used by the reputation kernel system to compute drift delta (like decay lastSimulatedAtMinutes).
   */
  reputationDriftLastMinutes: number;
}

export interface WorldState {
  meta: WorldMeta;
  map: GridMap;
  actors: Record<ActorId, Actor>;
  items: Record<ItemId, Item>;
  locations: Record<LocationId, LocationPOI>;
  /** Faction registry — first-class simulation entities (North Star §4.2.1). */
  factions: Record<FactionId, FactionEntity>;
  spine: SpineState;
  systems: SystemsState;
  directorState: DirectorState;
  ledger: Array<{ turn: number; text: string; tags?: string[] }>;
  knowledge: Record<ActorId, KnowledgeState>;
}
