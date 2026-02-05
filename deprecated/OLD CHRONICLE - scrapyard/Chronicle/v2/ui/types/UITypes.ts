// UITypes.ts - V2 UI adapter types (projection-friendly)

// Minimal map projection for UI rendering
export type VisitState = 'unvisited' | 'visited' | 'current' | 'important';

export interface MapFeature {
  id: string;
  type: 'building' | 'road' | 'terrain' | 'player' | 'water' | 'forest' | 'mountain' | 'landmark';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visitState?: VisitState;
}

export interface MapData {
  playerX: number;
  playerY: number;
  gridSize: number;
  features: MapFeature[];
}

// Chat message types for UI
export enum Sender {
  Player = 'PLAYER',
  GM = 'GM',
  System = 'SYSTEM',
}

export interface ChatMessage {
  id: string;
  sender: Sender;
  text: string;
  isLoading?: boolean;
  timestamp?: string;
}

// Sidebar/world summary data (PKG projection friendly)
export interface WorldSidebarData {
  worldState?: string;
  quests: string[];
  people: string[];
  locations: string[];
  regions: string[];
  motives: string[];
  lore: string[];
}


