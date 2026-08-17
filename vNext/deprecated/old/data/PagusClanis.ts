// PagusClanis.ts - Predefined GTWG dataset for Pagus Clanis (Etruria, early 30s AD)
// =================================================================================
// Immutable, self-contained dataset adhering to V2 GTWG architecture.

import type {
  GTWG,
  GTWGEntity,
  GTWGRelation,
  GTWGRelationType,
} from '../types/GTWGTypes.js';
import {
  createGTWG,
  queryGTWG,
  getEntity,
  getEntitiesByType,
  findConnectedEntities,
  findIncomingEntities,
  getRelations,
  getDirectContainedEntities,
} from './GTWG.js';

// ---------------------------------------------------------------------------------
// Entities (nodes)
// ---------------------------------------------------------------------------------

const entities: GTWGEntity[] = [
  {
    id: 'pagus-clanis',
    type: 'region',
    name: 'Pagus Clanis',
    properties: {
      description:
        'Rural district in the valley of the river Clanis, straddling the Via Cassia between Arretium and Clusium. Rolling vine- and olive-covered hills, small oak woods, clay pits along the river. Partial centuriation visible.',
      regionType: 'pagus',
      commonType: 'district',
      climate: 'temperate',
      biome: 'rolling_hills',
      population: 150,
      importance: 7,
      wealth: 65,
      accessibility: 'open',
      dangerLevel: 'safe',
      tags: ['via_cassia', 'etruria', 'rural'],
    },
  },
  {
    id: 'villa-aelia',
    type: 'region',
    name: 'Villa Aelia',
    properties: {
      description:
        'Working estate on a south-facing slope, 2 Roman miles off the Cassia. Farmhouse (pars urbana), farm buildings (pars rustica) with torcularium, dolia sunk in the floor, slave barracks, small lararium.',
      regionType: 'villa_rustica',
      commonType: 'estate',
      features: ['farmhouse', 'torcularium', 'dolia', 'slave_barracks', 'lararium'],
      output: ['olive_oil', 'wine', 'wool'],
      population: 25,
      wealth: 80,
      accessibility: 'open',
      dangerLevel: 'safe',
      tags: ['estate', 'press_season'],
      // Grid coordinates (15m per unit)
      coords: { x: 60, y: 300 },
    },
  },
  {
    id: 'ad-pontem-clanis',
    type: 'region',
    name: 'Ad Pontem Clanis',
    properties: {
      description:
        'River crossing with a timber bridge and a small vicus clustered at its northern abutment. Carpenter’s yard, ferryman’s hut for high water, modest taberna, shrine to Diana for travelers.',
      regionType: 'river_crossing',
      commonType: 'bridge',
      features: ['timber_bridge', 'carpenter_yard', 'ferryman_hut', 'taberna', 'diana_shrine'],
      population: 15,
      wealth: 45,
      accessibility: 'open',
      dangerLevel: 'safe',
      tags: ['river', 'crossing'],
      // Near the river and Via Cassia
      coords: { x: 130, y: 120 },
    },
  },
  {
    id: 'mansio-vallis',
    type: 'region',
    name: 'Mansio Vallis',
    properties: {
      description:
        'Licensed mansio and mutatio serving couriers and respectable travelers. Stable block with spare mules, courtyard well, simple bedrooms, kitchen garden, milestone marker.',
      regionType: 'posting_station',
      commonType: 'inn',
      features: ['stable_block', 'courtyard_well', 'bedrooms', 'kitchen_garden', 'milestone'],
      population: 8,
      wealth: 70,
      accessibility: 'open',
      dangerLevel: 'safe',
      tags: ['cursus_publicus', 'via_cassia'],
      // Grid coordinates (15m per unit) – along the Via Cassia east of the bridge
      coords: { x: 185, y: 118 },
    },
  },
  {
    id: 'lucus-silvani',
    type: 'region',
    name: 'Lucus Silvani',
    properties: {
      description:
        'Oak grove on a hill crest marking the edge of two estates. Weathered altar stone to Silvanus, boundary stones with owners’ names, fines for woodcutting.',
      regionType: 'sacred_grove',
      commonType: 'forest',
      features: ['altar_silvanus', 'boundary_stones', 'oak_grove'],
      population: 0,
      wealth: 20,
      accessibility: 'open',
      dangerLevel: 'safe',
      tags: ['shrine', 'boundary'],
      // Hill crest north of Villa Aelia
      coords: { x: 90, y: 220 },
    },
  },
  {
    id: 'figlinae-clanis',
    type: 'region',
    name: 'Figlinae Clanis',
    properties: {
      description:
        'Low riverside clay pits feeding two up-draft kilns. Products: roof tiles (tegulae, imbrices), coarse redware, amphorae for local transport.',
      regionType: 'clay_pits',
      commonType: 'workshop',
      features: ['clay_pits', 'updraft_kilns', 'workshop'],
      output: ['roof_tiles', 'coarse_redware', 'amphorae'],
      population: 12,
      wealth: 55,
      accessibility: 'open',
      dangerLevel: 'safe',
      tags: ['kilns', 'pottery'],
      // Clay pits near the riverside between Villa Aelia and Ad Pontem
      coords: { x: 110, y: 150 },
    },
  },
  // Characters
  // Player entity (starts at Villa Aelia)
  {
    id: 'player-1',
    type: 'character',
    name: 'The Player',
    properties: {
      description: 'The player character exploring Pagus Clanis.',
      characterType: 'player',
      status: 'alive',
      health: 100,
      skills: { navigation: 5, survival: 4 },
      inventory: [],
      current_location: 'villa-aelia',
    },
  },
  {
    id: 'gaius-aelius-secundus',
    type: 'character',
    name: 'Gaius Aelius Secundus',
    properties: {
      description:
        "Freedman contractor, chief conductor for Villa Aelia's presses and cartage to the Cassia; reads and writes; ambitious.",
      characterType: 'npc',
      personality: 'practical, ambitious, anxious_to_be_respectable',
      occupation: 'contractor',
      status: 'alive',
      health: 90,
      skills: { accounting: 8, contracting: 7, reading_writing: 6, cartage: 7 },
      inventory: ['stylus_case', 'wax_tablets', 'good_belt'],
      relationships: { patron: 'aelia-tertia', works_at: 'villa-aelia' },
    },
  },
  {
    id: 'aelia-tertia',
    type: 'character',
    name: 'Aelia Tertia',
    properties: {
      description:
        'Freeborn Roman citizen; widow of an Arretine decurion; owner of Villa Aelia; patroness to potters’ collegium.',
      characterType: 'npc',
      personality: 'cultivated, cautious_with_risk',
      occupation: 'estate_owner',
      status: 'alive',
      health: 85,
      skills: { estate_management: 8, patronage: 7, politics: 6 },
      relationships: { owns: 'villa-aelia', patroness_to: 'potters_collegium' },
    },
  },
  {
    id: 'lucius-egnatius-varus',
    type: 'character',
    name: 'Lucius Egnatius Varus',
    properties: {
      description:
        'Freeborn muleteer-turned manceps, license-holder of Mansio Vallis; practical, not easily impressed; knows road gossip.',
      characterType: 'npc',
      personality: 'practical, not_easily_impressed',
      occupation: 'mansio_manager',
      status: 'alive',
      health: 88,
      skills: { stable_management: 8, road_knowledge: 9, accounting: 6 },
      relationships: { manages: 'mansio-vallis' },
    },
  },
];

