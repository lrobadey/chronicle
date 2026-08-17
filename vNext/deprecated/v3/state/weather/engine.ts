/**
 * Chronicle Weather Engine - Refactored for Realism
 * 
 * Pressure systems are now primary - they form, move, and drive weather.
 * Weather patterns emerge from pressure system dynamics.
 */

import type { ClimateZone, WeatherType, PressureSystem } from '../weather';
import type { ChronicleWeatherSnapshot, StormCycleState } from './types';

/**
 * Chronicle Weather Engine - Refactored for Realism
 * 
 * Pressure systems are now primary - they form, move, and drive weather.
 * Weather patterns emerge from pressure system dynamics.
 */
export class ChronicleWeatherEngine {
  private readonly INERTIA_WEIGHT = 0.3;
  private readonly MAX_INTENSITY_CHANGE_PER_HOUR = 1;
  private readonly PRESSURE_SYSTEM_LIFESPAN_DAYS = 3; // Pressure systems last 3-7 days
  private readonly PRESSURE_CHANGE_RATE_HPA_PER_HOUR = 0.5; // Max pressure change per hour

  /**
   * Main entry point: compute weather snapshot for given time
   */
  computeSnapshot(
    timeIso: string,
    seed: string,
    climate: ClimateZone,
    previousSnapshot?: ChronicleWeatherSnapshot
  ): ChronicleWeatherSnapshot {
    const date = new Date(timeIso);
    const dayOfYear = this._getDayOfYear(date);
    const hour = date.getUTCHours();
    const season = this._deriveSeason(date);
    const timeOfDay = this._deriveTimeOfDay(date);

    // STEP 1: Compute pressure system state (PRIMARY - drives everything)
    const pressureState = this._computePressureSystemState(
      dayOfYear,
      hour,
      season,
      seed,
      timeIso,
      previousSnapshot
    );

    // STEP 2: Compute pressure hPa from system state
    const hPa = this._computePressureHpa(pressureState, seed, timeIso);

    // STEP 3: Compute pressure trend from system movement
    const trend = this._computePressureTrend(
      pressureState,
      previousSnapshot?.pressure?.system,
      previousSnapshot?.pressure?.hPa,
      hPa
    );

    // STEP 4: Compute weather type from pressure system
    const weatherType = this._computeWeatherType(
      pressureState.system,
      pressureState.intensity,
      previousSnapshot?.type,
      timeOfDay,
      hour,
      seed,
      timeIso,
      climate
    );

    // STEP 5: Compute intensity with inertia
    const intensity = this._computeIntensity(
      weatherType,
      pressureState.intensity,
      previousSnapshot?.intensity,
      seed,
      timeIso
    );

    // STEP 6: Compute temperature
    const temperatureC = this._computeTemperature(season, timeOfDay, weatherType, climate);

    // STEP 7: Compute humidity (pressure-driven)
    const humidity = this._computeHumidity(pressureState.system, weatherType, seed, timeIso);

    // STEP 8: Compute wind (pressure-driven direction)
    const wind = this._computeWind(
      pressureState.system,
      pressureState.intensity,
      weatherType,
      hPa,
      seed,
      timeIso
    );

    // STEP 9: Derive storm cycle from weather (not the other way around)
    const stormCycle = this._deriveStormCycle(
      weatherType,
      intensity,
      pressureState,
      dayOfYear
    );

    // STEP 10: Generate signals
    const signals = this._generateSignals({
      type: weatherType,
      intensity,
      temperatureC,
      windKph: wind.speedKph,
      pressure: { system: pressureState.system, hPa, trend },
    });

    return {
      type: weatherType,
      intensity,
      temperatureC,
      windKph: wind.speedKph,
      windDirectionDeg: wind.directionDeg,
      humidity,
      pressure: {
        system: pressureState.system,
        hPa,
        trend,
      },
      stormCycle,
      signals,
      computedAt: timeIso,
      turn: previousSnapshot?.turn ?? 0,
      lastComputedTurn: previousSnapshot?.turn ?? 0,
    };
  }

