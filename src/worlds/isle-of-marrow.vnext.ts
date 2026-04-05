import type { WorldState, LocationPOI, Actor, Item, ItemLocationInput, KnowledgeState } from '../sim/state';
import { buildInitialSpine } from '../sim/spine';

export interface CreateWorldOptions {
  anchorIso?: string;
}

const locations: Record<string, LocationPOI> = {
  'the-landing': {
    id: 'the-landing',
    name: 'The Landing',
    description: 'A crescent of dark sand where the sea meets the southern curve of the ancient bones. Weathered docks extend from the shore, built atop what might be the creature\'s lower jaw. The skeleton arcs overhead to the north—massive ribs rising like cathedral vaults. Salt-crusted rope and driftwood mark where ships anchor. The air smells of brine and old stone.',
    anchor: { x: 0, y: 0, z: 0 },
    tideAccess: 'always',
    terrain: 'beach',
    radiusCells: 80,
  },
  'under-the-ribs': {
    id: 'under-the-ribs',
    name: 'Under the Ribs',
    description: 'A wind-cut corridor beneath the nearest rib arches where shadow stripes the sand and broken shell.',
    anchor: { x: 0, y: 180, z: 4 },
    tideAccess: 'always',
    terrain: 'path',
    radiusCells: 70,
  },
  'dock-approach': {
    id: 'dock-approach',
    name: 'Dock Approach',
    description: 'The foot of the weathered piers, where salt-stiff rope and driftwood collect against old timbers.',
    anchor: { x: 35, y: 45, z: 0 },
    tideAccess: 'always',
    terrain: 'beach',
    radiusCells: 40,
  },
  'jawline-walk': {
    id: 'jawline-walk',
    name: 'Jawline Walk',
    description: 'A narrow run of dark sand tracing the fossilized lower jaw just above the wash of the tide.',
    anchor: { x: -30, y: 95, z: 1 },
    tideAccess: 'always',
    terrain: 'beach',
    radiusCells: 50,
  },
  'the-rib-market': {
    id: 'the-rib-market',
    name: 'The Rib Market',
    description: 'A natural marketplace built within the leviathan\'s ribcage, half-open to the sky. Merchants have strung tarps between the massive curved bones, creating a lattice of shade and light.',
    anchor: { x: 0, y: 1200, z: 15 },
    tideAccess: 'always',
    terrain: 'path',
    radiusCells: 120,
  },
  'the-drunken-vertebra': {
    id: 'the-drunken-vertebra',
    name: 'The Drunken Vertebra',
    description: 'A tilted timber tavern built into one of the spine\'s great vertebrae, its walls braced against ancient bone.',
    anchor: { x: -150, y: 600, z: 8 },
    tideAccess: 'always',
    terrain: 'interior',
    radiusCells: 80,
  },
  'the-spine-ridge': {
    id: 'the-spine-ridge',
    name: 'The Spine Ridge',
    description: 'The highest point of the island—the leviathan\'s spine, wind-scoured and pale.',
    anchor: { x: 0, y: 6000, z: 120 },
    tideAccess: 'always',
    terrain: 'mountain',
    radiusCells: 150,
  },
  'the-heartspring': {
    id: 'the-heartspring',
    name: 'The Heartspring',
    description: 'A freshwater pool deep within the skeleton\'s interior, reached by descending through gaps between ribs.',
    anchor: { x: 80, y: 2500, z: -8 },
    tideAccess: 'always',
    terrain: 'cavern',
    radiusCells: 100,
  },
  'the-maw': {
    id: 'the-maw',
    name: 'The Maw',
    description: 'The great southern opening where the leviathan\'s throat once was—a natural cove flanked by massive jawbones.',
    anchor: { x: 0, y: -200, z: 0 },
    tideAccess: 'low',
    terrain: 'water',
    radiusCells: 120,
  },
};

