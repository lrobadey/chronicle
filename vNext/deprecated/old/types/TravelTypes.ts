// TravelTypes.ts - Pure V2 Travel System Types
// ============================================
//
// PURE V2 ARCHITECTURE - NO V1 DEPENDENCIES
// These types are designed for optimal V2 travel system performance
// with complete freedom from V1 compatibility constraints.

import type { GTWGEntity } from './GTWGTypes.js';
import type { WeatherState } from './WeatherTypes.js';
import type { PKG } from '../data/PKG.js';
import type { Personality } from '../data/Personality.js';

// ============================================================================
// CORE TRAVEL TYPES
// ============================================================================

/**
 * Represents a single step in a travel route
 */
export interface TravelSegment {
  id: string;
  from: string;          // GTWG entity ID
  to: string;            // GTWG entity ID
  segmentType: 'containment' | 'adjacent' | 'connection' | 'teleport';
  distance: number;      // Meters
  baseTime: number;      // Minutes without modifiers
  terrain: TerrainType;
  difficulty: DifficultyLevel;
  requirements?: TravelRequirement[];
}

/**
 * Complete route from origin to destination
 */
export interface TravelRoute {
  id: string;
  origin: string;        // GTWG entity ID
  destination: string;   // GTWG entity ID
  segments: TravelSegment[];
  totalDistance: number; // Meters
  estimatedTime: number; // Minutes
  routeType: RouteType;
  createdAt: string;     // ISO timestamp
  calculatedBy: 'player' | 'ai' | 'system';
}

/**
 * Current travel state for ongoing journeys
 */
export interface TravelState {
  isActive: boolean;
  route?: TravelRoute;
  currentSegment?: number;          // Index in route.segments
  segmentProgress?: number;         // 0-1 completion of current segment
  startTime?: string;               // ISO timestamp
  estimatedArrival?: string;        // ISO timestamp
  actualTravelTime?: number;        // Minutes elapsed
  events?: TravelEvent[];           // Things that happened during travel
}

// ============================================================================
// TRAVEL MODIFIERS AND CONDITIONS
// ============================================================================

export type TerrainType = 
  | 'road' | 'path' | 'trail' | 'wilderness' | 'mountain' | 'forest' 
  | 'swamp' | 'desert' | 'water' | 'bridge' | 'tunnel' | 'air' | 'magical';

export type DifficultyLevel = 'trivial' | 'easy' | 'moderate' | 'difficult' | 'extreme' | 'impossible';

export type RouteType = 'direct' | 'scenic' | 'safe' | 'fast' | 'hidden' | 'dangerous' | 'magical';

export type TransportationMode = 
  | 'walking' | 'running' | 'horseback' | 'carriage' | 'boat' | 'ship' 
  | 'flying' | 'teleport' | 'magical' | 'climbing' | 'swimming';

/**
 * Requirements for travel (can block routes)
 */
export interface TravelRequirement {
  type: 'item' | 'skill' | 'permission' | 'weather' | 'time' | 'companion';
  requirement: string;   // What's required
  severity: 'required' | 'recommended' | 'helpful';
  alternatives?: string[]; // Alternative ways to meet requirement
}

/**
 * Factors that modify travel time and difficulty
 */
export interface TravelModifiers {
  weather: WeatherModifier;
  transportation: TransportationModifier;
  character: CharacterModifier;
  temporal: TemporalModifier;
  regional: RegionalModifier;
}

export interface WeatherModifier {
  weatherType: string;   // From WeatherState
  intensity: number;     // 0-5 scale
  timeMultiplier: number; // 1.0 = normal, 2.0 = twice as long
  difficultyIncrease: number; // 0 = no change, 1 = one level harder
  blockedRoutes: string[]; // Route types blocked by weather
}

export interface TransportationModifier {
  mode: TransportationMode;
  speedMultiplier: number; // 1.0 = walking speed
  terrainBonus: Record<TerrainType, number>; // Speed bonus/penalty per terrain
  requirements: TravelRequirement[];
  capacity: number; // How many can travel together
}

export interface CharacterModifier {
  personality: Personality;
  skills: Record<string, number>; // 'navigation': 7, 'survival': 3
  condition: CharacterCondition;
  encumbrance: number; // 0-1 scale, affects speed
  stamina: number; // 0-1 scale, affects sustained travel
}

