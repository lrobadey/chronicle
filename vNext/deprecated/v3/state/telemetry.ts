import type { SimpleWorld } from './world';
import { ensureSeededFromWorld } from './graphContext';
import { P } from './graph';
import { getTimeState, deriveAbsoluteTime, ensureTimeAnchor } from './time';
import type { RichTimeTelemetry } from './time';
import { ensureWeatherSnapshot } from './weather';
import { ChronicleWeatherEngine } from './weather/engine';
import { deriveLocalWeather } from './weather/localEffects';
import { getLocationWeatherMetadata } from './weather/metadata';

export interface TurnTelemetry {
  turn: number;
  seed?: string;
  player: {
    id: string;
    locationId: string;
    locationName: string;
    position: { x: number; y: number; z?: number };
    inventory: { id: string; name: string }[];
  };
  location: {
    id: string;
    name: string;
    description: string;
    items: { id: string; name: string }[];
  };
  nearbyLocations: Array<{
    id: string;
    name: string;
    distance: number;
    bearing?: string; // 'north', 'south', etc.
  }>;
  systems?: {
    time?: RichTimeTelemetry; // Extended with calendar data when available
    tide?: {
      phase: 'low' | 'rising' | 'high' | 'falling';
      accessible: string[]; // location IDs accessible at this tide
      blocked: string[]; // location IDs blocked by tide
    };
    weather?: {
      // Global weather state
      type: string;
      intensity: number;
      temperatureC: number;
      windKph: number;
      pressure: {
        system: string;
        hPa: number;
        trend: string;
      };
      signals?: string[];
      // Local effects (derived from location metadata)
      local?: {
        visibility: 'normal' | 'low' | 'very_low';
        footing: 'normal' | 'slippery' | 'dangerous';
        comfort: 'cozy' | 'exposed' | 'miserable';
        travelMultiplier: number;
        localSignals: string[];
      };
    };
  };
  ledgerTail: string[]; // Last 5 entries
  schemaVersion: string;
}

function computeBearing(dx: number, dy: number): string | undefined {
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return undefined;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle >= -45 && angle < 45) return 'east';
  if (angle >= 45 && angle < 135) return 'north';
  if (angle >= 135 || angle < -135) return 'west';
  return 'south';
}

function getTimeOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function distanceBetween(a: { x: number; y: number; z?: number }, b: { x: number; y: number; z?: number }): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

