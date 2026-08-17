import type { WorldState, ActorId } from '../state';
import { isItemVisible, summarizeItemComponents, type ItemComponentSummary } from '../spine';
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
    inventory: Array<{ id: string; name: string; components?: ItemComponentSummary }>;
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
  scheduledProcesses: {
    count: number;
    next?: { label: string; dueAtMinutes: number; dueIn: string };
    upcoming: Array<{ id: string; label: string; dueAtMinutes: number }>;
  };
  knowledge: {
    seenLocations: string[];
    seenActors: string[];
    seenItems: string[];
    notes: string[];
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
  const upcomingProcesses = [...state.systems.scheduledProcesses]
    .sort((a, b) => a.dueAtMinutes - b.dueAtMinutes)
    .slice(0, 3);
  const nextProcess = upcomingProcesses[0];

  return {
    turn: state.meta.turn,
    player: {
      id: player.id,
      name: player.name,
      pos: player.pos,
      inventory: player.inventory
        .filter(id => isItemVisible(state.spine, id))
        .map(id => ({
          id,
          name: state.items[id]?.name || id,
          components: summarizeItemComponents(state.spine, id),
        })),
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
    scheduledProcesses: {
      count: state.systems.scheduledProcesses.length,
      ...(nextProcess
        ? {
            next: {
              label: nextProcess.label,
              dueAtMinutes: nextProcess.dueAtMinutes,
              dueIn: formatDueIn(nextProcess.dueAtMinutes - state.systems.time.elapsedMinutes),
            },
          }
        : {}),
      upcoming: upcomingProcesses.map(process => ({
        id: process.id,
        label: process.label,
        dueAtMinutes: process.dueAtMinutes,
      })),
    },
    knowledge: {
      seenLocations: Object.keys(knowledge.seenLocations),
      seenActors: Object.keys(knowledge.seenActors),
      seenItems: Object.keys(knowledge.seenItems),
      notes: knowledge.notes,
    },
  };
}

function formatDueIn(deltaMinutes: number): string {
  if (deltaMinutes <= 0) return 'now';
  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;
  if (hours && minutes) return `in ${hours}h ${minutes}m`;
  if (hours) return `in ${hours}h`;
  return `in ${minutes}m`;
}
