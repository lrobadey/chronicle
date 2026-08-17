import type { WorldState } from '../state';
import { deriveTime } from './time';

export type WeatherType = 'clear' | 'rain' | 'storm' | 'fog' | 'snow';
export type PressureSystem = 'high' | 'low' | 'front' | 'stable';

export interface WeatherSnapshot {
  type: WeatherType;
  intensity: number;
  temperatureC: number;
  windKph: number;
  pressure: {
    system: PressureSystem;
    hPa: number;
    trend: 'rising' | 'falling' | 'stable';
  };
  signals: string[];
}

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

export function deriveWeather(state: WorldState): WeatherSnapshot {
  const time = deriveTime(state);
  const config = state.systems.weatherConfig;
  const bucket = Math.floor(time.elapsedMinutes / config.cadenceMinutes);
  const random = seededRandom(`${config.seed}:${bucket}`);

  const isWarm = [3, 4, 5, 6, 7, 8].includes(new Date(time.absoluteIso).getMonth());
  const seasonalBias = isWarm ? 0.2 : -0.2;
  const pressureRoll = random();
  const pressureSystem: PressureSystem =
    pressureRoll < 0.3 + seasonalBias ? 'high' :
    pressureRoll < 0.55 ? 'low' :
    pressureRoll < 0.8 ? 'front' : 'stable';

  const pressureRanges: Record<PressureSystem, [number, number]> = {
    high: [1018, 1040], low: [975, 1005], front: [995, 1015], stable: [1005, 1020],
  };
  const [pMin, pMax] = pressureRanges[pressureSystem];
  const hPa = Math.round(pMin + random() * (pMax - pMin));
  const trend: 'rising' | 'falling' | 'stable' =
    pressureSystem === 'low' ? 'falling' : pressureSystem === 'high' ? 'rising' : 'stable';

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

  const baseIntensity = type === 'storm' ? 3 : type === 'rain' || type === 'snow' ? 2 : type === 'fog' ? 1.5 : 1;
  const intensity = Math.max(0, Math.min(5, Math.round(baseIntensity + random() * 2 - 0.5)));

  const isDay = time.currentHour >= 6 && time.currentHour < 18;
  const climateTemps: Record<WorldState['systems']['weatherConfig']['climate'], { day: number; night: number }> = {
    tropical: { day: 32, night: 24 }, desert: { day: 40, night: 18 }, temperate: { day: 20, night: 10 },
    cold: { day: 5, night: -5 }, arctic: { day: -10, night: -25 }, mediterranean: { day: 25, night: 15 },
    high_altitude: { day: 10, night: 0 },
  };
  const baseTemp = climateTemps[config.climate]?.[isDay ? 'day' : 'night'] ?? 15;
  const weatherOffset = type === 'storm' ? -6 : type === 'rain' ? -3 : type === 'snow' ? -12 : 0;
  const temperatureC = Math.round(baseTemp + weatherOffset);

  const windRanges: Record<WeatherType, [number, number]> = {
    clear: [2, 18], rain: [10, 30], storm: [25, 60], fog: [0, 12], snow: [5, 35],
  };
  const [wMin, wMax] = windRanges[type];
  const windKph = Math.round(wMin + random() * (wMax - wMin));

  const signals: string[] = [];
  if (type === 'storm' && intensity >= 3) signals.push('storm_risk:high');
  if (type === 'fog') signals.push('visibility:poor');
  if (temperatureC <= 0) signals.push('cold:harsh');
  if (type === 'snow') signals.push('travel:slow');
  if (windKph >= 40) signals.push('wind:high');

  return { type, intensity, temperatureC, windKph, pressure: { system: pressureSystem, hPa, trend }, signals };
}

export function weatherTravelMultiplier(weather: WeatherSnapshot): number {
  switch (weather.type) {
    case 'clear': return 1.0;
    case 'rain': return weather.intensity <= 2 ? 0.9 : 0.8;
    case 'storm': return weather.intensity <= 3 ? 0.75 : 0.6;
    case 'fog': return weather.intensity <= 2 ? 0.85 : 0.7;
    case 'snow': return weather.intensity <= 2 ? 0.7 : 0.5;
    default: return 1.0;
  }
}
