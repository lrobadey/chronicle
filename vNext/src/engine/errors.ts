export class ChronicleError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ChronicleError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class InputValidationError extends ChronicleError {
  constructor(message: string, details?: unknown) {
    super('invalid_input', message, 400, details);
  }
}

export class SessionNotFoundError extends ChronicleError {
  constructor(sessionId: string) {
    super('session_not_found', `Session ${sessionId} not found`, 404);
  }
}

export class PlayerNotFoundError extends ChronicleError {
  constructor(playerId: string) {
    super('player_not_found', `Player ${playerId} not found`, 404);
  }
}

export class UnknownWorldError extends ChronicleError {
  constructor(worldId: string | undefined, validWorldIds: string[]) {
    const requested = worldId?.trim() || 'unknown';
    super(
      'unknown_world',
      `Unknown world id: ${requested}. Valid worlds: ${validWorldIds.join(', ')}`,
      400,
      { worldId, validWorldIds },
    );
  }
}

export class IncompatibleSessionError extends ChronicleError {
  constructor(sessionId: string, version: string | undefined) {
    super(
      'session_version_incompatible',
      `Session ${sessionId} is incompatible with vNext (found version: ${version || 'unknown'})`,
      409,
      { version },
    );
  }
}

export class InvariantViolationError extends ChronicleError {
  constructor(message: string, details?: unknown) {
    super('invariant_violation', message, 422, details);
  }
}

export type SpinePlacementType = 'located_in' | 'inside' | 'on' | 'carried_by' | 'worn_by';

export interface SpineIntegrityIssue {
  code:
    | 'missing_item_placement'
    | 'multiple_item_placements'
    | 'missing_placement_target'
    | 'invalid_placement_target_kind'
    | 'missing_location_anchor'
    | 'index_missing_relation'
    | 'index_dangling_relation'
    | 'index_relation_mismatch';
  path: string;
  message: string;
  itemId?: string;
  relationId?: string;
  targetId?: string;
  placementType?: SpinePlacementType;
}

export interface SpineIntegrityErrorDetails {
  issues: SpineIntegrityIssue[];
}

export class SpineIntegrityError extends ChronicleError {
  constructor(details: SpineIntegrityErrorDetails, message = details.issues[0]?.message || 'Spine integrity violation') {
    super('spine_integrity', message, 422, details);
  }
}

export function isChronicleError(error: unknown): error is ChronicleError {
  return error instanceof ChronicleError;
}
