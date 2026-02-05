/**
 * Chronicle v4 - World State Types
 * 
 * Core type definitions for world state. Kept minimal and clean.
 */

// ============================================================================
// POSITION & SPATIAL
// ============================================================================

export type Position = { x: number; y: number; z?: number };

// ============================================================================
// LOCATION
// ============================================================================

export type Terrain = 'road' | 'path' | 'beach' | 'forest' | 'mountain' | 'water' | 'interior' | 'cavern' | 'unknown';

export interface Location {
  id: string;
  name: string;
  description: string;
  coords?: Position;
  items?: { id: string; name: string }[];
  tideAccess?: 'always' | 'low' | 'high';
  terrain?: Terrain;
  travelSpeedMultiplier?: number;
}

// ============================================================================
// NPC
// ============================================================================

export interface NPC {
  id: string;
  name: string;
  role: string;
  location: string;
  systemFunction?: string;
}

// ============================================================================
// PLAYER
// ============================================================================

export interface Player {
  id: string;
  pos: Position;
  location: string;
  inventory: { id: string; name: string }[];
}

// ============================================================================
// SYSTEMS
// ============================================================================

export type ClimateZone = 'tropical' | 'desert' | 'temperate' | 'cold' | 'arctic' | 'mediterranean' | 'high_altitude';

export interface TimeSystem {
  elapsedMinutes: number;
  startHour?: number;
  anchor?: {
    isoDateTime: string;
    calendar?: 'gregorian' | 'custom';
  };
}

export interface TideSystem {
  phase: 'low' | 'rising' | 'high' | 'falling';
  cycleMinutes: number;
}

export interface WeatherSystem {
  climate: ClimateZone;
  seed?: string;
}

export interface EconomySystem {
  goods: Record<string, 'abundant' | 'scarce'>;
}

export interface Systems {
  time?: TimeSystem;
  tide?: TideSystem;
  weather?: WeatherSystem;
  economy?: EconomySystem;
}

// ============================================================================
// WORLD STATE
// ============================================================================

export interface WorldMeta {
  turn: number;
  seed?: string;
  startedAt?: string;
}

export interface World {
  player: Player;
  locations: Record<string, Location>;
  npcs?: Record<string, NPC>;
  systems?: Systems;
  ledger: string[];
  meta?: WorldMeta;
}

// ============================================================================
// FACTORY
// ============================================================================

export function createEmptyWorld(): World {
  const startedAt = new Date().toISOString();
  return {
    player: { 
      id: 'player-1', 
      pos: { x: 0, y: 0 }, 
      location: 'start', 
      inventory: [] 
    },
    locations: {
      start: {
        id: 'start',
        name: 'Starting Point',
        description: 'You are here.',
        coords: { x: 0, y: 0 },
        terrain: 'path',
      },
    },
    systems: {
      time: { elapsedMinutes: 0, startHour: 8 },
    },
    ledger: ['World initialized'],
    meta: { turn: 0, startedAt },
  };
}

