import type { WorldState, ActorId } from '../state';
import { deriveTime } from '../systems/time';
import { deriveTide } from '../systems/tide';
import { deriveWeather } from '../systems/weather';
import { deriveConstraints } from '../systems/constraints';
import { actorsWithinRadius, distance, locationsWithinRadius } from '../utils';

export interface Observation {
  turn: number;
  time: ReturnType<typeof deriveTime>;
  tide: ReturnType<typeof deriveTide>;
  weather: ReturnType<typeof deriveWeather>;
  constraints: ReturnType<typeof deriveConstraints>;
  player: {
    id: ActorId;
    name: string;
    pos: { x: number; y: number; z?: number };
    inventory: string[];
  };
  nearbyLocations: Array<{
    id: string;
    name: string;
    distance: number;
    anchor: { x: number; y: number; z?: number };
    radiusCells?: number;
    blockedNow: boolean;
  }>;
  nearbyActors: Array<{ id: string; name: string; kind: 'player' | 'npc'; distance: number; pos: { x: number; y: number; z?: number } }>;
  nearbyItems: Array<{ id: string; name: string; distance: number; pos: { x: number; y: number; z?: number } }>;
  ledgerTail: string[];
}

export function buildObservation(state: WorldState, playerId: ActorId): Observation {
  const player = state.actors[playerId];
  const time = deriveTime(state);
  const tide = deriveTide(state);
  const weather = deriveWeather(state);
  const constraints = deriveConstraints(state);

  const nearbyLocations = locationsWithinRadius(state, player.pos, 1200).map(loc => ({
    id: loc.id,
    name: loc.name,
    distance: distance(player.pos, loc.anchor),
    anchor: loc.anchor,
    radiusCells: loc.radiusCells,
    blockedNow: tide.blockedLocationIds.includes(loc.id),
  })).sort((a, b) => a.distance - b.distance);

  const nearbyActors = actorsWithinRadius(state, player.pos, 200)
    .filter(a => a.id !== playerId)
    .map(a => ({ id: a.id, name: a.name, kind: a.kind, distance: distance(player.pos, a.pos), pos: a.pos }))
    .sort((a, b) => a.distance - b.distance);

  const nearbyItems = Object.values(state.items)
    .flatMap(item => {
      if (item.location.kind !== 'ground') return [];
      const itemDistance = distance(player.pos, item.location.pos);
      if (itemDistance > 120) return [];
      return [{
        id: item.id,
        name: item.name,
        distance: itemDistance,
        pos: item.location.pos,
      }];
    })
    .sort((a, b) => a.distance - b.distance);

  return {
    turn: state.meta.turn,
    time,
    tide,
    weather,
    constraints,
    player: {
      id: player.id,
      name: player.name,
      pos: player.pos,
      inventory: player.inventory,
    },
    nearbyLocations,
    nearbyActors,
    nearbyItems,
    ledgerTail: state.ledger.slice(-5).map(l => l.text),
  };
}
