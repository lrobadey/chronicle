// WeatherSystem.ts - V2 pure weather system (no V1 dependencies)
// Adapted from V1 reducers/WeatherReducer.ts as pure functions for V2 kernel

import { ClimateZone, PressureState, PressureSystem, WeatherState, WeatherType } from '../types/WeatherTypes';

// Pressure → weather likelihoods
const PRESSURE_WEATHER_PATTERNS: Record<PressureSystem, Record<WeatherType, number>> = {
  high: { clear: 0.8, rain: 0.1, storm: 0.0, fog: 0.1, snow: 0.0 },
  low: { clear: 0.1, rain: 0.4, storm: 0.4, fog: 0.1, snow: 0.0 },
  front: { clear: 0.0, rain: 0.5, storm: 0.4, fog: 0.1, snow: 0.0 },
  stable: { clear: 0.6, rain: 0.2, storm: 0.1, fog: 0.1, snow: 0.0 },
};

const TEMPERATURE_RANGES: Record<WeatherType, { min: number; max: number }> = {
  clear: { min: 15, max: 25 },
  rain: { min: 8, max: 18 },
  storm: { min: 5, max: 15 },
  fog: { min: 10, max: 20 },
  snow: { min: -5, max: 5 },
};

const WIND_SPEED_RANGES: Record<WeatherType, { min: number; max: number }> = {
  clear: { min: 0, max: 15 },
  rain: { min: 5, max: 25 },
  storm: { min: 20, max: 50 },
  fog: { min: 0, max: 10 },
  snow: { min: 0, max: 20 },
};

const CLIMATE_TEMPERATURES: Record<ClimateZone, { summer: { day: number; night: number }; winter: { day: number; night: number } }> = {
  tropical: { summer: { day: 32, night: 23 }, winter: { day: 28, night: 20 } },
  desert: { summer: { day: 40, night: 20 }, winter: { day: 25, night: 10 } },
  temperate: { summer: { day: 25, night: 15 }, winter: { day: 5, night: -5 } },
  cold: { summer: { day: 15, night: 5 }, winter: { day: -10, night: -20 } },
  arctic: { summer: { day: 10, night: 0 }, winter: { day: -25, night: -35 } },
  mediterranean: { summer: { day: 30, night: 20 }, winter: { day: 15, night: 5 } },
  high_altitude: { summer: { day: 15, night: 5 }, winter: { day: -5, night: -15 } },
};

function parseWorldTime(worldTime: string): { season: 'summer' | 'winter'; timeOfDay: 'day' | 'night' } {
  try {
    const date = new Date(worldTime);
    const month = date.getMonth();
    const hour = date.getHours();
    const season = month >= 11 || month <= 1 ? 'winter' : 'summer';
    const timeOfDay = hour >= 6 && hour <= 18 ? 'day' : 'night';
    return { season, timeOfDay };
  } catch {
    return { season: 'summer', timeOfDay: 'day' };
  }
}

function getClimateBaseTemperature(climateZone: ClimateZone, worldTime: string): number {
  const { season, timeOfDay } = parseWorldTime(worldTime);
  const data = CLIMATE_TEMPERATURES[climateZone] || CLIMATE_TEMPERATURES.temperate;
  return data[season][timeOfDay];
}

function getWeatherTemperatureModifier(weatherType: WeatherType): number {
  switch (weatherType) {
    case 'rain': return -2;
    case 'storm': return -5;
    case 'fog': return -1;
    case 'snow': return -10;
    default: return 0;
  }
}

function seededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  let state = Math.abs(hash);
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

export function generatePressureSystem(worldTime: string, seed: string): PressureState {
  const random = seededRandom(seed);
  const rand = random();
  const seasonal = { summer: { high: 0.4, low: 0.2, front: 0.2, stable: 0.2 }, winter: { high: 0.2, low: 0.3, front: 0.3, stable: 0.2 } } as const;
  const { season } = parseWorldTime(worldTime);
  const probs = seasonal[season];
  let cumulative = 0;
  let system: PressureSystem = 'stable';
  for (const [s, p] of Object.entries(probs)) {
    cumulative += p;
    if (rand <= cumulative) { system = s as PressureSystem; break; }
  }
  let pressure = 1013; let intensity = 2;
  switch (system) {
    case 'high': pressure = 1023 + random() * 20; intensity = Math.floor(random() * 3) + 2; break;
    case 'low': pressure = 1003 - random() * 30; intensity = Math.floor(random() * 3) + 3; break;
    case 'front': pressure = 1013 + random() * 10 - 5; intensity = Math.floor(random() * 3) + 2; break;
    default: pressure = 1013 + random() * 10 - 5; intensity = Math.floor(random() * 2) + 1;
  }
  return { system, pressure: Math.round(pressure), intensity };
}

export function generateInitialWeather(worldTime: string, climateZone: ClimateZone = 'temperate'): WeatherState {
  const { season } = parseWorldTime(worldTime);
  const random = seededRandom(`initial-${worldTime}`);
  const seasonProbs: Record<'summer' | 'winter', Record<WeatherType, number>> = {
    summer: { clear: 0.6, rain: 0.3, storm: 0.1, fog: 0.0, snow: 0.0 },
    winter: { clear: 0.4, rain: 0.2, storm: 0.1, fog: 0.2, snow: 0.1 },
  };
  let cumulative = 0; const r = random(); let type: WeatherType = 'clear';
  for (const [k, p] of Object.entries(seasonProbs[season])) { cumulative += p; if (r <= cumulative) { type = k as WeatherType; break; } }
  let intensity = 2;
  if (type === 'storm') intensity = Math.floor(random() * 2) + 3;
  else if (type === 'snow') intensity = Math.floor(random() * 2) + 2;
  else intensity = Math.floor(random() * 3) + 1;
  const temp = getClimateBaseTemperature(climateZone, worldTime) + getWeatherTemperatureModifier(type);
  const windRange = WIND_SPEED_RANGES[type];
  const wind = windRange.min + (random() * (windRange.max - windRange.min));
  const pressure = generatePressureSystem(worldTime, `initial-${worldTime}`);
  return { type, intensity: Math.round(intensity), temperature: Math.round(temp * 10) / 10, windSpeed: Math.round(wind), lastUpdate: new Date().toISOString(), climateZone, pressure };
}