  /**
   * NEW: Compute pressure system state (PRIMARY)
   * Pressure systems form, persist, and evolve over time
   */
  private _computePressureSystemState(
    dayOfYear: number,
    hour: number,
    season: 'warm' | 'cold',
    seed: string,
    timeIso: string,
    previousSnapshot?: ChronicleWeatherSnapshot
  ): {
    system: PressureSystem;
    intensity: number; // 0-1, how strong the pressure system is
    age: number; // Days since formation
  } {
    const random = this._seededRandom(`${seed}:pressure-state:${dayOfYear}:${hour}`);

    // If we have a previous pressure system, check if it persists
    if (previousSnapshot?.pressure?.system) {
      const previousSystem = previousSnapshot.pressure.system;
      const previousAge = previousSnapshot.stormCycle?.dayOfCycle ?? 0;
      
      // Pressure systems persist for 3-7 days
      const maxAge = this.PRESSURE_SYSTEM_LIFESPAN_DAYS + Math.floor(random() * 4);
      
      if (previousAge < maxAge) {
        // System persists, but may weaken or strengthen
        const intensityChange = (random() - 0.5) * 0.1; // Small changes
        const currentIntensity = Math.max(0.3, Math.min(1.0, 
          (previousSnapshot.stormCycle?.intensity ?? 0.5) + intensityChange
        ));
        
        return {
          system: previousSystem,
          intensity: currentIntensity,
          age: previousAge + (hour / 24), // Increment age
        };
      }
    }

    // New pressure system forms
    // Seasonal variation: more lows in winter, more highs in summer
    const seasonalBias = season === 'cold' ? -0.2 : 0.2; // Cold = more storms
    
    // Base weights for pressure system formation
    const weights: Record<PressureSystem, number> = {
      high: 0.3 + seasonalBias, // More highs in warm season
      low: 0.25 - seasonalBias,  // More lows in cold season
      front: 0.25,               // Fronts common year-round
      stable: 0.2,                // Stable systems less common
    };

    // Normalize
    const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
    const normalized: Record<PressureSystem, number> = {
      high: weights.high / total,
      low: weights.low / total,
      front: weights.front / total,
      stable: weights.stable / total,
    };

    const system = this._pickWeighted(random, normalized);
    const intensity = 0.5 + random() * 0.5; // Start at 50-100% intensity

    return {
      system,
      intensity,
      age: 0,
    };
  }

  /**
   * Compute pressure hPa from system state
   */
  private _computePressureHpa(
    pressureState: { system: PressureSystem; intensity: number },
    seed: string,
    timeIso: string
  ): number {
    const random = this._seededRandom(`${seed}:pressure-hpa:${timeIso}`);

    const PRESSURE_RANGES: Record<PressureSystem, { min: number; max: number }> = {
      high: { min: 1018, max: 1040 },
      low: { min: 975, max: 1005 },
      front: { min: 995, max: 1015 },
      stable: { min: 1005, max: 1020 },
    };

    const range = PRESSURE_RANGES[pressureState.system];
    const base = range.min + random() * (range.max - range.min);
    
    // Intensity affects pressure: stronger systems = more extreme pressure
    const intensityOffset = (pressureState.intensity - 0.5) * 10; // ±5 hPa
    
    return Math.round(base + intensityOffset);
  }

  /**
   * Compute pressure trend from system movement
   */
  private _computePressureTrend(
    currentState: { system: PressureSystem; intensity: number },
    previousSystem: PressureSystem | undefined,
    previousHpa: number | undefined,
    currentHpa: number
  ): 'rising' | 'falling' | 'stable' {
    // If system changed, trend based on new system type
    if (previousSystem && previousSystem !== currentState.system) {
      if (currentState.system === 'low') return 'falling';
      if (currentState.system === 'high') return 'rising';
      return 'stable';
    }

    // If same system, trend based on pressure change
    if (previousHpa !== undefined) {
      const change = currentHpa - previousHpa;
      if (Math.abs(change) < 0.5) return 'stable';
      return change > 0 ? 'rising' : 'falling';
    }

    // New system: trend based on system type
    if (currentState.system === 'low') return 'falling'; // Lows typically deepening
    if (currentState.system === 'high') return 'rising'; // Highs typically strengthening
    return 'stable';
  }

