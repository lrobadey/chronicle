import type { ClimateZone, WeatherSnapshot } from './weather';
import type { LocationWeatherMetadata } from './weather/types';
import { ISLE_OF_MARROW_WEATHER_METADATA } from './weather/metadata';

export type SimpleWorldPosition = { x: number; y: number; z?: number };

export interface SimpleWorldLocation {
  id: string;
  name: string;
  description: string;
  items?: { id: string; name: string }[];
  /** Landmark anchor used for spatial reasoning. Optional but recommended. */
  coords?: SimpleWorldPosition;
  /** Tide-dependent accessibility */
  tideAccess?: 'always' | 'low' | 'high';
  /** Terrain affects travel speed modifiers */
  terrain?: 'road' | 'path' | 'beach' | 'forest' | 'mountain' | 'water' | 'interior' | 'cavern' | 'unknown';
  /** Optional explicit multiplier applied to travel time (1.0 = baseline walking speed) */
  travelSpeedMultiplier?: number;
  /** Weather metadata - describes how weather affects this location */
  weatherMetadata?: LocationWeatherMetadata;
}

export interface SimpleWorldNPC {
  id: string;
  name: string;
  role: string;
  location: string;
  systemFunction?: string; // e.g., 'weather-watcher', 'economy-tracker'
}

export interface SimpleWorldPlayer {
  id: string;
  /** Canonical spatial position (meters). */
  pos: SimpleWorldPosition;
  /** Legacy location reference; derived from pos when possible. */
  location: string;
  inventory: { id: string; name: string }[];
}

export interface SimpleWorld {
  player: SimpleWorldPlayer;
  locations: Record<string, SimpleWorldLocation>;
  ledger: string[];
  npcs?: Record<string, SimpleWorldNPC>;
  systems?: {
    time?: {
      elapsedMinutes: number;
      startHour?: number; // What hour did the game start? (e.g., 8 = 8 AM)
      // Extended time system (optional, backward compatible)
      anchor?: {
        isoDateTime: string; // ISO 8601 timestamp for game start (e.g., "1825-05-14T14:00:00Z")
        calendar?: 'gregorian' | 'custom';
      };
      patches?: Array<{
        turn: number;
        reason: string;
        deltaMinutes?: number;
        setAbsolute?: string; // ISO timestamp override
      }>;
      cache?: {
        lastComputedTurn: number;
        currentIso?: string;
      };
    };
    tide?: {
      phase: 'low' | 'rising' | 'high' | 'falling';
      cycleMinutes: number; // Full tide cycle duration (e.g., 720 = 12 hours)
    };
    economy?: {
      goods: Record<string, 'abundant' | 'scarce'>;
    };
    weather?: {
      climate: ClimateZone;
      seed?: string;
      cache?: {
        lastTurn: number;
        snapshot: WeatherSnapshot;
      };
    };
  };
  // NEW: Turn tracking for determinism and provenance
  meta?: {
    turn: number;
    seed?: string;
    startedAt?: string; // ISO timestamp
  };
}

export function createSimpleWorld(): SimpleWorld {
  const startedAt = new Date().toISOString();
  return {
    player: { id: 'player-1', pos: { x: 0, y: 0 }, location: 'glade', inventory: [] },
    locations: {
      glade: {
        id: 'glade',
        name: 'Silent Glade',
        description: 'A quiet clearing with soft moss and a faint, resin-scented breeze. A narrow path leads toward a warm glow.',
        items: [],
        coords: { x: 0, y: 0 },
        terrain: 'path',
        travelSpeedMultiplier: 1.0,
      },
      tavern: {
        id: 'tavern',
        name: 'Weary Dragon Inn',
        description: 'A cozy inn alive with low chatter and lamplight. The innkeeper polishes a mug behind the counter.',
        items: [{ id: 'key', name: 'rusty key' }],
        coords: { x: 0, y: 50 },
        terrain: 'interior',
        travelSpeedMultiplier: 0.9,
      },
    },
    systems: {
      time: {
        elapsedMinutes: 0,
        startHour: 8,
        anchor: {
          isoDateTime: startedAt,
          calendar: 'gregorian',
        },
      },
      tide: {
        phase: 'low',
        cycleMinutes: 720,
      },
      weather: {
        climate: 'temperate',
        seed: 'silent-glade',
      },
    },
    ledger: ['tick: 0 - v3 world initialized'],
    meta: {
      turn: 0,
      seed: undefined,
      startedAt,
    },
  };
}