export function validateInitialWeather(weather: WeatherState, worldTime: string): WeatherState {
  const { season } = parseWorldTime(worldTime);
  const bad = (
    (season === 'winter' && weather.type === 'clear' && weather.temperature > 15) ||
    (season === 'summer' && weather.type === 'snow') ||
    (season === 'winter' && weather.type === 'clear' && weather.temperature < -20) ||
    (season === 'summer' && weather.type === 'clear' && weather.temperature < 10)
  );
  return bad ? generateInitialWeather(worldTime, weather.climateZone || 'temperate') : weather;
}

export function updatePressureGradually(current: PressureState | null, worldTime: string, seed: string): PressureState {
  const random = seededRandom(seed);
  if (!current) return generatePressureSystem(worldTime, seed);
  const last = new Date(current.lastUpdate || worldTime);
  const now = new Date(worldTime);
  const hours = (now.getTime() - last.getTime()) / (1000 * 60 * 60);
  if (hours <= 0) return current;
  const shouldChange = random() < 0.05 * hours;
  let system = current.system;
  let changeRate = current.changeRate || 0;
  let trend: 'rising' | 'falling' | 'stable' = current.trend || 'stable';
  if (shouldChange) {
    const np = generatePressureSystem(worldTime, seed);
    system = np.system;
    switch (system) {
      case 'high': changeRate = 1 + random() * 2; trend = 'rising'; break;
      case 'low': changeRate = -(1 + random() * 2); trend = 'falling'; break;
      case 'front': changeRate = (random() - 0.5) * 4; trend = changeRate > 0 ? 'rising' : 'falling'; break;
      default: changeRate = (random() - 0.5) * 1; trend = Math.abs(changeRate) < 0.1 ? 'stable' : (changeRate > 0 ? 'rising' : 'falling');
    }
  } else {
    changeRate = (current.changeRate || 0) + (random() - 0.5) * 0.5;
    trend = Math.abs(changeRate) < 0.1 ? 'stable' : (changeRate > 0 ? 'rising' : 'falling');
  }
  const delta = changeRate * hours;
  const pressure = Math.max(950, Math.min(1050, current.pressure + delta));
  let intensity = current.intensity;
  if (shouldChange) intensity = Math.floor(random() * 3) + 2; else intensity = Math.max(1, Math.min(5, current.intensity + (random() - 0.5) * 0.5));
  return { system, pressure: Math.round(pressure), intensity: Math.round(intensity), changeRate: Math.round(changeRate * 100) / 100, trend, lastUpdate: worldTime };
}

export function updateWeather(current: WeatherState | null, worldTime: string, seed = 'default'): WeatherState {
  const nowIso = new Date().toISOString();
  if (!current) return generateInitialWeather(worldTime);
  const timeSeed = `${seed}-${worldTime}`;
  const random = seededRandom(timeSeed);
  const { season, timeOfDay } = parseWorldTime(worldTime);
  const date = new Date(worldTime);
  const hour = date.getHours();
  let changeProbability = 0.1;
  if (hour >= 6 && hour <= 8) changeProbability = 0.3;
  if (hour >= 18 && hour <= 20) changeProbability = 0.3;
  if (hour >= 12 && hour <= 14) changeProbability = 0.2;
  if (season === 'winter') changeProbability *= 1.5;
  if (timeOfDay === 'night') changeProbability *= 0.7;
  const pressure = generatePressureSystem(worldTime, timeSeed);
  if (pressure.system === 'low') changeProbability *= 1.8;
  if (pressure.system === 'front') changeProbability *= 2.0;
  if (pressure.system === 'high') changeProbability *= 0.6;
  const shouldChange = random() < changeProbability;
  let type = current.type;
  if (shouldChange) {
    const patterns = PRESSURE_WEATHER_PATTERNS[pressure.system];
    const r = random(); let cum = 0; for (const [k, p] of Object.entries(patterns)) { cum += p; if (r <= cum) { type = k as WeatherType; break; } }
  }
  let intensity = current.intensity;
  if (type !== current.type) intensity = Math.floor(random() * 3) + 1; else intensity = Math.max(0, Math.min(5, current.intensity + (random() - 0.5) * 2));
  const climateZone = current.climateZone || 'temperate';
  const baseTemp = getClimateBaseTemperature(climateZone, worldTime);
  const temp = baseTemp + getWeatherTemperatureModifier(type);
  const windRange = WIND_SPEED_RANGES[type];
  const wind = windRange.min + (random() * (windRange.max - windRange.min));
  return { type, intensity: Math.round(intensity), temperature: Math.round(temp * 10) / 10, windSpeed: Math.round(wind), lastUpdate: nowIso, climateZone, pressure: updatePressureGradually(current.pressure || null, worldTime, timeSeed) };
}

export function getWeatherTravelMultiplier(weather: WeatherState): number {
  switch (weather.type) {
    case 'rain': return weather.intensity <= 2 ? 0.9 : 0.8;
    case 'storm': return weather.intensity <= 3 ? 0.7 : 0.5;
    case 'fog': return weather.intensity <= 2 ? 0.8 : 0.6;
    case 'snow': return weather.intensity <= 2 ? 0.6 : 0.4;
    default: return 1.0;
  }
}