  /**
   * Compute weather type from pressure system (simplified - pressure drives weather)
   */
  private _computeWeatherType(
    pressure: PressureSystem,
    pressureIntensity: number,
    previousType: WeatherType | undefined,
    timeOfDay: 'day' | 'night',
    hour: number,
    seed: string,
    timeIso: string,
    climate: ClimateZone
  ): WeatherType {
    const random = this._seededRandom(`${seed}:weather-type:${timeIso}`);

    // Base weights from pressure system
    const PRESSURE_WEATHER_WEIGHTS: Record<PressureSystem, Record<WeatherType, number>> = {
      high: { clear: 0.75, rain: 0.15, storm: 0.02, fog: 0.08, snow: 0 },
      low: { clear: 0.05, rain: 0.35, storm: 0.45, fog: 0.05, snow: 0.1 },
      front: { clear: 0.05, rain: 0.45, storm: 0.35, fog: 0.05, snow: 0.1 },
      stable: { clear: 0.6, rain: 0.2, storm: 0.05, fog: 0.1, snow: 0.05 },
    };

    const weights = { ...PRESSURE_WEATHER_WEIGHTS[pressure] };

    // Intensity affects weather: stronger low = more storms
    if (pressure === 'low' && pressureIntensity > 0.7) {
      weights.storm = (weights.storm ?? 0) + 0.2;
      weights.rain = Math.max(0, (weights.rain ?? 0) - 0.1);
    }

    // Add inertia
    if (previousType) {
      weights[previousType] = (weights[previousType] ?? 0) + this.INERTIA_WEIGHT;
    }

    // Improved fog logic: requires dew point conditions
    const temp = this._estimateTemperatureForFog(climate, timeOfDay, hour);
    const humidity = this._estimateHumidityForFog(pressure);
    const dewPoint = this._computeDewPoint(temp, humidity);
    const tempDewDiff = temp - dewPoint;
    
    // Fog forms when temp is within 2°C of dew point, calm conditions, clear skies
    const isDawnDusk = hour >= 5 && hour <= 7 || hour >= 18 && hour <= 20;
    if (isDawnDusk && tempDewDiff < 2 && pressure === 'stable' && random() < 0.4) {
      weights.fog = (weights.fog ?? 0) + 0.3;
      weights.clear = Math.max(0, (weights.clear ?? 0) - 0.2);
    }

    return this._pickWeighted(random, weights);
  }

  /**
   * Compute wind with pressure-driven direction
   */
  private _computeWind(
    pressureSystem: PressureSystem,
    pressureIntensity: number,
    weatherType: WeatherType,
    hPa: number,
    seed: string,
    timeIso: string
  ): { speedKph: number; directionDeg: number } {
    const random = this._seededRandom(`${seed}:wind:${timeIso}`);

    // Wind speed based on weather type and pressure gradient
    const WIND_SPEED_RANGES: Record<WeatherType, { min: number; max: number }> = {
      clear: { min: 2, max: 18 },
      rain: { min: 10, max: 30 },
      storm: { min: 25, max: 60 },
      fog: { min: 0, max: 12 },
      snow: { min: 5, max: 35 },
    };

    const range = WIND_SPEED_RANGES[weatherType];
    const baseSpeed = range.min + random() * (range.max - range.min);
    
    // Pressure gradient affects wind: stronger gradient = stronger wind
    const gradientMultiplier = 0.8 + pressureIntensity * 0.4; // 0.8x to 1.2x
    const speedKph = Math.round(baseSpeed * gradientMultiplier);

    // Wind direction based on pressure system geometry
    // In Northern Hemisphere:
    // - High pressure: winds flow clockwise (outward)
    // - Low pressure: winds flow counterclockwise (inward)
    // - Front: winds perpendicular to front
    let baseDirection: number;
    
    if (pressureSystem === 'high') {
      // Clockwise flow: start from north, rotate clockwise
      baseDirection = 270 + (random() * 90); // 270-360° (W to N)
    } else if (pressureSystem === 'low') {
      // Counterclockwise flow: start from south, rotate counterclockwise
      baseDirection = 90 + (random() * 90); // 90-180° (E to S)
    } else if (pressureSystem === 'front') {
      // Perpendicular to front (varies)
      baseDirection = 180 + (random() * 180); // 180-360° (S to N)
    } else {
      // Stable: light variable winds
      baseDirection = 255 + (random() * 60 - 30); // Prevailing westerlies ±30°
    }

    const directionDeg = Math.round(baseDirection) % 360;
    return { speedKph, directionDeg };
  }

