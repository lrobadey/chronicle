import type { WorldState } from '../state';
import { getItemPlacement } from '../spine';
import { deriveWeather, type WeatherType } from './weather';

type DecayClass = 'indoor_stable' | 'outdoor_weathering' | 'organic_rot';

interface DecayRates {
  wear: number;
  rust: number;
  rot: number;
}

const BASE_RATES_PER_HOUR: Record<DecayClass, DecayRates> = {
  outdoor_weathering: { wear: 0.10, rust: 0.15, rot: 0.05 },
  organic_rot: { wear: 0.05, rust: 0.00, rot: 0.30 },
  indoor_stable: { wear: 0.01, rust: 0.02, rot: 0.01 },
};

const WEATHER_MULTIPLIERS: Record<WeatherType, DecayRates> = {
  clear: { wear: 1.0, rust: 1.0, rot: 1.0 },
  rain: { wear: 1.0, rust: 2.0, rot: 1.5 },
  storm: { wear: 1.5, rust: 3.0, rot: 2.0 },
  fog: { wear: 1.0, rust: 1.5, rot: 1.2 },
  snow: { wear: 1.0, rust: 1.5, rot: 0.5 },
};

const TERRAIN_MULTIPLIERS: Record<string, Partial<DecayRates>> = {
  beach: { rust: 1.5, rot: 1.2 },
  water: { rust: 2.0, rot: 1.5 },
  forest: { rot: 1.5 },
  interior: { wear: 0.3, rust: 0.3, rot: 0.3 },
  cavern: { wear: 0.5, rust: 0.5, rot: 0.5 },
  mountain: { wear: 1.3 },
};

const SKIP_LIFECYCLE_STATES = new Set(['consumed', 'broken', 'ruined', 'unusable']);
const CARRIED_PLACEMENT_TYPES = new Set(['carried_by', 'worn_by']);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getTerrainMultiplier(terrain: string | undefined, channel: keyof DecayRates): number {
  if (!terrain) return 1.0;
  const multi = TERRAIN_MULTIPLIERS[terrain];
  if (!multi) return 1.0;
  return multi[channel] ?? 1.0;
}

export function runDecayCatchUp(state: WorldState, itemIds?: string[]): void {
  const currentElapsedMinutes = state.systems.time.elapsedMinutes;
  const weather = deriveWeather(state);
  const weatherMulti = WEATHER_MULTIPLIERS[weather.type] ?? WEATHER_MULTIPLIERS.clear;

  const ids = itemIds ?? Object.keys(state.items);

  for (const itemId of ids) {
    const entity = state.spine.entities[itemId];
    if (!entity || entity.kind !== 'item') continue;
    if (!entity.components.decay?.class) continue;

    const lifecycle = entity.components.lifecycle?.state;
    if (lifecycle && SKIP_LIFECYCLE_STATES.has(lifecycle)) continue;

    // Carried items don't decay
    const placement = getItemPlacement(state.spine, itemId);
    if (!placement) continue;
    if (CARRIED_PLACEMENT_TYPES.has(placement.type)) continue;

    // Clone decay component to avoid mutating shared archetype preset references
    entity.components.decay = { ...entity.components.decay };

    // First encounter: initialize timestamp to now and skip — newly created items
    // and items from old saves should not receive retroactive decay from time 0.
    if (entity.components.decay.lastSimulatedAtMinutes == null) {
      entity.components.decay.lastSimulatedAtMinutes = currentElapsedMinutes;
      const item = state.items[itemId];
      if (item) {
        item.components = item.components || {};
        item.components.decay = { ...entity.components.decay };
      }
      continue;
    }

    const deltaMinutes = currentElapsedMinutes - entity.components.decay.lastSimulatedAtMinutes;
    if (deltaMinutes <= 0) continue;

    const deltaHours = deltaMinutes / 60;
    const decayClass = entity.components.decay.class!;
    const baseRates = BASE_RATES_PER_HOUR[decayClass];

    const terrain = entity.components.location?.terrain;
    const material = entity.components.material;

    const wearDelta = baseRates.wear * deltaHours
      * weatherMulti.wear
      * getTerrainMultiplier(terrain, 'wear');

    const rustDelta = material?.rustable
      ? baseRates.rust * deltaHours
        * weatherMulti.rust
        * getTerrainMultiplier(terrain, 'rust')
      : 0;

    const rotDelta = material?.rotProfile
      ? baseRates.rot * deltaHours
        * weatherMulti.rot
        * getTerrainMultiplier(terrain, 'rot')
      : 0;

    // Clone condition to avoid mutating shared archetype preset references
    entity.components.condition = { ...(entity.components.condition || {}) };
    const condition = entity.components.condition;
    const startingDurability = condition.durability ?? 100;

    condition.wear = clamp((condition.wear ?? 0) + wearDelta, 0, 100);
    condition.rust = clamp((condition.rust ?? 0) + rustDelta, 0, 100);
    condition.rot = clamp((condition.rot ?? 0) + rotDelta, 0, 100);
    condition.durability = Math.max(0, startingDurability - (wearDelta + rustDelta + rotDelta));

    // If durability hits 0, mark as unusable
    if (condition.durability <= 0) {
      condition.durability = 0;
      entity.components.lifecycle = { state: 'unusable' };
      const item = state.items[itemId];
      if (item) {
        item.components = item.components || {};
        item.components.lifecycle = { state: 'unusable' };
      }
    }

    // Update timestamp
    entity.components.decay.lastSimulatedAtMinutes = currentElapsedMinutes;

    // Sync condition and decay timestamp back to state.items so that
    // normalizeLoadedState → syncWorldSpine preserves lastSimulatedAtMinutes
    // when rebuilding entities from items + presets.
    const item = state.items[itemId];
    if (item) {
      item.components = item.components || {};
      item.components.condition = { ...condition };
      item.components.decay = { ...entity.components.decay };
    }
  }
}
