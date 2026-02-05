import { WorldStateData, PatchLike } from '../types';

const MAX_LEDGER_ENTRIES = 40;

type ReducePayload = {
  telemetry?: any;
  pkg?: Record<string, any>;
  patches?: PatchLike[];
};

export function reduceWorldState(prev: WorldStateData, payload: ReducePayload): WorldStateData {
  const telemetry = payload.telemetry ?? prev.telemetry;
  const pkg = payload.pkg ?? prev.pkg;

  const ledgerFromTelemetry = Array.isArray(payload.telemetry?.ledgerTail)
    ? payload.telemetry.ledgerTail.filter((entry: unknown): entry is string => typeof entry === 'string')
    : [];

  const patchNotes = (payload.patches ?? [])
    .map((patch) => {
      if (typeof patch.note === 'string') return patch.note;
      if (typeof patch.path === 'string') return patch.path;
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));

  const ledger = dedupe([...prev.ledger, ...ledgerFromTelemetry, ...patchNotes]).slice(
    -MAX_LEDGER_ENTRIES
  );

  return {
    gtwg: telemetry ? telemetryToWorldShape(telemetry) : prev.gtwg,
    pkg,
    ledger,
    telemetry,
  };
}

function telemetryToWorldShape(telemetry: any) {
  const locationId = telemetry.player?.locationId ?? telemetry.location?.id;
  const locationName = telemetry.location?.name ?? locationId;

  const locations = locationId
    ? {
        [locationId]: {
          id: locationId,
          name: locationName,
          description: telemetry.location?.description || '',
          items: telemetry.location?.items || [],
        },
      }
    : {};

  return {
    player: {
      id: telemetry.player?.id,
      location: locationId,
      pos: telemetry.player?.position,
      inventory: telemetry.player?.inventory || [],
    },
    locations,
    systems: telemetry.systems,
    meta: {
      turn: telemetry.turn,
      seed: telemetry.seed,
    },
  };
}

function dedupe(entries: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const entry of entries) {
    if (!seen.has(entry)) {
      seen.add(entry);
      ordered.push(entry);
    }
  }
  return ordered;
}