  /**
   * Derive storm cycle from weather (not the other way around)
   */
  private _deriveStormCycle(
    weatherType: WeatherType,
    intensity: number,
    pressureState: { system: PressureSystem; intensity: number; age: number },
    dayOfYear: number
  ): StormCycleState {
    // Storm cycle is now a derived observation, not a driver
    const isStormy = weatherType === 'storm' || weatherType === 'rain';
    const stormIntensity = isStormy ? intensity / 5 : 0; // Normalize to 0-1
    
    // Phase based on pressure system age and intensity
    let phase: StormCycleState['phase'];
    const ageProgress = pressureState.age / this.PRESSURE_SYSTEM_LIFESPAN_DAYS;
    
    if (stormIntensity < 0.3) {
      phase = 'calm_between';
    } else if (ageProgress < 0.3) {
      phase = 'building';
    } else if (ageProgress < 0.7) {
      phase = 'peak';
    } else {
      phase = 'decaying';
    }

    return {
      dayOfCycle: Math.floor(pressureState.age),
      phase,
      intensity: stormIntensity,
    };
  }

  /**
   * Compute dew point from temperature and humidity
   */
  private _computeDewPoint(tempC: number, relativeHumidity: number): number {
    // Simplified dew point calculation
    // More accurate: use Magnus formula, but this approximation works
    const a = 17.27;
    const b = 237.7;
    const alpha = ((a * tempC) / (b + tempC)) + Math.log(relativeHumidity);
    return (b * alpha) / (a - alpha);
  }

  /**
   * Estimate temperature for fog calculation (before full temp computed)
   */
  private _estimateTemperatureForFog(
    climate: ClimateZone,
    timeOfDay: 'day' | 'night',
    hour: number
  ): number {
    // Rough estimate for fog calculation
    const CLIMATE_ESTIMATES: Record<ClimateZone, { day: number; night: number }> = {
      tropical: { day: 32, night: 24 },
      desert: { day: 40, night: 18 },
      temperate: { day: 20, night: 10 },
      cold: { day: 5, night: -5 },
      arctic: { day: -10, night: -25 },
      mediterranean: { day: 25, night: 15 },
      high_altitude: { day: 10, night: 0 },
    };
    
    const estimate = CLIMATE_ESTIMATES[climate] ?? CLIMATE_ESTIMATES.temperate;
    return timeOfDay === 'day' ? estimate.day : estimate.night;
  }

  /**
   * Estimate humidity for fog calculation
   */
  private _estimateHumidityForFog(pressure: PressureSystem): number {
    const baseHumidity: Record<PressureSystem, number> = {
      high: 0.4,
      low: 0.8,
      front: 0.7,
      stable: 0.6, // Stable systems can have higher humidity
    };
    return baseHumidity[pressure];
  }

  /**
   * Compute intensity with inertia (max ±1 change per hour)
   */
  private _computeIntensity(
    weatherType: WeatherType,
    previousIntensity: number | undefined,
    seed: string,
    timeIso: string
  ): number {
    const random = this._seededRandom(`${seed}:intensity:${timeIso}`);

    // Base intensity by type
    const intensityBase =
      weatherType === 'storm'
        ? 3
        : weatherType === 'rain' || weatherType === 'snow'
        ? 2
        : weatherType === 'fog'
        ? 1.5
        : 1;

    // If we have previous intensity, apply inertia (max ±1 change)
    if (previousIntensity !== undefined) {
      const change = random() * 2 - 1; // -1 to +1
      const clampedChange = Math.max(
        -this.MAX_INTENSITY_CHANGE_PER_HOUR,
        Math.min(this.MAX_INTENSITY_CHANGE_PER_HOUR, change)
      );
      const newIntensity = previousIntensity + clampedChange;
      // Clamp to valid range and bias toward base intensity
      return Math.max(0, Math.min(5, (newIntensity + intensityBase) / 2));
    }

    // No previous intensity: use base + small variation
    return Math.max(0, Math.min(5, Math.round(intensityBase + random() * 2 - 0.5)));
  }