export function buildTurnTelemetry(world: SimpleWorld): TurnTelemetry {
  const store = ensureSeededFromWorld(world);
  const playerId = world.player.id;
  const located = store.getLocatedIn(playerId);
  const locId = located?.obj || world.player.location;
  const locEntity = store.getEntity(locId);
  const loc = world.locations[locId];
  
  const playerPos = world.player.pos || loc?.coords || { x: 0, y: 0 };
  
  // Items in current location via contains relations
  const contains = store.getRelationsBySubject(locId).filter((r) => r.pred === P.contains);
  const items = contains
    .map((r) => store.getEntity(r.obj))
    .filter(Boolean)
    .map((e) => ({ id: e!.id, name: String(e!.props?.name || e!.id) }));

  // Find nearby locations (within 200m)
  const nearbyLocations: Array<{ id: string; name: string; distance: number; bearing?: string }> = [];
  const entities = Object.values(store.graph.entities);
  for (const entity of entities) {
    if (entity.type !== 'location' || entity.id === locId) continue;
    const entityPos = store.getPosition(entity.id) || (entity.props?.pos as any) || (entity.props?.coords as any);
    if (!entityPos) continue;
    const dist = distanceBetween(playerPos, entityPos);
    if (dist < 200 && dist > 0.1) {
      const dx = entityPos.x - playerPos.x;
      const dy = entityPos.y - playerPos.y;
      nearbyLocations.push({
        id: entity.id,
        name: String(entity.props?.name || entity.id),
        distance: dist,
        bearing: computeBearing(dx, dy),
      });
    }
  }
  nearbyLocations.sort((a, b) => a.distance - b.distance);

  // Time system - use enhanced derivation if available
  let timeData: TurnTelemetry['systems'] extends { time?: infer T } ? T : never | undefined;
  if (world.systems?.time) {
    const timeState = getTimeState(world);
    if (timeState) {
      // Ensure anchor exists (for backward compatibility)
      const timeStateWithAnchor = ensureTimeAnchor(timeState, world.meta);
      
      // Derive rich time data
      const richTime = deriveAbsoluteTime(timeStateWithAnchor, world.meta?.turn);
      timeData = richTime;
    } else {
      // Fallback to basic calculation (shouldn't happen, but just in case)
      const elapsed = world.systems.time.elapsedMinutes;
      const startHour = world.systems.time.startHour || 0;
      const currentHour = (startHour + Math.floor(elapsed / 60)) % 24;
      const currentDay = Math.floor(elapsed / (24 * 60));
      timeData = {
        elapsedMinutes: elapsed,
        currentHour,
        currentDay,
        timeOfDay: getTimeOfDay(currentHour),
        cycle: {
          minute: elapsed % 60,
          hour: currentHour,
          day: currentDay,
          week: Math.floor((currentDay - 1) / 7) + 1,
        },
      };
    }
  }

  // Tide system
  let tideData: TurnTelemetry['systems'] extends { tide?: infer T } ? T : never | undefined;
  if (world.systems?.tide) {
    const accessible: string[] = [];
    const blocked: string[] = [];
    const phase = world.systems.tide.phase;
    
    for (const [id, location] of Object.entries(world.locations)) {
      if (location.tideAccess === 'low' && (phase === 'high' || phase === 'rising')) {
        blocked.push(id);
      } else if (location.tideAccess === 'low' && (phase === 'low' || phase === 'falling')) {
        accessible.push(id);
      } else if (location.tideAccess === 'always') {
        accessible.push(id);
      }
    }
    
    tideData = {
      phase,
      accessible,
      blocked,
    };
  }

  // Get weather snapshot (backward compatible)
  const weatherSnapshot = ensureWeatherSnapshot(world);

  // Get ChronicleWeatherSnapshot for local effects
  let weatherData: TurnTelemetry['systems']['weather'] | undefined;
  if (weatherSnapshot && world.systems?.weather) {
      // Get full ChronicleWeatherSnapshot using the engine
      const timeState = getTimeState(world);
      if (timeState) {
        const anchored = ensureTimeAnchor(timeState, world.meta);
        const rich = deriveAbsoluteTime(anchored, world.meta?.turn);
      const timeIso = rich.absolute?.isoDateTime || world.meta?.startedAt;

      if (timeIso) {
        const engine = new ChronicleWeatherEngine();
        const seed = world.systems.weather.seed ?? world.meta?.seed ?? 'chronicle';
        const climate = world.systems.weather.climate ?? 'temperate';
        const chronicleSnapshot = engine.computeSnapshot(timeIso, seed, climate);

        // Get location metadata and derive local effects
        const locationMetadata = loc?.weatherMetadata || getLocationWeatherMetadata(locId);
        const localEffects = locationMetadata
          ? deriveLocalWeather(chronicleSnapshot, locationMetadata)
          : undefined;

        weatherData = {
          type: weatherSnapshot.type,
          intensity: weatherSnapshot.intensity,
          temperatureC: weatherSnapshot.temperatureC,
          windKph: weatherSnapshot.windKph,
          pressure: weatherSnapshot.pressure,
          signals: weatherSnapshot.signals,
          ...(localEffects
            ? {
                local: {
                  visibility: localEffects.visibility,
                  footing: localEffects.footing,
                  comfort: localEffects.comfort,
                  travelMultiplier: localEffects.travelMultiplier,
                  localSignals: localEffects.localSignals,
                },
              }
            : {}),
        };
      }
    }

    // Fallback to basic weather if we couldn't get Chronicle snapshot
    if (!weatherData) {
      weatherData = {
        type: weatherSnapshot.type,
        intensity: weatherSnapshot.intensity,
        temperatureC: weatherSnapshot.temperatureC,
        windKph: weatherSnapshot.windKph,
        pressure: weatherSnapshot.pressure,
        signals: weatherSnapshot.signals,
      };
    }
  }

  return {
    turn: world.meta?.turn || 0,
    seed: world.meta?.seed,
    player: {
      id: playerId,
      locationId: locId,
      locationName: loc?.name || String(locEntity?.props?.name || locId),
      position: playerPos,
      inventory: world.player.inventory,
    },
    location: {
      id: locId,
      name: loc?.name || String(locEntity?.props?.name || locId),
      description: loc?.description || String(locEntity?.props?.description || ''),
      items,
    },
    nearbyLocations: nearbyLocations.slice(0, 5), // Top 5 nearest
    systems: {
      ...(timeData ? { time: timeData } : {}),
      ...(tideData ? { tide: tideData } : {}),
      ...(weatherData ? { weather: weatherData } : {}),
    },
    ledgerTail: world.ledger.slice(-5),
    schemaVersion: 'v3.1',
  };
}
