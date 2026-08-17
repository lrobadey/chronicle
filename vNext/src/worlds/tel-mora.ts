import type { Actor, FactionEntity, Item, ItemLocationInput, KnowledgeState, LocationPOI, WorldState } from '../sim/state';
import { buildInitialSpine } from '../sim/spine';
import type { WorldModule, CreateWorldOptions } from './types';

export type { CreateWorldOptions } from './types';

const locations: Record<string, LocationPOI> = {
  'the-sluice': {
    id: 'the-sluice',
    name: 'The Sluice',
    description: 'The old canal junction gate, a mudbrick-and-copper lock wall that still stands intact on the highest ground in town. From its top, the whole settlement is visible: the Cut below, the Silted Lock ahead, and the Seep off to the side. It is workshop, headquarters, and a political claim in one structure.',
    anchor: { x: 0, y: 0, z: 12 },
    radiusCells: 40,
    terrain: 'interior',
    tags: ['structure', 'elevated', 'contested'],
  },
  'the-cut': {
    id: 'the-cut',
    name: 'The Cut',
    description: 'The main dry canal trench, repurposed as Tel Mora’s central street. Market stalls crowd the bottom of the canal, rope ladders hang from the walls, and reed-cloth curtains mark the Bedkeepers’ alcoves in the earth. Loud, dusty, and impossible to ignore.',
    anchor: { x: 0, y: 120, z: -4 },
    radiusCells: 80,
    terrain: 'road',
    tags: ['trench', 'market', 'bedkeeper-housing'],
  },
  'the-assessors-shade': {
    id: 'the-assessors-shade',
    name: "The Assessor's Shade",
    description: 'A requisitioned mudbrick house at the canal rim, slightly elevated, with the only intact roof in town. A faded awning extends over a packed-earth yard where people come to petition, complain, and lie. Someone is always waiting outside.',
    anchor: { x: 60, y: 80, z: 4 },
    radiusCells: 25,
    terrain: 'interior',
    tags: ['office', 'courtyard', 'petition-site'],
  },
  'the-seep': {
    id: 'the-seep',
    name: 'The Seep',
    description: 'A shallow, unreliable pool at the bottom of a secondary canal branch. The water is brackish but drinkable if filtered through reed-cloth. This is Tel Mora’s water supply and the source of the town’s quiet panic.',
    anchor: { x: -80, y: 200, z: -6 },
    radiusCells: 30,
    terrain: 'water',
    tags: ['pool', 'ration-point', 'filtered-water'],
  },
  'the-kiln-shelf': {
    id: 'the-kiln-shelf',
    name: 'The Kiln Shelf',
    description: 'A flat terrace of cracked clay above the Cut where the old city’s kilns once stood. Open air, no walls. Blankets hung on sticks for shade. People sleep here, cook here, dry goods here, and argue here.',
    anchor: { x: 40, y: 180, z: 2 },
    radiusCells: 50,
    terrain: 'path',
    tags: ['commons', 'sleeping-terrace', 'gossip-space'],
  },
  'the-silted-lock': {
    id: 'the-silted-lock',
    name: 'The Silted Lock',
    description: 'The junction’s second gate, choked with dried mud and debris. The Levelers believe clearing it could reach the shifted river. The Bedkeepers think it is the wall that keeps the Cut from flooding. This is the physical object the entire political argument is about.',
    anchor: { x: 0, y: 300, z: -2 },
    radiusCells: 35,
    terrain: 'road',
    tags: ['blocked-channel', 'political-object', 'chokepoint'],
  },
};