  /**
   * Compute temperature
   */
  private _computeTemperature(
    season: 'warm' | 'cold',
    timeOfDay: 'day' | 'night',
    weatherType: WeatherType,
    climate: ClimateZone
  ): number {
    const CLIMATE_BASE_TEMPS: Record<
      ClimateZone,
      { warm: { day: number; night: number }; cold: { day: number; night: number } }
    > = {
      tropical: { warm: { day: 32, night: 24 }, cold: { day: 29, night: 22 } },
      desert: { warm: { day: 40, night: 18 }, cold: { day: 26, night: 10 } },
      temperate: { warm: { day: 25, night: 15 }, cold: { day: 6, night: -2 } },
      cold: { warm: { day: 15, night: 6 }, cold: { day: -5, night: -15 } },
      arctic: { warm: { day: 8, night: 0 }, cold: { day: -20, night: -30 } },
      mediterranean: { warm: { day: 30, night: 20 }, cold: { day: 14, night: 6 } },
      high_altitude: { warm: { day: 16, night: 6 }, cold: { day: -4, night: -14 } },
    };

    const WEATHER_TEMP_OFFSETS: Record<WeatherType, number> = {
      clear: 0,
      rain: -3,
      storm: -6,
      fog: -1,
      snow: -12,
    };

    const baseTemp = CLIMATE_BASE_TEMPS[climate] ?? CLIMATE_BASE_TEMPS.temperate;
    const seasonal = baseTemp[season];
    const base = timeOfDay === 'day' ? seasonal.day : seasonal.night;
    const offset = WEATHER_TEMP_OFFSETS[weatherType] ?? 0;

    return Math.round((base + offset) * 10) / 10;
  }

  /**
   * Compute humidity (0-1)
   */
  private _computeHumidity(
    pressureSystem: PressureSystem,
    weatherType: WeatherType,
    seed: string,
    timeIso: string
  ): number {
    const random = this._seededRandom(`${seed}:humidity:${timeIso}`);

    // Base humidity by pressure system
    const baseHumidity: Record<PressureSystem, number> = {
      high: 0.4,
      low: 0.8,
      front: 0.7,
      stable: 0.5,
    };

    const base = baseHumidity[pressureSystem];

    // Weather type adjustments
    const adjustments: Record<WeatherType, number> = {
      clear: -0.1,
      rain: 0.1,
      storm: 0.15,
      fog: 0.2,
      snow: 0.05,
    };

    const adjusted = base + (adjustments[weatherType] ?? 0) + (random() - 0.5) * 0.2;
    return Math.max(0, Math.min(1, adjusted));
  }

  /**
   * Generate gameplay signals
   */
  private _generateSignals(snapshot: {
    type: WeatherType;
    intensity: number;
    temperatureC: number;
    windKph: number;
    pressure: { system: PressureSystem; hPa: number; trend: 'rising' | 'falling' | 'stable' };
  }): string[] {
    const signals: string[] = [];

    if (snapshot.type === 'storm' && snapshot.intensity >= 3) {
      signals.push('storm_risk:high');
    }
    if (snapshot.type === 'fog') {
      signals.push('visibility:poor');
    }
    if (snapshot.temperatureC <= 0) {
      signals.push('cold:harsh');
    }
    if (snapshot.type === 'snow') {
      signals.push('travel:slow');
    }
    if (snapshot.type === 'rain' && snapshot.intensity >= 3) {
      signals.push('terrain:slippery');
    }
    if (snapshot.windKph >= 40) {
      signals.push('wind:high');
    }

    return signals;
  }

  // Utility methods

  private _getDayOfYear(date: Date): number {
    const start = new Date(date.getUTCFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  private _deriveSeason(date: Date): 'warm' | 'cold' {
    const month = date.getUTCMonth(); // 0-11
    return month >= 3 && month <= 8 ? 'warm' : 'cold';
  }

  private _deriveTimeOfDay(date: Date): 'day' | 'night' {
    const hour = date.getUTCHours();
    return hour >= 6 && hour < 18 ? 'day' : 'night';
  }

  private _pickWeighted<T extends string>(random: () => number, weights: Record<T, number>): T {
    const entries = Object.entries(weights).filter(([, weight]) => weight > 0) as [T, number][];
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    const target = random() * total;
    let cumulative = 0;
    for (const [key, weight] of entries) {
      cumulative += weight;
      if (target <= cumulative) {
        return key;
      }
    }
    return entries[entries.length - 1][0];
  }

  private _seededRandom(seed: string): () => number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    let state = Math.abs(hash) + 1;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }
}

