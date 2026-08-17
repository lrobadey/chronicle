/**
 * Chronicle Weather Engine - Type Definitions
 * 
 * All TypeScript interfaces for the weather engine system.
 */

import type { WeatherType, PressureSystem, ClimateZone } from '../weather';

/**
 * Storm cycle state - tracks multi-day weather patterns
 */
export interface StormCycleState {
  /** Which day in the current storm cycle (0-6, typically 5-day cycles) */
  dayOfCycle: number;
  /** Current phase of the storm cycle */
  phase: 'building' | 'peak' | 'decaying' | 'calm_between';
  /** Storm intensity (0-1), where 1 is peak storm activity */
  intensity: number;
}

/**
 * Extended weather snapshot with storm cycle information
 * Extends the base WeatherSnapshot with additional storm cycle data
 */
export interface ChronicleWeatherSnapshot {
  // Core state (from base WeatherSnapshot)
  type: WeatherType;
  intensity: number; // 0-5 scale
  temperatureC: number;
  windKph: number;
  windDirectionDeg?: number; // 0-360, 0 = north
  humidity?: number; // 0-1
  
  // Pressure system
  pressure: {
    system: PressureSystem;
    hPa: number;
    trend: 'rising' | 'falling' | 'stable';
  };
  
  // Storm cycle state (new)
  stormCycle: StormCycleState;
  
  // Gameplay signals
  signals: string[];
  
  // Metadata
  computedAt: string; // ISO timestamp
  turn: number;
  lastComputedTurn: number; // For backward compatibility
}

/**
 * Location weather metadata - static authored data per location
 * These tags describe how weather affects each location differently
 */
export interface LocationWeatherMetadata {
  /** Elevation relative to sea level */
  elevation: 'low' | 'medium' | 'high' | 'below';
  /** Is this location near the ocean? */
  nearOcean: boolean;
  /** How exposed to coastal weather is this location? */
  coastalExposure: 'low' | 'medium' | 'high';
  /** Is this location prone to fog? */
  fogProne: boolean;
  /** How well does water drain from this location? */
  drainage: 'poor' | 'normal' | 'good';
  /** Is this location indoors? */
  indoors: boolean;
  /** How enclosed is this location? */
  enclosed: 'low' | 'medium' | 'high';
  /** How exposed to wind is this location? */
  windExposure: 'low' | 'medium' | 'high';
}

/**
 * Local weather effects - derived from global weather + location metadata
 * These are computed per-location to show how weather feels differently
 */
export interface LocalWeatherEffects {
  /** Visibility level at this location */
  visibility: 'normal' | 'low' | 'very_low';
  /** Footing conditions */
  footing: 'normal' | 'slippery' | 'dangerous';
  /** Comfort level */
  comfort: 'cozy' | 'exposed' | 'miserable';
  /** Travel speed multiplier (0.0-1.0) */
  travelMultiplier: number;
  /** Location-specific signals */
  localSignals: string[]; // e.g., 'cliff_risk:high', 'flood_risk:extreme', 'access:unsafe'
}

