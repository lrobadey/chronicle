import type { WorldState, ActorId } from '../state';
import { deriveTime } from '../systems/time';
import { deriveTide } from '../systems/tide';
import { deriveWeather } from '../systems/weather';
import { distance, findNearestLocation, locationsWithinRadius, actorsWithinRadius } from '../utils';

export interface Telemetry {
  turn: number;
  player: {
    id: ActorId;
    name: string;
    pos: { x: number; y: number; z?: number };
    inventory: Array<{ id: string; name: string }>;
  };
  location: {
    id: string | null;
    name: string;
    description: string;
  };
  nearbyLocations: Array<{ id: string; name: string; distance: number }>;
  nearbyActors: Array<{ id: string; name: string; distance: number }>;
  time: ReturnType<typeof deriveTime>;
  tide: ReturnType<typeof deriveTide>;
  weather: ReturnType<typeof deriveWeather>;
  ledgerTail: string[];
  knowledge: {
    seenLocations: string[];
    seenActors: string[];
    seenItems: string[];
  };
}

export function buildTelemetry(state: WorldState, playerId: ActorId): Telemetry {
  const player = state.actors[playerId];
  const time = deriveTime(state);
  const tide = deriveTide(state);
  const weather = deriveWeather(state);
  const nearest = findNearestLocation(state, player.pos);
  const nearestDistance = nearest ? distance(player.pos, nearest.anchor) : Infinity;
  const insideNearest = nearest && nearestDistance <= (nearest.radiusCells ?? 80);

  const nearbyLocations = locationsWithinRadius(state, player.pos, 300)
    .map(loc => ({ id: loc.id, name: loc.name, distance: distance(player.pos, loc.anchor) }))
    .sort((a, b) => a.distance - b.distance);

  const nearbyActors = actorsWithinRadius(state, player.pos, 200)
    .filter(a => a.id !== playerId)
    .map(a => ({ id: a.id, name: a.name, distance: distance(player.pos, a.pos) }))
    .sort((a, b) => a.distance - b.distance);

  const knowledge = state.knowledge[playerId] || { seenActors: {}, seenItems: {}, seenLocations: {}, notes: [] };

  return {
    turn: state.meta.turn,
    player: {
      id: player.id,
      name: player.name,
      pos: player.pos,
      inventory: player.inventory.map(id => ({ id, name: state.items[id]?.name || id })),
    },
    location: {
      id: insideNearest ? nearest!.id : null,
      name: insideNearest ? nearest!.name : 'Wilderness',
      description: insideNearest ? nearest!.description : 'An unmarked stretch of land.',
    },
    nearbyLocations,
    nearbyActors,
    time,
    tide,
    weather,
    ledgerTail: state.ledger.slice(-5).map(l => l.text),
    knowledge: {
      seenLocations: Object.keys(knowledge.seenLocations),
      seenActors: Object.keys(knowledge.seenActors),
      seenItems: Object.keys(knowledge.seenItems),
    },
  };
}
