/**
 * Chronicle v4 - Deterministic Systems
 * 
 * Consolidated: weather, time, tide, and constraints.
 * These systems react to GM time patches - they don't drive, they respond.
 */

import type { World, ClimateZone, Position } from './world';

// ============================================================================
// TIME SYSTEM
// ============================================================================

export interface TimeState {
  elapsedMinutes: number;
  currentHour: number;
  currentDay: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  absolute?: {
    isoDateTime: string;
    date: Date;
  };
}

export function getTimeState(world: World): TimeState | undefined {
  const time = world.systems?.time;
  if (!time) return undefined;

  const elapsed = time.elapsedMinutes;
  const startHour = time.startHour || 0;
  const totalMinutes = startHour * 60 + elapsed;
  const currentHour = Math.floor(totalMinutes / 60) % 24;
  const currentDay = Math.floor(elapsed / (24 * 60)) + 1;
  
  const timeOfDay: TimeState['timeOfDay'] =
    currentHour >= 5 && currentHour < 12 ? 'morning' :
    currentHour >= 12 && currentHour < 17 ? 'afternoon' :
    currentHour >= 17 && currentHour < 21 ? 'evening' : 'night';

  const result: TimeState = { elapsedMinutes: elapsed, currentHour, currentDay, timeOfDay };

  // Add absolute time if anchor exists
  if (time.anchor) {
    const anchorDate = new Date(time.anchor.isoDateTime);
    const currentDate = new Date(anchorDate.getTime() + elapsed * 60 * 1000);
    result.absolute = { isoDateTime: currentDate.toISOString(), date: currentDate };
  }

  return result;
}