export interface CharacterCondition {
  health: number; // 0-1 scale
  fatigue: number; // 0-1 scale
  injuries: string[]; // List of conditions affecting travel
  buffs: string[]; // Temporary bonuses
  debuffs: string[]; // Temporary penalties
}

export interface TemporalModifier {
  timeOfDay: 'dawn' | 'morning' | 'midday' | 'afternoon' | 'dusk' | 'night';
  season: 'spring' | 'summer' | 'fall' | 'winter';
  visibility: number; // 0-1 scale
  temperature: number; // Celsius
}

export interface RegionalModifier {
  regionType: string; // From GTWG region properties
  politicalSituation: 'peaceful' | 'tense' | 'hostile' | 'war';
  lawfulness: number; // 0-1 scale
  development: number; // 0-1 scale (affects road quality)
  danger: number; // 0-1 scale
}

// ============================================================================
// TRAVEL EVENTS AND DISCOVERY
// ============================================================================

/**
 * Events that can occur during travel
 */
export interface TravelEvent {
  id: string;
  type: TravelEventType;
  timestamp: string; // ISO timestamp when event occurred
  location: string; // GTWG entity ID where event happened
  title: string;
  description: string;
  consequences?: TravelConsequence[];
  choices?: TravelChoice[];
  resolved: boolean;
}

export type TravelEventType = 
  | 'discovery' | 'encounter' | 'weather_change' | 'obstacle' | 'shortcut'
  | 'rest_opportunity' | 'danger' | 'landmark' | 'npc_meeting' | 'item_found'
  | 'route_blocked' | 'vehicle_trouble' | 'getting_lost' | 'ambush';

export interface TravelConsequence {
  type: 'time' | 'health' | 'resources' | 'knowledge' | 'reputation' | 'item';
  effect: string;
  value: number;
  description: string;
}

export interface TravelChoice {
  id: string;
  description: string;
  requirements?: TravelRequirement[];
  consequences: TravelConsequence[];
  probability: number; // 0-1 scale for success
}

/**
 * Discovery made during travel
 */
export interface TravelDiscovery {
  entityId: string; // GTWG entity that was discovered
  discoveryType: 'location' | 'landmark' | 'secret' | 'shortcut' | 'danger' | 'resource';
  method: 'observation' | 'exploration' | 'accident' | 'guidance' | 'investigation';
  confidence: number; // 0-1 scale for PKG rumor confidence
  timestamp: string; // ISO timestamp
  location: string; // Where the discovery was made
}

// ============================================================================
// PATHFINDING AND ROUTING
// ============================================================================

/**
 * Node in the pathfinding graph
 */
export interface PathNode {
  entityId: string; // GTWG entity ID
  containmentLevel: number; // Depth in containment hierarchy
  coordinates?: { x: number; y: number; z?: number };
  connections: PathConnection[];
  properties: PathNodeProperties;
}

export interface PathConnection {
  targetId: string; // Connected entity ID
  connectionType: 'containment' | 'adjacent' | 'portal' | 'route';
  distance: number; // Meters
  bidirectional: boolean;
  requirements?: TravelRequirement[];
  terrain: TerrainType;
  difficulty: DifficultyLevel;
}

export interface PathNodeProperties {
  canEnter: boolean;
  canExit: boolean;
  canTraverse: boolean; // Can pass through without stopping
  isLandmark: boolean;
  hasServices: boolean; // Rest, supplies, etc.
  safety: number; // 0-1 scale
  visibility: number; // 0-1 scale (how easy to spot from distance)
}

/**
 * Pathfinding algorithm configuration
 */
export interface PathfindingConfig {
  algorithm: 'dijkstra' | 'astar' | 'hierarchical' | 'bidirectional';
  heuristic: 'distance' | 'time' | 'safety' | 'discovery';
  maxDepth: number; // Maximum containment levels to traverse
  allowUnknown: boolean; // Can route through unknown areas (PKG)
  preferKnown: boolean; // Prefer routes through known areas
  riskTolerance: number; // 0-1 scale
  optimizeFor: 'speed' | 'safety' | 'discovery' | 'resources';
}

