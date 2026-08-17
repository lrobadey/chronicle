// WeatherTypes.ts - V2-local weather type definitions

export type WeatherType = 'clear' | 'rain' | 'storm' | 'fog' | 'snow';

export type PressureSystem = 'high' | 'low' | 'front' | 'stable';

export type WeatherFront = 'cold' | 'warm' | 'occluded' | 'stationary';

export interface PressureState {
  system: PressureSystem;
  pressure: number; // hPa
  front?: WeatherFront;
  intensity: number; // 0-5 scale
  changeRate?: number; // hPa per hour (positive = rising, negative = falling)
  trend?: 'rising' | 'falling' | 'stable'; // Pressure trend direction
  lastUpdate?: string; // ISO timestamp of last pressure update
}

export type ClimateZone = 'tropical' | 'desert' | 'temperate' | 'cold' | 'arctic' | 'mediterranean' | 'high_altitude';

export interface WeatherState {
  type: WeatherType;
  intensity: number; // 0-5 scale
  temperature: number; // Celsius
  windSpeed: number; // km/h
  lastUpdate: string; // ISO timestamp
  climateZone?: ClimateZone; // Optional for backward compatibility
  pressure?: PressureState; // Atmospheric pressure info
}


