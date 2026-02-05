
import React, { useMemo, useState } from 'react';
import { WorldStateData } from '../types';
import { DatabaseIcon, PlayerIcon } from './Icons';

interface WorldStateProps {
  state: WorldStateData;
  newPatch: string | null;
}

type NormalizedLocation = {
  id: string;
  name: string;
  visited?: boolean;
  lastVisitedTurn?: number;
};

type NormalizedNPC = {
  id: string;
  name: string;
  lastSeenLocationId?: string;
  lastSeenTurn?: number;
};

type NormalizedItem = {
  id: string;
  name: string;
  inInventory?: boolean;
  lastSeenLocationId?: string;
};

type NearbyDirection = {
  direction: string;
  locationName?: string;
  distance?: number;
};

const CollapsibleSection: React.FC<{
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-gray-900/60 rounded-lg border border-gray-700/50">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 text-left text-sm font-semibold text-gray-200"
      >
        <span>{title}</span>
        <span className="text-xs text-gray-400">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="px-3 pb-3 text-sm text-gray-300">{children}</div>}
    </div>
  );
};

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <p className="text-xs italic text-gray-500">{message}</p>
);

const formatClock = (timeState: any): string | null => {
  if (!timeState) return null;
  if (timeState.anchor?.isoDateTime) {
    const anchor = new Date(timeState.anchor.isoDateTime);
    const elapsed = typeof timeState.elapsedMinutes === 'number' ? timeState.elapsedMinutes : 0;
    const current = new Date(anchor.getTime() + elapsed * 60 * 1000);
    return current.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  if (typeof timeState.elapsedMinutes === 'number') {
    const startHour = timeState.startHour ?? 0;
    const totalMinutes = startHour * 60 + timeState.elapsedMinutes;
    const hours24 = Math.floor(totalMinutes / 60) % 24;
    const minutes = String(totalMinutes % 60).padStart(2, '0');
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 || 12;
    return `Day ${Math.floor(timeState.elapsedMinutes / (24 * 60)) + 1}, ${hours12}:${minutes} ${period}`;
  }
  return null;
};

const normalizeLocations = (pkg: any): NormalizedLocation[] => {
  const byId = new Map<string, NormalizedLocation>();
  const push = (loc: Partial<NormalizedLocation> | string) => {
    if (!loc) return;
    if (typeof loc === 'string') {
      byId.set(loc, { id: loc, name: loc });
      return;
    }
    const id = loc.id ?? loc.name ?? '';
    if (!id) return;
    const name = loc.name ?? id;
    byId.set(id, { id, name, visited: loc.visited, lastVisitedTurn: loc.lastVisitedTurn });
  };
  (Array.isArray(pkg?.knownLocations) ? pkg.knownLocations : []).forEach(push);
  (Array.isArray(pkg?.known_locations) ? pkg.known_locations : []).forEach(push);
  if (!byId.size && typeof pkg?.currentLocationId === 'string') {
    push({ id: pkg.currentLocationId, name: pkg.currentLocationId, visited: true });
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const normalizeNPCs = (pkg: any): NormalizedNPC[] => {
  const entries = Array.isArray(pkg?.knownNPCs)
    ? pkg.knownNPCs
    : Array.isArray(pkg?.known_npcs)
    ? pkg.known_npcs
    : [];
  return entries
    .map((entry: any) => {
      if (typeof entry === 'string') {
        return { id: entry, name: entry };
      }
      if (!entry?.id && !entry?.name) return null;
      return {
        id: entry.id ?? entry.name,
        name: entry.name ?? entry.id,
        lastSeenLocationId: entry.lastSeenLocationId,
        lastSeenTurn: entry.lastSeenTurn,
      };
    })
    .filter(Boolean) as NormalizedNPC[];
};

const normalizeItems = (pkg: any): NormalizedItem[] => {
  const items = Array.isArray(pkg?.knownItems)
    ? pkg.knownItems
    : Array.isArray(pkg?.known_items)
    ? pkg.known_items
    : [];
  const inventory = Array.isArray(pkg?.inventory) ? pkg.inventory : [];
  const normalized: NormalizedItem[] = [];
  for (const entry of items) {
    if (typeof entry === 'string') {
      normalized.push({ id: entry, name: entry });
    } else if (entry) {
      normalized.push({
        id: entry.id ?? entry.name,
        name: entry.name ?? entry.id,
        inInventory: entry.inInventory,
        lastSeenLocationId: entry.lastSeenLocationId,
      });
    }
  }
  for (const entry of inventory) {
    if (typeof entry === 'string') {
      normalized.push({ id: entry, name: entry, inInventory: true });
    } else if (entry) {
      normalized.push({
        id: entry.id ?? entry.name,
        name: entry.name ?? entry.id,
        inInventory: true,
      });
    }
  }
  return normalized;
};

const normalizeDirections = (pkg: any): NearbyDirection[] => {
  const directions = Array.isArray(pkg?.nearbyDirections)
    ? pkg.nearbyDirections
    : Array.isArray(pkg?.nearby_directions)
    ? pkg.nearby_directions
    : [];
  return directions
    .map((entry: any) => {
      if (!entry) return null;
      if (typeof entry === 'string') return { direction: entry };
      return {
        direction: entry.direction ?? 'unknown',
        locationName: entry.locationName ?? entry.locationId,
        distance: entry.distance,
      };
    })
    .filter(Boolean) as NearbyDirection[];
};

const renderList = (items: React.ReactNode[], emptyCopy: string) => {
  if (!items.length) {
    return <EmptyState message={emptyCopy} />;
  }
  return <ul className="space-y-2">{items}</ul>;
};

const WorldState: React.FC<WorldStateProps> = ({ state, newPatch }) => {
  const pkg = state.pkg ?? {};
  const gtwg = state.gtwg ?? {};
  const ledger = Array.isArray(state.ledger) ? state.ledger : [];

  const playerLocationId =
    pkg.currentLocationId || gtwg.player?.location || pkg.player?.location || 'unknown';
  const locationName =
    gtwg.locations?.[playerLocationId]?.name ||
    pkg.currentLocationName ||
    playerLocationId ||
    'Unmapped position';

  const normalizedLocations = useMemo(() => normalizeLocations(pkg), [pkg]);
  const normalizedNPCs = useMemo(() => normalizeNPCs(pkg), [pkg]);
  const normalizedItems = useMemo(() => normalizeItems(pkg), [pkg]);
  const nearbyDirections = useMemo(() => {
    const pkgDirections = normalizeDirections(pkg);
    if (pkgDirections.length) {
      return pkgDirections;
    }
    const telemetryNeighbors = (state as any)?.telemetry?.nearbyLocations;
    if (Array.isArray(telemetryNeighbors)) {
      return telemetryNeighbors
        .map((loc: any) => ({
          direction: loc.bearing ?? 'unknown',
          locationName: loc.name,
          distance: loc.distance ? Math.round(loc.distance) : undefined,
        }))
        .filter((entry: NearbyDirection) => Boolean(entry.direction || entry.locationName));
    }
    return [];
  }, [pkg, (state as any)?.telemetry]);

  const timeState = gtwg.systems?.time;
  const tideState = gtwg.systems?.tide;
  const weatherState = gtwg.systems?.weather || pkg.weather;

  const clock = formatClock(timeState);
  const tideSummary = tideState?.phase ? `${tideState.phase} tide` : null;

  return (
    <div className="p-4 bg-gray-800 rounded-lg border border-gray-700/60 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-teal-200">
          <DatabaseIcon className="w-5 h-5" />
          Continuity Panel
        </div>
        <span className="text-xs text-gray-400">
          Turn {gtwg.meta?.turn ?? pkg.turn ?? '—'}
        </span>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-gray-900/70 rounded-lg border border-gray-700/50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-100 mb-2">
            <PlayerIcon className="w-4 h-4 text-teal-300" />
            Player
          </div>
          <dl className="space-y-1 text-xs text-gray-300">
            <div className="flex justify-between">
              <dt className="text-gray-400">Location</dt>
              <dd className="font-semibold text-teal-200">{locationName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Coords</dt>
              <dd>
                {gtwg.player?.pos
                  ? `${gtwg.player.pos.x}, ${gtwg.player.pos.y}${gtwg.player.pos.z ? `, ${gtwg.player.pos.z}` : ''}`
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Inventory</dt>
              <dd>{normalizedItems.filter((item) => item.inInventory).length || '0'} items</dd>
            </div>
          </dl>
        </div>

        <div className="bg-gray-900/70 rounded-lg border border-gray-700/50 p-3 space-y-2 text-xs text-gray-300">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Time</span>
            <span className="font-semibold">{clock ?? 'Awaiting telemetry'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Tide</span>
            <span className="font-semibold capitalize">{tideSummary ?? '—'}</span>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Weather</span>
              <span className="font-semibold capitalize">
                {weatherState
                  ? `${weatherState.type ?? 'unknown'}${typeof weatherState.intensity === 'number' ? ` · intensity ${weatherState.intensity}` : ''}`
                  : 'Awaiting system'}
              </span>
            </div>
            {weatherState && (
              <div className="grid grid-cols-2 gap-1 text-[11px] text-gray-400 mt-1">
                {'temperatureC' in weatherState && (
                  <span>Temp: {weatherState.temperatureC}°C</span>
                )}
                {'windKph' in weatherState && (
                  <span>Wind: {weatherState.windKph} km/h</span>
                )}
                {weatherState.pressure?.hPa && (
                  <span>Pressure: {weatherState.pressure.hPa} hPa</span>
                )}
                {weatherState.pressure?.trend && (
                  <span className="capitalize">Trend: {weatherState.pressure.trend}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <CollapsibleSection title="Locations">
        {renderList(
          normalizedLocations.map((loc) => (
            <li key={loc.id} className="flex items-center justify-between">
              <span className="text-gray-200">{loc.name}</span>
              <span className="text-xs text-gray-400">
                {loc.visited ? 'visited' : 'known'}
              </span>
            </li>
          )),
          'No locations discovered yet.'
        )}
      </CollapsibleSection>

      <CollapsibleSection title="People">
        {renderList(
          normalizedNPCs.map((npc) => (
            <li key={npc.id}>
              <div className="flex justify-between text-gray-200">
                <span>{npc.name}</span>
                {npc.lastSeenLocationId && (
                  <span className="text-xs text-gray-400">at {npc.lastSeenLocationId}</span>
                )}
              </div>
            </li>
          )),
          'No notable NPCs recorded.'
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Items">
        {renderList(
          normalizedItems.map((item) => (
            <li key={item.id} className="flex justify-between">
              <span className="text-gray-200">{item.name}</span>
              <span className="text-xs text-gray-400">
                {item.inInventory ? 'inventory' : item.lastSeenLocationId || 'observed'}
              </span>
            </li>
          )),
          'No items tracked yet.'
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Nearby Directions" defaultOpen={false}>
        {renderList(
          nearbyDirections.map((dir, idx) => (
            <li key={`${dir.direction}-${dir.locationName ?? idx}`} className="flex justify-between">
              <span className="capitalize">{dir.direction}</span>
              <span className="text-xs text-gray-400">
                {dir.locationName ? dir.locationName : 'unknown'}
                {dir.distance ? ` · ${dir.distance}m` : ''}
              </span>
            </li>
          )),
          'No nearby signals.'
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Ledger (latest)">
        <div className="space-y-2 text-xs">
          {newPatch && (
            <div className="p-2 bg-yellow-500/10 border border-yellow-400/40 rounded text-yellow-200">
              {newPatch}
            </div>
          )}
          {ledger.length ? (
            ledger.slice(-8).map((entry, idx) => (
              <p key={idx} className="text-gray-300">
                {entry}
              </p>
            ))
          ) : (
            <EmptyState message="Ledger will populate once turns begin." />
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default WorldState;
