import type { WorldEvent } from '../../sim/events';
import type { GridPos, PendingPrompt } from '../../sim/state';

export type MechanicsInterpretation =
  | 'move'
  | 'travel'
  | 'inspect'
  | 'explore'
  | 'wait'
  | 'affect_item'
  | 'clarify'
  | 'none';

export interface MechanicsPendingPromptDraft {
  kind: PendingPrompt['kind'];
  question: string;
  options?: PendingPrompt['options'];
  data?: PendingPrompt['data'];
}

export type MechanicsResolutionStatus = 'ok' | 'no_safe_action' | 'worker_contract_failed';

export interface MechanicsTravelCandidate {
  id: string;
  name: string;
  aliases?: string[];
  distanceMeters: number;
  estimatedWalkMinutes: number;
  blockedNow: boolean;
  requiresConfirm: boolean;
}

export type MechanicsAction =
  | {
      type: 'travel';
      actorId: string;
      locationId: string;
      pace?: 'walk' | 'run';
      confirmId?: string;
      note?: string;
    }
  | {
      type: 'move';
      actorId: string;
      toLocationId?: string;
      to?: GridPos;
      mode?: 'walk' | 'run';
      note?: string;
    }
  | {
      type: 'inspect';
      actorId: string;
      subject: string;
      note?: string;
    }
  | {
      type: 'explore';
      actorId: string;
      area: string;
      direction?: 'east' | 'west' | 'north' | 'south';
      note?: string;
    }
  | {
      type: 'wait';
      minutes: number;
      note?: string;
    }
  | {
      type: 'affect_item';
      actorId: string;
      itemId: string;
      effect: 'pick_up' | 'drop' | 'transfer' | 'open' | 'close' | 'break' | 'consume' | 'empty' | 'fill' | 'ruin';
      targetActorId?: string;
      targetContainerId?: string;
      instrumentItemId?: string;
      note?: string;
      at?: GridPos;
    };

export interface MechanicsDebugRecord {
  request: MechanicsWorkerRequest;
  selectedModel?: string;
  fallbackModel?: string;
  usedFallback: boolean;
  responseId?: string;
  rawArguments?: string;
  parsedStatus: MechanicsResolutionStatus;
  failureReason?: string;
}

export interface MechanicsResolution {
  resolutionId: string;
  status: MechanicsResolutionStatus;
  interpretation: MechanicsInterpretation;
  summary: string;
  candidateEvents: WorldEvent[];
  pendingPrompt: PendingPrompt | null;
  touchedEntities: string[];
  confidence: number;
  warnings: string[];
  debug?: MechanicsDebugRecord;
}

export interface MechanicsWorkerRequest {
  playerText: string;
  objective?: string;
  focus?: string;
  revisionFeedback?: string;
  previousDraft?: {
    interpretation: MechanicsInterpretation;
    summary: string;
    candidateEvents: unknown[];
    confidence: number;
  };
  pendingPrompt: PendingPrompt | null;
  telemetry: unknown;
  travelCandidates: MechanicsTravelCandidate[];
  nearby: {
    actors: unknown[];
    itemsOnGround: unknown[];
  };
  landmarks: unknown[];
  observation: unknown;
  localAffordances?: {
    carriedItems: Array<{
      id: string;
      name: string;
      components?: unknown;
    }>;
    nearbyItems: Array<{
      id: string;
      name: string;
      distanceMeters: number;
      portable: boolean;
      components?: unknown;
    }>;
    nearbyActors: Array<{
      id: string;
      name: string;
      distanceMeters: number;
      inventory: Array<{
        id: string;
        name: string;
      }>;
    }>;
    obviousOffers: Array<{
      kind: 'item' | 'service';
      actorId: string;
      actorName: string;
      summary: string;
      itemId?: string;
      itemName?: string;
    }>;
  };
}

export interface MechanicsResolutionDraft {
  status: MechanicsResolutionStatus;
  interpretation: MechanicsInterpretation;
  summary: string;
  actions: MechanicsAction[];
  pendingPromptDraft: MechanicsPendingPromptDraft | null;
  touchedEntities: string[];
  confidence: number;
  warnings: string[];
  debug?: MechanicsDebugRecord;
}

export interface MechanicsResolutionRecord {
  request: MechanicsWorkerRequest;
  resolution: MechanicsResolution;
  revisionCount: number;
}