const actors: Record<string, Actor> = {
  'player-1': {
    id: 'player-1',
    kind: 'player',
    name: 'You',
    pos: { x: 60, y: 80, z: 4 },
    inventory: ['surveyors-rod', 'survey-kit'],
  },
  'deshur': {
    id: 'deshur',
    kind: 'npc',
    name: 'Deshur',
    pos: { x: 60, y: 80, z: 4 },
    inventory: [],
    tags: ['assessor', 'authority', 'outsider'],
    persona: {
      tagline: 'A careful assessor sent from Kashru.',
      background: 'Deshur has come to determine whether Tel Mora merits canal restoration funding or should be struck from the registry.',
      voice: 'Measured, careful, and exact.',
      goals: ['produce an honest assessment', 'avoid capture by any faction', 'leave before the water question becomes his problem'],
    },
  },
  'rana-tuq': {
    id: 'rana-tuq',
    kind: 'npc',
    name: 'Rana Tuq',
    pos: { x: 0, y: 0, z: 12 },
    inventory: [],
    tags: ['leveler', 'engineer', 'local'],
    persona: {
      tagline: 'Head Leveler and the only person who really understands the hydrology.',
      background: 'Rana grew up in Tel Mora, studied canal-craft upstream, and came back convinced she can bring water back if given labor and copper.',
      voice: 'Direct, technical, and impatient with politics.',
      goals: ['secure restoration funding', 'clear the Silted Lock', 'prove the new channel is viable'],
    },
  },
  'old-kesh': {
    id: 'old-kesh',
    kind: 'npc',
    name: 'Old Kesh',
    pos: { x: 0, y: 120, z: -4 },
    inventory: [],
    tags: ['bedkeeper', 'elder', 'local'],
    persona: {
      tagline: 'A Bedkeeper elder who remembers the upstream collapse.',
      background: 'Kesh lost his upstream home when the river shifted and rebuilt his family’s life in the dry canal.',
      voice: 'Slow, concrete, anchored in memory.',
      goals: ['protect the Cut homes', 'make restoration account for the people already living here', 'not be erased a second time'],
    },
  },
  'siduri': {
    id: 'siduri',
    kind: 'npc',
    name: 'Siduri',
    pos: { x: -80, y: 200, z: -6 },
    inventory: [],
    tags: ['water-keeper', 'neutral', 'informed'],
    persona: {
      tagline: 'Water-Keeper and ration manager.',
      background: 'Siduri manages filtration and rationing at the Seep. Technically neutral, practically indispensable.',
      voice: 'Practical, warm, and boundaried.',
      goals: ['keep the water supply functional', 'maintain neutrality', 'avoid being leveraged'],
    },
  },
  'lugal-ane': {
    id: 'lugal-ane',
    kind: 'npc',
    name: 'Lugal-Ane',
    pos: { x: 0, y: 120, z: -4 },
    inventory: [],
    tags: ['merchant', 'outsider-connected', 'opportunist'],
    persona: {
      tagline: 'A copper merchant with the town’s only outside trade network.',
      background: 'Lugal-Ane brings in copper, reed, and salt from downriver and sells at steep margins.',
      voice: 'Friendly, transactional, and never quite direct.',
      goals: ['maximize his position', 'secure trade rights', 'stay on the winning side'],
    },
  },
  'nesh': {
    id: 'nesh',
    kind: 'npc',
    name: 'Nesh',
    pos: { x: 0, y: 0, z: 12 },
    inventory: [],
    tags: ['apprentice', 'divided-loyalty', 'young'],
    persona: {
      tagline: 'An apprentice engineer caught between family and work.',
      background: 'Nesh studies canal engineering under Rana, but their family lives in the Cut with Old Kesh.',
      voice: 'Quiet, observant, and cautious with personal answers.',
      goals: ['learn canal-craft', 'avoid choosing sides', 'find a solution that does not require betrayal'],
    },
  },
};

const factions: Record<string, FactionEntity> = {
  levelers: {
    id: 'levelers',
    name: 'The Levelers',
    description:
      'The engineers, labor organizers, and restoration advocates pushing to clear the Silted Lock and bring canal water back through Tel Mora.',
    tags: ['engineering', 'restoration', 'infrastructure'],
    memberIds: ['rana-tuq', 'nesh'],
  },
  bedkeepers: {
    id: 'bedkeepers',
    name: 'The Bedkeepers',
    description:
      'The families and elders who have built their homes in the dry canal bed and insist that any restoration plan account for the people already living there.',
    tags: ['housing', 'locals', 'mutual-aid'],
    memberIds: ['old-kesh'],
  },
  seepkeepers: {
    id: 'seepkeepers',
    name: 'The Seepkeepers',
    description:
      'The small rationing and filtration network centered on the Seep, responsible for keeping Tel Mora’s remaining drinkable water usable.',
    tags: ['water', 'rationing', 'neutral'],
    memberIds: ['siduri'],
  },
  'kashru-registry': {
    id: 'kashru-registry',
    name: 'The Kashru Registry',
    description:
      'The upstream administrative apparatus that decides which settlements remain on the books and which projects receive formal restoration backing.',
    tags: ['bureaucracy', 'assessment', 'outside-power'],
    memberIds: ['deshur'],
  },
  'downriver-trade': {
    id: 'downriver-trade',
    name: 'The Downriver Trade',
    description:
      'A loose commercial network of caravan and river merchants who control scarce imported copper and profit from uncertainty at settlements like Tel Mora.',
    tags: ['trade', 'copper', 'leverage'],
    memberIds: ['lugal-ane'],
  },
};

const items: Record<string, Item> = {
  'surveyors-rod': {
    id: 'surveyors-rod',
    name: 'Surveyor’s Rod',
    description: 'A straight reed-and-copper measuring rod marked for canal work and demonstration digs.',
    archetype: 'item.tool.survey_rod',
  },
  'survey-kit': {
    id: 'survey-kit',
    name: 'Survey Kit',
    description: 'A small practical kit with reed-cloth filters, wax tablets, chalk, and a wrapped length of cord for measuring and marking work.',
    archetype: 'item.tool.survey_kit',
  },
};

const itemPlacements: Record<string, ItemLocationInput> = {
  'surveyors-rod': { kind: 'inventory', actorId: 'player-1' },
  'survey-kit': { kind: 'inventory', actorId: 'player-1' },
};