/**
 * Result of pathfinding operation
 */
export interface PathfindingResult {
  success: boolean;
  route?: TravelRoute;
  alternativeRoutes?: TravelRoute[];
  blockedReasons?: string[]; // Why route couldn't be found
  warnings?: string[]; // Potential issues with route
  computationTime: number; // Milliseconds
  nodesExplored: number;
  algorithmUsed: string;
}

// ============================================================================
// TRAVEL ENGINE CONFIGURATION
// ============================================================================

/**
 * Configuration for the V2 Travel Engine
 */
export interface TravelEngineConfig {
  pathfinding: PathfindingConfig;
  timeCalculation: TimeCalculationConfig;
  discovery: DiscoveryConfig;
  events: EventConfig;
  performance: PerformanceConfig;
}

export interface TimeCalculationConfig {
  baseWalkingSpeed: number; // km/h
  terrainMultipliers: Record<TerrainType, number>;
  weatherEffects: boolean;
  characterEffects: boolean;
  timeOfDayEffects: boolean;
  restRequirements: boolean;
}

export interface DiscoveryConfig {
  enabled: boolean;
  personalityEffects: boolean;
  discoveryRadius: number; // Meters
  landmarkVisibility: number; // Kilometers
  secretDiscoveryChance: number; // 0-1 base probability
}

export interface EventConfig {
  enabled: boolean;
  frequency: number; // Events per hour of travel
  eventTypes: TravelEventType[];
  personalityEffects: boolean;
  weatherTriggers: boolean;
}

export interface PerformanceConfig {
  maxRouteLength: number; // Maximum segments in a route
  pathfindingTimeout: number; // Milliseconds
  cacheRoutes: boolean;
  cacheSize: number; // Number of routes to cache
  backgroundCalculation: boolean; // Use Web Workers
}

// ============================================================================
// TRAVEL ENGINE INTERFACE
// ============================================================================

/**
 * Main interface for the V2 Travel Engine
 */
export interface TravelEngine {
  // Route Planning
  calculateRoute(from: string, to: string, preferences?: RoutePreferences): Promise<PathfindingResult>;
  calculateAlternativeRoutes(from: string, to: string, count: number): Promise<TravelRoute[]>;
  validateRoute(route: TravelRoute): Promise<{ valid: boolean; issues: string[] }>;
  
  // Travel Execution
  startTravel(route: TravelRoute): Promise<TravelState>;
  continueTravel(state: TravelState, timeElapsed: number): Promise<TravelState>;
  resolveEvent(event: TravelEvent, choice: TravelChoice): Promise<TravelEvent>;
  
  // Information
  estimateTravelTime(route: TravelRoute, modifiers?: TravelModifiers): number;
  getReachableLocations(from: string, maxTime: number): Promise<string[]>;
  getLocationInfo(entityId: string): Promise<LocationInfo>;
  
  // Discovery
  simulateDiscovery(route: TravelRoute, personality: Personality): Promise<TravelDiscovery[]>;
  updateKnowledge(discoveries: TravelDiscovery[], pkg: PKG): Promise<PKG>;
}

export interface RoutePreferences {
  optimizeFor?: 'speed' | 'safety' | 'discovery' | 'scenery';
  avoidTerrain?: TerrainType[];
  requireTerrain?: TerrainType[];
  maxDifficulty?: DifficultyLevel;
  allowUnknown?: boolean;
  transportation?: TransportationMode;
}

export interface LocationInfo {
  entity: GTWGEntity;
  accessibility: 'open' | 'restricted' | 'blocked' | 'unknown';
  safety: number; // 0-1 scale
  services: string[]; // Available services
  connections: PathConnection[];
  lastVisited?: string; // ISO timestamp
  knowledgeLevel: number; // 0-1 from PKG
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type TravelResult<T> = {
  success: true;
  data: T;
  warnings?: string[];
} | {
  success: false;
  error: string;
  details?: any;
};

export interface TravelMetrics {
  totalDistance: number;
  totalTime: number;
  averageSpeed: number;
  eventsEncountered: number;
  locationsDiscovered: number;
  routesCalculated: number;
  performance: {
    averageCalculationTime: number;
    cacheHitRate: number;
    memoryUsage: number;
  };
}