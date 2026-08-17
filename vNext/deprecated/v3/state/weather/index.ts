/**
 * Chronicle Weather Engine - Public API
 * 
 * Main entry point for the weather engine system.
 * Maintains backward compatibility with existing ensureWeatherSnapshot() API.
 */

export { ChronicleWeatherEngine } from './engine';
export { deriveLocalWeather } from './localEffects';
export { getLocationWeatherMetadata, ISLE_OF_MARROW_WEATHER_METADATA } from './metadata';
export type {
  ChronicleWeatherSnapshot,
  StormCycleState,
  LocationWeatherMetadata,
  LocalWeatherEffects,
} from './types';