export function createTelMoraWorld(options: CreateWorldOptions = {}): WorldState {
  const startedDate = normalizeOpeningAnchor(options.anchorIso ?? new Date().toISOString());
  const startedAt = startedDate.toISOString();
  const knowledge: Record<string, KnowledgeState> = {
    'player-1': {
      seenLocations: {
        'the-assessors-shade': true,
      },
      seenActors: {
        'player-1': true,
        'deshur': true,
      },
      seenItems: {
        'surveyors-rod': true,
        'survey-kit': true,
      },
      notes: [],
      rumors: [],
    },
  };

  const world: WorldState = {
    meta: {
      worldId: 'tel-mora',
      seed: 'tel-mora-dead-junction',
      version: 'vnext-0.2',
      turn: 0,
      openingSpec: {
        focalActorId: 'deshur',
        focusLocationId: 'the-assessors-shade',
        hookText: 'Deshur is scheduled to issue a preliminary recommendation tomorrow. Rana Tuq has asked you to carry a surveyor’s rod to the Silted Lock for a demonstration dig. Old Kesh has asked you to walk the Cut and see who lives there before anything gets decided. Both requests are reasonable. Both are political.',
        playerQuestion: 'What will the Assessor recommend, and can you shape it before he decides?',
      },
    },
    map: {
      minX: -200,
      minY: -100,
      maxX: 200,
      maxY: 360,
      cellSizeMeters: 1,
    },
    actors,
    items,
    locations,
    factions,
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
      weatherConfig: { climate: 'desert', seed: 'tel-mora', cadenceMinutes: 60 },
      scheduledProcesses: [],
      economyConfig: {
        goods: {
          copper: 'scarce',
          reed_cloth: 'abundant',
          dried_fish: 'abundant',
          clean_water: 'scarce',
          clay_mudbrick: 'abundant',
        },
      },
    },
    directorState: {
      scene: {
        currentFocus: 'The day before the Assessor’s preliminary recommendation',
        pressures: [
          'Rana needs a visible demonstration at the Silted Lock.',
          'Kesh needs the Assessor to see the Cut as a living place, not an obstruction.',
          'Lugal-Ane is hedging until the report is clearer.',
        ],
        unresolvedBeats: [
          'What will the player carry to the Silted Lock?',
          'Will the player walk the Cut first?',
        ],
        immediateTensions: [
          'Both Rana and Kesh have made requests of the player.',
          'Deshur is watching who the player talks to first.',
        ],
      },
      world: {
        activeThreads: [
          'The Assessor’s report.',
          'The Seep’s declining water level.',
          'Lugal-Ane’s copper supply and what he wants in return.',
        ],
        introductionOpportunities: [
          'Deshur can be approached at his shade.',
          'Siduri can explain the water situation.',
          'Nesh is at the Sluice, quietly working.',
        ],
        escalationHooks: [
          'If the Seep drops further, rationing disputes will force Siduri to pick sides.',
          'If Rana’s demonstration fails, Lugal-Ane may withdraw copper supply.',
        ],
      },
      activeThreads: [],
      heldBeats: [],
      pendingWorldEvents: [],
      playerBehaviorPatterns: {},
      capabilityCandidates: [],
      factionPressures: [],
      reputationDriftLastMinutes: 0,
    },
    stewardMemory: {
      currentGoals: ['Keep the Assessor crisis legible and immediate to the player.'],
      workingHypotheses: ['The water shortage and the report deadline will pull local factions into conflict.'],
      intendedBeats: ['Force an early choice about who the player helps first in the Cut.'],
      deferredQuestions: ['What proof will sway the Assessor before the recommendation lands?'],
      continuityNotes: ['Requests from Rana and Kesh are both live from turn zero.'],
      lastUpdatedTurn: 0,
    },
    ledger: [
      { turn: 0, text: 'Tel Mora initialized' },
      { turn: 0, text: 'Deshur arrived from Kashru to determine whether the junction should be restored or struck from the registry.' },
      { turn: 0, text: 'The Seep is running low and rationing is already felt in the Cut.' },
      { turn: 0, text: 'Rana Tuq wants a demonstration dig at the Silted Lock before the recommendation is issued.' },
    ],
    knowledge,
  };

  world.spine = buildInitialSpine(world, itemPlacements);
  return world;
}

export const createTelMoraWorldVNext = createTelMoraWorld;

export const telMoraWorldModule: WorldModule = {
  id: 'tel-mora',
  displayName: 'Tel Mora — The Dead Junction',
  createWorld: createTelMoraWorld,
  cliTheme: {
    eyebrow: 'Chronicle vNext',
    banner: 'The junction is quiet, but no one trusts it.',
    intro: 'A recommendation is coming, and everyone is listening for it.',
  },
  metadata: {
    summary: 'A dead canal junction where restoration, housing, and water scarcity collide.',
    settlement: 'Tel Mora',
    tone: 'political, compact, resource-pressured',
    economy: {
      copper: 'scarce',
      reedCloth: 'common',
      driedFish: 'adequate',
      cleanWater: 'rationed',
      clayMudbrick: 'abundant',
    },
  },
};

function normalizeOpeningAnchor(anchorIso: string): Date {
  const normalized = new Date(anchorIso);
  normalized.setUTCHours(6, 0, 0, 0);
  return normalized;
}
