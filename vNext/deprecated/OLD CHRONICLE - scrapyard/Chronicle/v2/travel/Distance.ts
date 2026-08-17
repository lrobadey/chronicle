// Distance.ts - Minimal travel distance and ETA utilities
// ================================================
import type { GTWG } from '../types/GTWGTypes.js';
import { getEntity } from '../data/GTWG.js';

type Coords = { x: number; y: number };

function getCoords(gtwg: GTWG, entityId: string): Coords | null {
  const entity = getEntity(gtwg, entityId) as any;
  const coords = entity?.properties?.coords;
  if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') return null;
  return { x: coords.x, y: coords.y };
}

function getScaleMetersPerUnit(gtwg: GTWG, defaultScale = 15): number {
  const scale = (gtwg as any)?.metadata?.gridScaleMetersPerUnit;
  return typeof scale === 'number' && scale > 0 ? scale : defaultScale;
}

export function calculateGridDistanceUnits(gtwg: GTWG, fromId: string, toId: string): number | null {
  const a = getCoords(gtwg, fromId);
  const b = getCoords(gtwg, toId);
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function estimateWalkingEtaMinutes(distanceMeters: number, paceMetersPerMinute = 5000 / 60): number {
  if (distanceMeters <= 0) return 0;
  const minutes = distanceMeters / paceMetersPerMinute;
  return Math.max(0, Math.round(minutes));
}

export function calculateDistanceAndEta(gtwg: GTWG, fromId: string, toId: string, paceMetersPerMinute?: number) {
  const units = calculateGridDistanceUnits(gtwg, fromId, toId);
  if (units === null) {
    return { ok: false, error: 'Missing coordinates for one or both entities', distanceUnits: 0, distanceMeters: 0, etaMinutes: 0 } as const;
  }
  const scale = getScaleMetersPerUnit(gtwg);
  const distanceMeters = units * scale;
  const etaMinutes = estimateWalkingEtaMinutes(distanceMeters, paceMetersPerMinute);
  return { ok: true, distanceUnits: units, distanceMeters, etaMinutes, scaleMetersPerUnit: scale } as const;
}