export function createIsleOfMarrowWorld(): SimpleWorld {
  return {
    player: { id: 'player-1', pos: { x: 0, y: 0 }, location: 'the-landing', inventory: [] },
    locations: {
      'the-landing': {
        id: 'the-landing',
        name: 'The Landing',
        description: 'A crescent of dark sand where the sea meets the southern curve of the ancient bones. Weathered docks extend from the shore, built atop what might be the creature\'s lower jaw. The skeleton arcs overhead to the north—massive ribs rising like cathedral vaults. Salt-crusted rope and driftwood mark where ships anchor. The air smells of brine and old stone.',
        items: [],
        coords: { x: 0, y: 0, z: 0 },
        tideAccess: 'always',
        terrain: 'beach',
        travelSpeedMultiplier: 1.2,
        weatherMetadata: ISLE_OF_MARROW_WEATHER_METADATA['the-landing'],
      },
      'the-rib-market': {
        id: 'the-rib-market',
        name: 'The Rib Market',
        description: 'A natural marketplace built within the leviathan\'s ribcage, half-open to the sky. Merchants have strung tarps between the massive curved bones, creating a lattice of shade and light. Goods pile on stone tables—salt fish, coiled rope, tarnished silver, and clay jars of Heartwater. The bones themselves are scored with old marks, as if the market has stood here for generations. Voices echo strangely in this space.',
        items: [{ id: 'heartwater-jar', name: 'sealed jar of Heartwater' }],
        coords: { x: 0, y: 1200, z: 15 }, // ~1.2km north, elevated within ribs
        tideAccess: 'always',
        terrain: 'path',
        travelSpeedMultiplier: 1.0,
        weatherMetadata: ISLE_OF_MARROW_WEATHER_METADATA['the-rib-market'],
      },
      'the-drunken-vertebra': {
        id: 'the-drunken-vertebra',
        name: 'The Drunken Vertebra',
        description: 'A tilted timber tavern built into one of the spine\'s great vertebrae, its walls braced against ancient bone. Lanterns sway from hooks driven into cartilage turned to stone. The air inside is thick with pipe smoke, rum fumes, and the low murmur of sailors\' tales. A single beam of late sun angles through a gap in the roof, illuminating motes of dust. The floorboards creak as if breathing.',
        items: [],
        coords: { x: -150, y: 600, z: 8 }, // ~0.6km NNW, embedded in spine
        tideAccess: 'always',
        terrain: 'interior',
        travelSpeedMultiplier: 0.9,
        weatherMetadata: ISLE_OF_MARROW_WEATHER_METADATA['the-drunken-vertebra'],
      },
      'the-spine-ridge': {
        id: 'the-spine-ridge',
        name: 'The Spine Ridge',
        description: 'The highest point of the island—the leviathan\'s spine, wind-scoured and pale. From here you can see the entire crescent: the Landing to the south, the Market\'s ribs below, the dark opening of the Maw where the throat once was. A broken mast lashed to the bone serves as a signal post. The wind carries salt and distant thunder. Smugglers use this place to watch for ships.',
        items: [],
        coords: { x: 0, y: 6000, z: 120 }, // ~6km north, high elevation
        tideAccess: 'always',
        terrain: 'mountain',
        travelSpeedMultiplier: 2.5,
        weatherMetadata: ISLE_OF_MARROW_WEATHER_METADATA['the-spine-ridge'],
      },
      'the-heartspring': {
        id: 'the-heartspring',
        name: 'The Heartspring',
        description: 'A freshwater pool deep within the skeleton\'s interior, reached by descending through gaps between ribs. The water is cold and perfectly clear, fed by an underground source. The stone around it is smooth, worn by hands and knees. Some claim the pool beats faintly during storms—a slow, resonant pulse felt in the chest. Father Kel conducts rituals here. The air is cool and still, a pocket of quiet beneath the bone.',
        items: [],
        coords: { x: 80, y: 2500, z: -8 }, // ~2.5km NNE, below ground level
        tideAccess: 'always',
        terrain: 'cavern',
        travelSpeedMultiplier: 1.4,
        weatherMetadata: ISLE_OF_MARROW_WEATHER_METADATA['the-heartspring'],
      },
      'the-maw': {
        id: 'the-maw',
        name: 'The Maw',
        description: 'The great southern opening where the leviathan\'s throat once was—a natural cove flanked by massive jawbones. At high tide, seawater floods this space, making it impassable. At low tide, the water recedes to reveal dark sand and the entrance to the Lung Caves beyond. The walls are encrusted with barnacles and pale coral. Sound behaves strangely here: whispers carry, but shouts seem swallowed. The tide determines what can be reached.',
        items: [],
        coords: { x: 0, y: -200, z: 0 }, // ~200m south, at sea level
        tideAccess: 'low', // only accessible at low tide
        terrain: 'water',
        travelSpeedMultiplier: 3.0,
        weatherMetadata: ISLE_OF_MARROW_WEATHER_METADATA['the-maw'],
      },
    },
    npcs: {
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
    },
    systems: {
      time: {
        elapsedMinutes: 0,
        startHour: 14, // 2 PM arrival
        anchor: {
          isoDateTime: '1825-05-14T14:00:00Z', // May 14, 1825, 2:00 PM - realistic historical date
          calendar: 'gregorian',
        },
      },
      tide: {
        phase: 'high',
        cycleMinutes: 720, // 12-hour full cycle (6 hours per high/low)
      },
      economy: {
        goods: {
          salt_fish: 'abundant',
          silver: 'abundant',
          heartwater: 'scarce',
        },
      },
      weather: {
        climate: 'temperate',
        seed: 'isle-of-marrow',
      },
    },
    ledger: [
      'tick: 0 - Isle of Marrow initialized',
      'You arrive at the Landing, where dark sand meets ancient bone.',
      'The tide is high. The Maw is flooded and impassable.',
      'The market hums with quiet trade. Heartwater is scarce.',
    ],
    meta: {
      turn: 0,
      seed: undefined,
      startedAt: '1825-05-14T14:00:00Z', // Match the time anchor
    },
  };
}