// ---------------------------------------------------------------------------------
// Relations (edges)
// ---------------------------------------------------------------------------------

const relations: GTWGRelation[] = [
  // Spatial containment
  { id: 'rel-villa-aelia-in-pagus', type: 'contained_in', from: 'villa-aelia', to: 'pagus-clanis', properties: { distance_from_cassia: '2 miles', direction: 'south' } },
  { id: 'rel-ad-pontem-in-pagus', type: 'contained_in', from: 'ad-pontem-clanis', to: 'pagus-clanis', properties: { location: 'river_crossing' } },
  { id: 'rel-mansio-in-pagus', type: 'contained_in', from: 'mansio-vallis', to: 'pagus-clanis', properties: { location: 'via_cassia' } },
  { id: 'rel-lucus-in-pagus', type: 'contained_in', from: 'lucus-silvani', to: 'pagus-clanis', properties: { location: 'hill_crest' } },
  { id: 'rel-figlinae-in-pagus', type: 'contained_in', from: 'figlinae-clanis', to: 'pagus-clanis', properties: { location: 'riverside' } },
  // Player starts at Villa Aelia
  { id: 'rel-player-in-villa', type: 'contained_in', from: 'player-1', to: 'villa-aelia' },

  // Character-location associations
  { id: 'rel-aelia-owns-villa', type: 'owns', from: 'aelia-tertia', to: 'villa-aelia' },
  { id: 'rel-secundus-works-villa', type: 'related_to', from: 'gaius-aelius-secundus', to: 'villa-aelia', properties: { relationship_type: 'works_at', role: 'chief_conductor' } },
  { id: 'rel-varus-controls-mansio', type: 'controls', from: 'lucius-egnatius-varus', to: 'mansio-vallis', properties: { role: 'manceps', license_type: 'municipal' } },

  // Patron-client
  { id: 'rel-aelia-patron-secundus', type: 'related_to', from: 'aelia-tertia', to: 'gaius-aelius-secundus', properties: { relationship_type: 'patron_client', obligations: ['introductions', 'support'] } },

  // Economic trade links
  { id: 'rel-villa-trades-mansio', type: 'trades_with', from: 'villa-aelia', to: 'mansio-vallis', properties: { goods: ['wine', 'olive_oil'], transport: 'cartage' } },
  { id: 'rel-figlinae-supplies-villa', type: 'trades_with', from: 'figlinae-clanis', to: 'villa-aelia', properties: { goods: ['roof_tiles', 'amphorae'], relationship: 'supplier' } },

  // Spatial proximity (non-directional convenience)
  { id: 'rel-villa-near-ad-pontem', type: 'near', from: 'villa-aelia', to: 'ad-pontem-clanis', properties: { distance: '1.5 miles' } },
  { id: 'rel-ad-pontem-near-mansio', type: 'near', from: 'ad-pontem-clanis', to: 'mansio-vallis', properties: { distance: '0.5 miles' } },
];

