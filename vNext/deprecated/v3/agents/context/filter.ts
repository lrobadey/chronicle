import type { TurnTelemetry } from '../../state/telemetry';
import type { ProjectPKGOutput } from '../../tools/types';

export interface ContextFilterOptions {
  mode?: 'gm' | 'narrator';
  maxChars?: number;
  maxLocations?: number;
  maxNPCs?: number;
  maxItems?: number;
  maxLedgerEntries?: number;
}

interface Section {
  label: string;
  body: string;
}

export interface FilteredContext {
  sections: Section[];
  stats: {
    approxTokens: number;
    truncatedSections: string[];
  };
}

const DEFAULT_OPTIONS: Required<ContextFilterOptions> = {
  mode: 'gm',
  maxChars: 3200,
  maxLocations: 4,
  maxNPCs: 4,
  maxItems: 6,
  maxLedgerEntries: 5,
};

export function buildFilteredContext(params: {
  telemetry: TurnTelemetry;
  pkg?: ProjectPKGOutput;
  options?: ContextFilterOptions;
}): FilteredContext {
  const { telemetry, pkg } = params;
  const options = { ...DEFAULT_OPTIONS, ...(params.options || {}) };

  const sections: Section[] = [];

  sections.push({
    label: 'Turn',
    body: [
      `Turn ${telemetry.turn}`,
      telemetry.systems?.time
        ? `Time: ${telemetry.systems.time.timeOfDay}, hour ${telemetry.systems.time.currentHour}`
        : undefined,
      telemetry.systems?.tide ? `Tide: ${telemetry.systems.tide.phase}` : undefined,
      formatWeather(telemetry.systems?.weather),
    ]
      .filter(Boolean)
      .join('\n'),
  });

  sections.push({
    label: 'Location',
    body: [
      `Name: ${telemetry.location.name}`,
      telemetry.location.description,
      telemetry.player?.position
        ? `Player position: (${telemetry.player.position.x.toFixed(1)}, ${telemetry.player.position.y.toFixed(
            1
          )}${telemetry.player.position.z !== undefined ? `, ${telemetry.player.position.z.toFixed(1)}` : ''})`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
  });

  const visibleItems = telemetry.location.items.slice(0, options.maxItems);
  if (visibleItems.length) {
    sections.push({
      label: 'Visible Items',
      body: visibleItems.map((item) => `- ${item.name}`).join('\n'),
    });
  }

  const nearbyLocations = telemetry.nearbyLocations.slice(0, options.maxLocations);
  if (nearbyLocations.length) {
    sections.push({
      label: 'Nearby',
      body: nearbyLocations
        .map(
          (loc) =>
            `- ${loc.name}${loc.bearing ? ` (${loc.bearing})` : ''}${
              typeof loc.distance === 'number' ? ` ~${Math.round(loc.distance)}m` : ''
            }`
        )
        .join('\n'),
    });
  }

  if (pkg) {
    const knownLocations = pkg.knownLocations
      .filter((loc) => loc.visited)
      .slice(-options.maxLocations)
      .map((loc) => `- ${loc.name}${loc.lastVisitedTurn ? ` (T${loc.lastVisitedTurn})` : ''}`);
    if (knownLocations.length) {
      sections.push({
        label: 'Player Knowledge: Locations',
        body: knownLocations.join('\n'),
      });
    }

    const knownNPCs = pkg.knownNPCs.slice(-options.maxNPCs).map((npc) => {
      const suffix = npc.lastSeenLocationId ? ` @ ${npc.lastSeenLocationId}` : '';
      return `- ${npc.name}${suffix}`;
    });
    if (knownNPCs.length) {
      sections.push({
        label: 'Player Knowledge: NPCs',
        body: knownNPCs.join('\n'),
      });
    }

    const knownItems = pkg.knownItems.slice(-options.maxItems).map((item) => {
      const status = item.inInventory ? 'inventory' : item.lastSeenLocationId || 'observed';
      return `- ${item.name} (${status})`;
    });
    if (knownItems.length) {
      sections.push({
        label: 'Player Knowledge: Items',
        body: knownItems.join('\n'),
      });
    }

    if (pkg.nearbyDirections?.length) {
      sections.push({
        label: 'Directions',
        body: pkg.nearbyDirections
          .slice(0, options.maxLocations)
          .map(
            (dir) =>
              `- ${dir.direction} -> ${dir.locationName ?? dir.locationId ?? 'unknown'}${
                typeof dir.distance === 'number' ? ` (${Math.round(dir.distance)}m)` : ''
              }`
          )
          .join('\n'),
      });
    }
  }

  const ledgerTail = telemetry.ledgerTail.slice(-options.maxLedgerEntries);
  if (ledgerTail.length) {
    sections.push({
      label: 'Ledger',
      body: ledgerTail.map((entry) => `- ${entry}`).join('\n'),
    });
  }

  if (telemetry.systems?.weather?.signals?.length) {
    sections.push({
      label: 'Signals',
      body: telemetry.systems.weather.signals.map((signal: string) => `- ${signal}`).join('\n'),
    });
  }

  const prioritizedOrder = prioritizeSections(options.mode);
  const orderedSections = sections.sort(
    (a, b) => prioritizedOrder.indexOf(a.label) - prioritizedOrder.indexOf(b.label)
  );

  const truncated: string[] = [];
  while (estimateLength(orderedSections) > options.maxChars && orderedSections.length > 1) {
    const removed = orderedSections.pop();
    if (removed) truncated.push(removed.label);
  }

  const approxTokens = Math.ceil(estimateLength(orderedSections) / 4);

  return {
    sections: orderedSections,
    stats: {
      approxTokens,
      truncatedSections: truncated,
    },
  };
}

export function formatFilteredContext(filtered: FilteredContext): string {
  return filtered.sections
    .filter((section) => section.body && section.body.trim().length > 0)
    .map((section) => `${section.label}:\n${section.body}`)
    .join('\n\n');
}

function formatWeather(weather?: any) {
  if (!weather) return undefined;
  const type = weather.type ? `${weather.type} (intensity ${weather.intensity ?? '?'})` : null;
  const temp = typeof weather.temperatureC === 'number' ? `${weather.temperatureC}°C` : null;
  const wind = typeof weather.windKph === 'number' ? `${weather.windKph} km/h wind` : null;
  const pressure = weather.pressure?.system
    ? `${weather.pressure.system} pressure${weather.pressure.hPa ? ` ${weather.pressure.hPa} hPa` : ''}`
    : null;
  return ['Weather:', type, temp, wind, pressure].filter(Boolean).join(' ');
}

function prioritizeSections(mode: 'gm' | 'narrator' = 'gm'): string[] {
  if (mode === 'narrator') {
    return [
      'Turn',
      'Location',
      'Visible Items',
      'Nearby',
      'Player Knowledge: Locations',
      'Player Knowledge: NPCs',
      'Player Knowledge: Items',
      'Ledger',
      'Directions',
      'Signals',
    ];
  }
  return [
    'Turn',
    'Location',
    'Nearby',
    'Directions',
    'Visible Items',
    'Player Knowledge: Locations',
    'Player Knowledge: NPCs',
    'Player Knowledge: Items',
    'Ledger',
    'Signals',
  ];
}

function estimateLength(sections: Section[]): number {
  return sections.reduce((sum, section) => sum + section.label.length + section.body.length + 4, 0);
}

