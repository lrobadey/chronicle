/**
 * Location Weather Metadata
 * 
 * Static authored data for locations that describes how weather affects them.
 * This is the "data on data" that makes weather feel realistic per location.
 */

import type { LocationWeatherMetadata } from './types';

/**
 * Isle of Marrow location weather metadata
 * 
 * Each location has physical characteristics that determine how global weather
 * is experienced locally.
 */
export const ISLE_OF_MARROW_WEATHER_METADATA: Record<string, LocationWeatherMetadata> = {
  'the-landing': {
    elevation: 'low',
    nearOcean: true,
    coastalExposure: 'medium',
    fogProne: true,
    drainage: 'normal',
    indoors: false,
    enclosed: 'low',
    windExposure: 'medium',
  },

  'the-rib-market': {
    elevation: 'medium',
    nearOcean: true,
    coastalExposure: 'low', // Protected by ribs
    fogProne: false,
    drainage: 'good',
    indoors: false, // Open-air market
    enclosed: 'medium', // Partially protected by ribs
    windExposure: 'low',
  },

  'the-drunken-vertebra': {
    elevation: 'medium',
    nearOcean: true,
    coastalExposure: 'low',
    fogProne: false,
    drainage: 'good',
    indoors: true, // Built into vertebra
    enclosed: 'high',
    windExposure: 'low',
  },

  'the-spine-ridge': {
    elevation: 'high',
    nearOcean: true, // Cliff views
    coastalExposure: 'high',
    fogProne: false, // Above fog line
    drainage: 'good',
    indoors: false,
    enclosed: 'low',
    windExposure: 'high', // Very exposed
  },

  'the-heartspring': {
    elevation: 'below',
    nearOcean: false,
    coastalExposure: 'low',
    fogProne: false,
    drainage: 'good',
    indoors: true, // Cave-like
    enclosed: 'high',
    windExposure: 'low',
  },

  'the-maw': {
    elevation: 'low',
    nearOcean: true,
    coastalExposure: 'high', // Cove gets surge
    fogProne: true, // Holds fog
    drainage: 'poor', // Floods easily
    indoors: false,
    enclosed: 'medium', // Cove walls
    windExposure: 'low', // Sheltered from direct wind, but surge
  },
};

/**
 * Get weather metadata for a location
 */
export function getLocationWeatherMetadata(
  locationId: string
): LocationWeatherMetadata | undefined {
  return ISLE_OF_MARROW_WEATHER_METADATA[locationId];
}

