import type { SpineEntity } from './spine';

export type ItemComponents = Partial<SpineEntity['components']>;

const ARCHETYPE_PRESETS: Record<string, ItemComponents> = {
  'item.container.clay_jar': {
    physical: { volumeL: 0.5, portable: true },
    material: { primary: 'clay', flammable: false },
    container: { capacityL: 0.4 },
    condition: { durability: 60 },
    decay: { class: 'indoor_stable' },
  },
  'item.weapon.iron_longsword': {
    physical: { massKg: 1.4, lengthCm: 110, portable: true },
    material: { primary: 'iron', rustable: true, flammable: false },
    condition: { durability: 100 },
    decay: { class: 'outdoor_weathering' },
  },
  'item.clothing.leather_glove': {
    physical: { massKg: 0.15, portable: true },
    material: { primary: 'leather', flammable: true, rotProfile: 'slow_organic' },
    condition: { durability: 70 },
    decay: { class: 'organic_rot' },
  },
  'item.generic': {},
};

export function getArchetypePreset(archetype: string | undefined): ItemComponents {
  if (!archetype) return {};
  return ARCHETYPE_PRESETS[archetype] ?? {};
}

/**
 * Merge preset defaults with per-instance overrides. Per-component replacement:
 * if an override provides a component key, it wins entirely for that slot.
 * Placement-derived components (location) are handled separately by the caller.
 */
export function mergeItemComponents(
  preset: ItemComponents,
  overrides: ItemComponents | undefined,
): ItemComponents {
  if (!overrides) return { ...preset };
  const merged: ItemComponents = { ...preset };
  for (const key of Object.keys(overrides) as Array<keyof ItemComponents>) {
    if (overrides[key] !== undefined) {
      (merged as Record<string, unknown>)[key] = overrides[key];
    }
  }
  return merged;
}