export function formatGameTime(elapsedMinutes: number, startHour = 8): string {
  const totalMinutes = startHour * 60 + elapsedMinutes;
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const hours12 = hours24 % 12 || 12;
  const ampm = hours24 < 12 ? 'AM' : 'PM';
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

// ============================================================================
// TIDE SYSTEM
// ============================================================================

export interface TideState {
  phase: 'low' | 'rising' | 'high' | 'falling';
  level: number; // 0.0 (low) to 1.0 (high)
  minutesUntilChange: number;
  accessible: string[];
  blocked: string[];
}

export function calculateTideState(world: World): TideState | undefined {
  const tide = world.systems?.tide;
  const time = world.systems?.time;
  if (!tide || !time) return undefined;

  const elapsed = time.elapsedMinutes;
  const cycleMinutes = tide.cycleMinutes || 720;
  
  // Sinusoidal tide: level = 0.5 + 0.5 * sin(2π * t / cycle)
  const normalized = (elapsed % cycleMinutes) / cycleMinutes;
  const level = 0.5 + 0.5 * Math.sin(2 * Math.PI * normalized);
  const derivative = Math.cos(2 * Math.PI * normalized);
  
  const phase: TideState['phase'] = 
    level < 0.25 ? 'low' :
    level > 0.75 ? 'high' :
    derivative > 0 ? 'rising' : 'falling';
  
  const quarterCycle = cycleMinutes / 4;
  const currentQuarter = Math.floor(normalized * 4);
  const minutesIntoQuarter = (normalized * 4 - currentQuarter) * quarterCycle;
  const minutesUntilChange = Math.max(1, Math.ceil(quarterCycle - minutesIntoQuarter));

  // Calculate accessible/blocked locations
  const accessible: string[] = [];
  const blocked: string[] = [];
  
  for (const [id, loc] of Object.entries(world.locations)) {
    if (loc.tideAccess === 'low' && (phase === 'high' || phase === 'rising')) {
      blocked.push(id);
    } else if (loc.tideAccess === 'always' || !loc.tideAccess) {
      accessible.push(id);
    } else if (loc.tideAccess === 'low' && (phase === 'low' || phase === 'falling')) {
      accessible.push(id);
    }
  }

  return { phase, level: Math.max(0, Math.min(1, level)), minutesUntilChange, accessible, blocked };
}

// ============================================================================
// WEATHER SYSTEM
// ============================================================================

export type WeatherType = 'clear' | 'rain' | 'storm' | 'fog' | 'snow';
export type PressureSystem = 'high' | 'low' | 'front' | 'stable';

export interface WeatherSnapshot {
  type: WeatherType;
  intensity: number; // 0-5
  temperatureC: number;
  windKph: number;
  pressure: {
    system: PressureSystem;
    hPa: number;
    trend: 'rising' | 'falling' | 'stable';
  };
  signals: string[];
}

// Seeded random generator
function seededRandom(seed: string): () => number {
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

export function computeWeather(world: World): WeatherSnapshot | undefined {
  const weather = world.systems?.weather;
  const time = getTimeState(world);
  if (!weather || !time) return undefined;

  const seed = weather.seed || world.meta?.seed || 'chronicle';
  const climate = weather.climate || 'temperate';
  const timeIso = time.absolute?.isoDateTime || new Date().toISOString();
  
  const random = seededRandom(`${seed}:${timeIso}`);
  const hour = time.currentHour;
  const isWarm = time.absolute ? [3, 4, 5, 6, 7, 8].includes(time.absolute.date.getMonth()) : true;

  // Determine pressure system
  const seasonalBias = isWarm ? 0.2 : -0.2;
  const pressureRoll = random();
  const pressureSystem: PressureSystem = 
    pressureRoll < 0.3 + seasonalBias ? 'high' :
    pressureRoll < 0.55 ? 'low' :
    pressureRoll < 0.8 ? 'front' : 'stable';

  // Pressure hPa
  const pressureRanges: Record<PressureSystem, [number, number]> = {
    high: [1018, 1040], low: [975, 1005], front: [995, 1015], stable: [1005, 1020],
  };
  const [pMin, pMax] = pressureRanges[pressureSystem];
  const hPa = Math.round(pMin + random() * (pMax - pMin));
  const trend: 'rising' | 'falling' | 'stable' = 
    pressureSystem === 'low' ? 'falling' : pressureSystem === 'high' ? 'rising' : 'stable';

  // Weather type based on pressure
  const weatherWeights: Record<PressureSystem, Record<WeatherType, number>> = {
    high: { clear: 0.75, rain: 0.15, storm: 0.02, fog: 0.08, snow: 0 },
    low: { clear: 0.05, rain: 0.35, storm: 0.45, fog: 0.05, snow: 0.1 },
    front: { clear: 0.05, rain: 0.45, storm: 0.35, fog: 0.05, snow: 0.1 },
    stable: { clear: 0.6, rain: 0.2, storm: 0.05, fog: 0.1, snow: 0.05 },
  };
  
  const weights = weatherWeights[pressureSystem];
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  let target = random() * total;
  let type: WeatherType = 'clear';
  for (const [t, w] of Object.entries(weights) as [WeatherType, number][]) {
    target -= w;
    if (target <= 0) { type = t; break; }
  }

  // Intensity
  const baseIntensity = type === 'storm' ? 3 : type === 'rain' || type === 'snow' ? 2 : type === 'fog' ? 1.5 : 1;
  const intensity = Math.max(0, Math.min(5, Math.round(baseIntensity + random() * 2 - 0.5)));

  // Temperature
  const isDay = hour >= 6 && hour < 18;
  const climateTemps: Record<ClimateZone, { day: number; night: number }> = {
    tropical: { day: 32, night: 24 }, desert: { day: 40, night: 18 }, temperate: { day: 20, night: 10 },
    cold: { day: 5, night: -5 }, arctic: { day: -10, night: -25 }, mediterranean: { day: 25, night: 15 },
    high_altitude: { day: 10, night: 0 },
  };
  const baseTemp = climateTemps[climate]?.[isDay ? 'day' : 'night'] ?? 15;
  const weatherOffset = type === 'storm' ? -6 : type === 'rain' ? -3 : type === 'snow' ? -12 : 0;
  const temperatureC = Math.round(baseTemp + weatherOffset);

  // Wind
  const windRanges: Record<WeatherType, [number, number]> = {
    clear: [2, 18], rain: [10, 30], storm: [25, 60], fog: [0, 12], snow: [5, 35],
  };
  const [wMin, wMax] = windRanges[type];
  const windKph = Math.round(wMin + random() * (wMax - wMin));

  // Signals
  const signals: string[] = [];
  if (type === 'storm' && intensity >= 3) signals.push('storm_risk:high');
  if (type === 'fog') signals.push('visibility:poor');
  if (temperatureC <= 0) signals.push('cold:harsh');
  if (type === 'snow') signals.push('travel:slow');
  if (windKph >= 40) signals.push('wind:high');

  return { type, intensity, temperatureC, windKph, pressure: { system: pressureSystem, hPa, trend }, signals };
}

export function getWeatherTravelMultiplier(weather: WeatherSnapshot): number {
  switch (weather.type) {
    case 'clear': return 1.0;
    case 'rain': return weather.intensity <= 2 ? 0.9 : 0.8;
    case 'storm': return weather.intensity <= 3 ? 0.75 : 0.6;
    case 'fog': return weather.intensity <= 2 ? 0.85 : 0.7;
    case 'snow': return weather.intensity <= 2 ? 0.7 : 0.5;
    default: return 1.0;
  }
}

// ============================================================================
// CONSTRAINTS
// ============================================================================

export interface TurnConstraints {
  maxMoveMeters: number;
  weatherMultiplier: number;
  blockedLocations: string[];
  advisories: string[];
}

export function buildTurnConstraints(world: World): TurnConstraints {
  const baseMoveMeters = 600;
  const weather = computeWeather(world);
  const tide = calculateTideState(world);
  
  const weatherMultiplier = weather ? getWeatherTravelMultiplier(weather) : 1.0;
  const maxMoveMeters = Math.max(150, Math.round(baseMoveMeters * weatherMultiplier));
  const blockedLocations = tide?.blocked ?? [];

  const advisories: string[] = [];
  if (weatherMultiplier < 0.8) advisories.push('Severe weather slowing travel');
  if (blockedLocations.length) advisories.push(`Tide blocks: ${blockedLocations.join(', ')}`);

  return { maxMoveMeters, weatherMultiplier, blockedLocations, advisories };
}

// ============================================================================
// TELEMETRY (Single Source of Truth for Turn State)
// ============================================================================

export interface Telemetry {
  turn: number;
  seed?: string;
  player: {
    id: string;
    locationId: string;
    locationName: string;
    position: Position;
    inventory: { id: string; name: string }[];
  };
  location: {
    id: string;
    name: string;
    description: string;
    items: { id: string; name: string }[];
  };
  nearbyLocations: Array<{ id: string; name: string; distance: number; bearing?: string }>;
  time?: TimeState;
  tide?: TideState;
  weather?: WeatherSnapshot;
  ledgerTail: string[];
}

function computeBearing(dx: number, dy: number): string | undefined {
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return undefined;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle >= -45 && angle < 45) return 'east';
  if (angle >= 45 && angle < 135) return 'north';
  if (angle >= 135 || angle < -135) return 'west';
  return 'south';
}

export function buildTelemetry(world: World): Telemetry {
  const locId = world.player.location;
  const loc = world.locations[locId];
  const playerPos = world.player.pos || loc?.coords || { x: 0, y: 0 };

  // Items in current location
  const items = loc?.items || [];

  // Nearby locations
  const nearbyLocations: Telemetry['nearbyLocations'] = [];
  for (const [id, location] of Object.entries(world.locations)) {
    if (id === locId || !location.coords) continue;
    const dx = location.coords.x - playerPos.x;
    const dy = location.coords.y - playerPos.y;
    const dist = Math.hypot(dx, dy, (location.coords.z ?? 0) - (playerPos.z ?? 0));
    if (dist < 200 && dist > 0.1) {
      nearbyLocations.push({ id, name: location.name, distance: dist, bearing: computeBearing(dx, dy) });
    }
  }
  nearbyLocations.sort((a, b) => a.distance - b.distance);

  return {
    turn: world.meta?.turn || 0,
    seed: world.meta?.seed,
    player: {
      id: world.player.id,
      locationId: locId,
      locationName: loc?.name || locId,
      position: playerPos,
      inventory: world.player.inventory,
    },
    location: {
      id: locId,
      name: loc?.name || locId,
      description: loc?.description || '',
      items,
    },
    nearbyLocations: nearbyLocations.slice(0, 5),
    time: getTimeState(world),
    tide: calculateTideState(world),
    weather: computeWeather(world),
    ledgerTail: world.ledger.slice(-5),
  };
}

