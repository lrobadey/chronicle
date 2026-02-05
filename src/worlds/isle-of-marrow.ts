/**
 * Chronicle v4 - Isle of Marrow World
 * 
 * Demo world set in 1825 on a leviathan skeleton island.
 * All world-specific content in one file.
 */

import type { World, Location, NPC } from '../core/world';

// ============================================================================
// LOCATIONS
// ============================================================================

const locations: Record<string, Location> = {
  'the-landing': {
    id: 'the-landing',
    name: 'The Landing',
    description: 'A crescent of dark sand where the sea meets the southern curve of the ancient bones. Weathered docks extend from the shore, built atop what might be the creature\'s lower jaw. The skeleton arcs overhead to the north—massive ribs rising like cathedral vaults. Salt-crusted rope and driftwood mark where ships anchor. The air smells of brine and old stone.',
    coords: { x: 0, y: 0, z: 0 },
    tideAccess: 'always',
    terrain: 'beach',
    travelSpeedMultiplier: 1.2,
  },
  'the-rib-market': {
    id: 'the-rib-market',
    name: 'The Rib Market',
    description: 'A natural marketplace built within the leviathan\'s ribcage, half-open to the sky. Merchants have strung tarps between the massive curved bones, creating a lattice of shade and light. Goods pile on stone tables—salt fish, coiled rope, tarnished silver, and clay jars of Heartwater. The bones themselves are scored with old marks, as if the market has stood here for generations.',
    items: [{ id: 'heartwater-jar', name: 'sealed jar of Heartwater' }],
    coords: { x: 0, y: 1200, z: 15 },
    tideAccess: 'always',
    terrain: 'path',
    travelSpeedMultiplier: 1.0,
  },
  'the-drunken-vertebra': {
    id: 'the-drunken-vertebra',
    name: 'The Drunken Vertebra',
    description: 'A tilted timber tavern built into one of the spine\'s great vertebrae, its walls braced against ancient bone. Lanterns sway from hooks driven into cartilage turned to stone. The air inside is thick with pipe smoke, rum fumes, and the low murmur of sailors\' tales. A single beam of late sun angles through a gap in the roof, illuminating motes of dust.',
    coords: { x: -150, y: 600, z: 8 },
    tideAccess: 'always',
    terrain: 'interior',
    travelSpeedMultiplier: 0.9,
  },
  'the-spine-ridge': {
    id: 'the-spine-ridge',
    name: 'The Spine Ridge',
    description: 'The highest point of the island—the leviathan\'s spine, wind-scoured and pale. From here you can see the entire crescent: the Landing to the south, the Market\'s ribs below, the dark opening of the Maw where the throat once was. A broken mast lashed to the bone serves as a signal post. The wind carries salt and distant thunder.',
    coords: { x: 0, y: 6000, z: 120 },
    tideAccess: 'always',
    terrain: 'mountain',
    travelSpeedMultiplier: 2.5,
  },
  'the-heartspring': {
    id: 'the-heartspring',
    name: 'The Heartspring',
    description: 'A freshwater pool deep within the skeleton\'s interior, reached by descending through gaps between ribs. The water is cold and perfectly clear, fed by an underground source. The stone around it is smooth, worn by hands and knees. Some claim the pool beats faintly during storms—a slow, resonant pulse felt in the chest.',
    coords: { x: 80, y: 2500, z: -8 },
    tideAccess: 'always',
    terrain: 'cavern',
    travelSpeedMultiplier: 1.4,
  },
  'the-maw': {
    id: 'the-maw',
    name: 'The Maw',
    description: 'The great southern opening where the leviathan\'s throat once was—a natural cove flanked by massive jawbones. At high tide, seawater floods this space, making it impassable. At low tide, the water recedes to reveal dark sand and the entrance to the Lung Caves beyond. The walls are encrusted with barnacles and pale coral. Sound behaves strangely here.',
    coords: { x: 0, y: -200, z: 0 },
    tideAccess: 'low',
    terrain: 'water',
    travelSpeedMultiplier: 3.0,
  },
};

// ============================================================================
// NPCs
// ============================================================================

const npcs: Record<string, NPC> = {
  'mira-salt': {
    id: 'mira-salt',
    name: 'Mira Salt',
    role: 'Weather-watcher',
    location: 'the-spine-ridge',
    systemFunction: 'weather-watcher',
  },
  'ledger-pike': {
    id: 'ledger-pike',
    name: 'Jon "Ledger" Pike',
    role: 'Quartermaster',
    location: 'the-rib-market',
    systemFunction: 'economy-tracker',
  },
  'father-kel': {
    id: 'father-kel',
    name: 'Father Kel',
    role: 'Heretic Priest',
    location: 'the-heartspring',
    systemFunction: 'ritual-keeper',
  },
  'aline-rua': {
    id: 'aline-rua',
    name: 'Aline Rua',
    role: "Lost Captain's Heir",
    location: 'the-drunken-vertebra',
    systemFunction: 'rumor-source',
  },
};

// ============================================================================
// WORLD FACTORY
// ============================================================================

export function createIsleOfMarrowWorld(): World {
  const startedAt = '1825-05-14T14:00:00Z';
  
  return {
    player: { 
      id: 'player-1', 
      pos: { x: 0, y: 0 }, 
      location: 'the-landing', 
      inventory: [] 
    },
    locations,
    npcs,
    systems: {
      time: {
        elapsedMinutes: 0,
        startHour: 14,
        anchor: {
          isoDateTime: startedAt,
          calendar: 'gregorian',
        },
      },
      tide: {
        phase: 'high',
        cycleMinutes: 720,
      },
      weather: {
        climate: 'temperate',
        seed: 'isle-of-marrow',
      },
      economy: {
        goods: {
          salt_fish: 'abundant',
          silver: 'abundant',
          heartwater: 'scarce',
        },
      },
    },
    ledger: [
      'Isle of Marrow initialized',
      'You arrive at the Landing, where dark sand meets ancient bone.',
      'The tide is high. The Maw is flooded and impassable.',
      'The market hums with quiet trade. Heartwater is scarce.',
    ],
    meta: {
      turn: 0,
      seed: 'isle-of-marrow-1825',
      startedAt,
    },
  };
}