// ---------------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------------

export function createPagusClanisGTWG(): GTWG {
  const base = createGTWG(entities, relations);
  return {
    ...base,
    metadata: {
      ...base.metadata,
      gridScaleMetersPerUnit: 15,
      worldTime: new Date().toISOString(),
    }
  };
}

// ---------------------------------------------------------------------------------
// Minimal query adapter for agent runtime (read-only helpers)
// ---------------------------------------------------------------------------------

export function createPagusClanisQueryAdapter(gtwg: GTWG) {
  return async (query: Record<string, any>): Promise<any> => {
    // Fuzzy name/ID search support (token-aware)
    function resolveFuzzy(qraw: string) {
      const q = qraw.toLowerCase().trim();
      const byId = getEntity(gtwg, q);
      if (byId) return [byId];
      const nameEq = gtwg.entities.find(e => e.name.toLowerCase() === q);
      if (nameEq) return [nameEq];
      const tokens = q.split(/[^a-z0-9]+/).filter(t => t.length >= 3);
      if (tokens.length === 0) return [];
      const scored = gtwg.entities
        .map((e: any) => {
          const name = String(e.name || '').toLowerCase();
          const hits = tokens.filter(t => name.includes(t));
          return { e, score: hits.length };
        })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);
      if (scored.length > 0) return [scored[0].e];
      return [];
    }
    if (typeof query === 'string') {
      return resolveFuzzy(query);
    }
    if (query && typeof query.search === 'string') {
      return resolveFuzzy(String(query.search));
    }
    // Resolve specific entities by id or name
    if (query && Array.isArray(query.entities)) {
      const lookups = query.entities as string[];
      const resolved = lookups
        .map((val) => {
          const byId = getEntity(gtwg, val);
          if (byId) return byId;
          const byName = gtwg.entities.find(e => e.name.toLowerCase() === String(val).toLowerCase()) || null;
          return byName;
        })
        .filter(Boolean);
      return resolved;
    }
    // Handle free-form queries from agent
    if (typeof query === 'string' || query.query) {
      const queryStr = typeof query === 'string' ? query : query.query;
      if (typeof queryStr === 'string') {
        // Simple keyword matching for demo
        if (queryStr.toLowerCase().includes('location') || queryStr.toLowerCase().includes('pagus clanis')) {
          return getEntitiesByType(gtwg, 'region');
        }
        if (queryStr.toLowerCase().includes('character') || queryStr.toLowerCase().includes('who')) {
          return getEntitiesByType(gtwg, 'character');
        }
        if (queryStr.toLowerCase().includes('own') || queryStr.toLowerCase().includes('ownership')) {
          return getRelations(gtwg, undefined, undefined, 'owns');
        }
        if (queryStr.toLowerCase().includes('produce') || queryStr.toLowerCase().includes('output')) {
          return getEntitiesByType(gtwg, 'region').filter((e: any) => e.properties.output);
        }
      }
    }

    // Structured query handling (demo-friendly):
    // - { area: '<name or id>', type: 'location' | 'region' | 'character' }
    // - { type: 'location' } → all regions
    if (query && (query.area || query.type)) {
      const requestedType: string | undefined = query.type;
      const wantsRegions = requestedType === 'location' || requestedType === 'region' || requestedType === undefined;
      const wantsCharacters = requestedType === 'character';

      // Resolve area/container if provided
      if (query.area || query.locationId) {
        const lookup = (query.area || query.locationId) as string;
        // Try resolve by id first, then by name (case-insensitive)
        const byId = getEntity(gtwg, lookup);
        const container = byId || (gtwg.entities.find(e => e.name.toLowerCase() === String(lookup).toLowerCase()) || null);
        if (container) {
          const contained = getDirectContainedEntities(gtwg, container.id);
          const filtered = contained.filter((e: any) => {
            if (wantsRegions) return e.type === 'region';
            if (wantsCharacters) return e.type === 'character';
            return true;
          });
          return filtered;
        }
        // If area not found, return empty list instead of null
        return [];
      }

      // No area provided: return all of requested type
      if (wantsRegions) return getEntitiesByType(gtwg, 'region');
      if (wantsCharacters) return getEntitiesByType(gtwg, 'character');
    }

    const queryBuilder = queryGTWG(gtwg);
    switch (query.type) {
      case 'entity':
        return getEntity(gtwg, query.id);
      case 'entities_by_type':
        return queryBuilder.filterByType(query.entityType).execute();
      case 'entities_by_location':
        return getDirectContainedEntities(gtwg, query.locationId);
      case 'relations_of':
        return getRelations(gtwg, query.fromId, query.toId, query.relationType);
      case 'connected':
        return findConnectedEntities(gtwg, query.id, query.relationType);
      case 'by_property':
        return queryBuilder.filterByProperty(query.property, query.value).execute();
      default:
        return [];
    }
  };
}