const actors: Record<string, Actor> = {
  'player-1': {
    id: 'player-1',
    kind: 'player',
    name: 'You',
    pos: { x: 0, y: 0, z: 0 },
    inventory: [],
  },
  'mira-salt': {
    id: 'mira-salt',
    kind: 'npc',
    name: 'Mira Salt',
    pos: { x: 0, y: 6000, z: 120 },
    inventory: [],
    persona: {
      tagline: 'A weather-watcher who reads the sea.',
      background: 'Mira has spent years atop the spine ridge, watching pressure shifts and cloud bands.',
      voice: 'Measured, spare, observant.',
      goals: ['warn of storms', 'protect the ridge'],
    },
  },
  'ledger-pike': {
    id: 'ledger-pike',
    kind: 'npc',
    name: 'Jon "Ledger" Pike',
    pos: { x: 0, y: 1200, z: 15 },
    inventory: [],
    persona: {
      tagline: 'A quartermaster who knows every crate.',
      background: 'Ledger keeps the market running and remembers every debt.',
      voice: 'Blunt, pragmatic, transactional.',
      goals: ['keep trade flowing', 'protect stock'],
    },
  },
  'father-kel': {
    id: 'father-kel',
    kind: 'npc',
    name: 'Father Kel',
    pos: { x: 80, y: 2500, z: -8 },
    inventory: [],
    persona: {
      tagline: 'A heretic priest with quiet conviction.',
      background: 'Kel tends the heartspring and speaks in parables.',
      voice: 'Soft, deliberate, ritualistic.',
      goals: ['guard the spring', 'test the faithful'],
    },
  },
  'aline-rua': {
    id: 'aline-rua',
    kind: 'npc',
    name: 'Aline Rua',
    pos: { x: -150, y: 600, z: 8 },
    inventory: [],
    persona: {
      tagline: 'Heir to a lost captain.',
      background: 'Aline listens for rumors in the tavern.',
      voice: 'Wry, guarded, curious.',
      goals: ['learn the truth', 'avoid traps'],
    },
  },
  'tamar-vane': {
    id: 'tamar-vane',
    kind: 'npc',
    name: 'Tamar Vane',
    pos: { x: 28, y: 42, z: 0 },
    inventory: [],
    tags: ['dockhand', 'witness'],
    persona: {
      tagline: 'A dockhand who keeps first-light watch on the pilings.',
      background: 'Tamar has worked the Landing long enough to know which marks belong to tide, rope, and weather.',
      voice: 'Brisk, tide-wise, unsentimental.',
      goals: ['keep the morning unloading on schedule', 'notice what does not fit the tide-table'],
    },
  },
};

const items: Record<string, Item> = {
  'heartwater-jar': {
    id: 'heartwater-jar',
    name: 'Sealed jar of Heartwater',
    description: 'A small clay jar sealed with wax. The liquid inside glows faintly.',
  },
};

const itemPlacements: Record<string, ItemLocationInput> = {
  'heartwater-jar': { kind: 'ground', pos: { x: 0, y: 1200, z: 15 } },
};

export function createIsleOfMarrowWorldVNext(options: CreateWorldOptions = {}): WorldState {
  const startedDate = normalizeOpeningAnchor(options.anchorIso ?? new Date().toISOString());
  const startedAt = startedDate.toISOString();
  const knowledge: Record<string, KnowledgeState> = {
    'player-1': {
      seenLocations: { 'the-landing': true },
      seenActors: { 'player-1': true, 'tamar-vane': true },
      seenItems: {},
      notes: [],
    },
  };

  const world: WorldState = {
    meta: {
      worldId: 'isle-of-marrow',
      seed: 'isle-of-marrow-1825',
      version: 'vnext-0.2',
      turn: 0,
      openingSpec: {
        focalActorId: 'tamar-vane',
        focusLocationId: 'the-landing',
        hookText:
          'Tamar Vane has paused halfway through the dawn rope-check at the outer pilings, staring at a fresh black weed-line wrapped too high above the water for the morning tide.',
        playerQuestion: 'Why has Tamar Vane broken his routine at the docks, and what did the tide leave on those pilings before dawn?',
      },
    },
    map: {
      minX: -1000,
      minY: -1000,
      maxX: 2000,
      maxY: 7000,
      cellSizeMeters: 1,
    },
    actors,
    items,
    locations,
    spine: {
      entities: {},
      relations: {},
      indexes: {
        byType: {},
        byFrom: {},
        byTo: {},
        byRelationType: {},
      },
      schedules: {},
    },
    systems: {
      time: { elapsedMinutes: 0 },
      timeConfig: { anchorIso: startedAt, startHour: 6 },
      tideConfig: { cycleMinutes: 720 },
      weatherConfig: { climate: 'temperate', seed: 'isle-of-marrow', cadenceMinutes: 60 },
      economyConfig: {
        goods: { salt_fish: 'abundant', silver: 'abundant', heartwater: 'scarce' },
      },
    },
    agendas: {
      scene: {
        currentFocus: 'Dawn arrival at the Landing',
        pressures: [
          'Tamar Vane has stopped the dock routine over a tide-mark left too high on the pilings.',
          'The tide is high and cuts off the Maw.',
        ],
        unresolvedBeats: ['Find out what Tamar Vane has seen at the docks.'],
        immediateTensions: ['Your arrival is noticed before the morning work has settled into rhythm.'],
      },
      world: {
        activeThreads: ['The docks keep their own watch at first light.'],
        introductionOpportunities: ['Tamar Vane can explain why the tide-mark on the pilings has the dockhands unsettled.'],
        escalationHooks: ['If the tide has left something out of pattern, the island routine will bend around it before noon.'],
      },
    },
    ledger: [
      { turn: 0, text: 'Isle of Marrow initialized' },
      { turn: 0, text: 'You arrive at first light at the Landing, where dark sand meets ancient bone.' },
      { turn: 0, text: 'Tamar Vane halts the dawn rope-check, staring at a weed-line wrapped too high on the outer pilings.' },
      { turn: 0, text: 'The tide is high. The Maw is flooded and impassable.' },
    ],
    knowledge,
  };

  world.spine = buildInitialSpine(world, itemPlacements);
  return world;
}

function normalizeOpeningAnchor(anchorIso: string): Date {
  const normalized = new Date(anchorIso);
  normalized.setUTCHours(6, 0, 0, 0);
  return normalized;
}
