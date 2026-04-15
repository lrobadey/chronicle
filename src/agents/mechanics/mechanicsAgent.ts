import type { LLMClient, ResponseOutputItem, ResponseToolDefinition } from '../llm/types';
import { MECHANICS_FALLBACK_MODEL, MECHANICS_MODEL } from '../llm/defaults';
import { classifyLLMError } from '../llm/errorUtils';
import { isFunctionCallItem, pushLLMTrace } from '../llm/trace';
import {
  NULLABLE_GRID_POS_SCHEMA,
  PENDING_PROMPT_DATA_SCHEMA,
  PROMPT_OPTION_SCHEMA,
  strictObjectSchema,
} from '../sharedSchemas';
import type { DebugSink } from '../../engine/debug';
import type { PendingPrompt } from '../../sim/state';
import type { WorldEvent } from '../../sim/events';
import { MECHANICS_SYSTEM_PROMPT } from './prompts';
import { resolveDeterministicMechanics } from './deterministicResolver';
import type {
  MechanicsAction,
  MechanicsDebugRecord,
  MechanicsInterpretation,
  MechanicsPendingPromptDraft,
  MechanicsResolution,
  MechanicsResolutionDraft,
  MechanicsResolutionStatus,
  MechanicsWorkerRequest,
} from './types';

const MECHANICS_OUTPUT_TOOL_NAME = 'emit_mechanics_resolution';

const MECHANICS_PENDING_PROMPT_DRAFT_SCHEMA = strictObjectSchema(
  {
    kind: { type: 'string', enum: ['confirm_travel', 'clarify_target', 'clarify_explore'] },
    question: { type: 'string' },
    options: { type: ['array', 'null'], items: PROMPT_OPTION_SCHEMA },
    data: PENDING_PROMPT_DATA_SCHEMA,
  },
  { nullable: true },
);

const MECHANICS_ACTION_SCHEMA = {
  anyOf: [
    strictObjectSchema({
      type: { type: 'string', enum: ['travel'] },
      actorId: { type: 'string' },
      locationId: { type: 'string' },
      pace: { type: ['string', 'null'], enum: ['walk', 'run', null] },
      confirmId: { type: ['string', 'null'] },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['move'] },
      actorId: { type: 'string' },
      toLocationId: { type: ['string', 'null'] },
      to: { ...NULLABLE_GRID_POS_SCHEMA, type: ['object', 'null'] },
      mode: { type: ['string', 'null'], enum: ['walk', 'run', null] },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['inspect'] },
      actorId: { type: 'string' },
      subject: { type: 'string' },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['explore'] },
      actorId: { type: 'string' },
      area: { type: 'string' },
      direction: { type: ['string', 'null'], enum: ['east', 'west', 'north', 'south', null] },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['wait'] },
      minutes: { type: 'number' },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['affect_item'] },
      actorId: { type: 'string' },
      itemId: { type: 'string' },
      effect: { type: 'string', enum: ['pick_up', 'drop', 'transfer', 'open', 'close', 'break', 'consume', 'empty', 'fill', 'ruin'] },
      targetActorId: { type: ['string', 'null'] },
      targetContainerId: { type: ['string', 'null'] },
      instrumentItemId: { type: ['string', 'null'] },
      at: { ...NULLABLE_GRID_POS_SCHEMA, type: ['object', 'null'] },
      note: { type: ['string', 'null'] },
    }),
  ],
} as const;

const MECHANICS_OUTPUT_TOOL: ResponseToolDefinition = {
  type: 'function',
  name: MECHANICS_OUTPUT_TOOL_NAME,
  description: 'Return the mechanical interpretation and small mechanics actions for the latest simple player action.',
  strict: true,
  parameters: strictObjectSchema({
    interpretation: { type: 'string', enum: ['move', 'travel', 'inspect', 'explore', 'wait', 'affect_item', 'clarify', 'none'] },
    summary: { type: 'string' },
    actions: { type: 'array', items: MECHANICS_ACTION_SCHEMA, maxItems: 2 },
    pendingPrompt: MECHANICS_PENDING_PROMPT_DRAFT_SCHEMA,
    touchedEntities: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    warnings: { type: 'array', items: { type: 'string' } },
  }),
};

export interface MechanicsAgentParams {
  apiKey?: string;
  model?: string;
  fallbackModel?: string;
  request: MechanicsWorkerRequest;
  llm: LLMClient;
  debug?: DebugSink;
  trace?: {
    llmCalls?: Array<{
      agent: 'gm' | 'steward' | 'legacy_gm' | 'observer' | 'npc' | 'narrator' | 'specialist' | 'mechanics' | 'schedule' | 'staff_interview';
      responseId?: string;
      previousResponseId?: string;
      inputItems?: number;
      outputItems?: number;
      toolCalls?: number;
      usage?: unknown;
      status?: string;
      error?: unknown;
      specialistType?: string;
    }>;
  };
}

export async function runMechanicsAgent(params: MechanicsAgentParams): Promise<MechanicsResolutionDraft> {
  const {
    apiKey,
    model = MECHANICS_MODEL,
    fallbackModel = MECHANICS_FALLBACK_MODEL,
    request,
    llm,
    trace,
  } = params;

  if (!apiKey) {
    const deterministic = !request.revisionFeedback
      ? resolveDeterministicMechanics(request)
      : null;
    if (deterministic) {
      return {
        ...deterministic,
        debug: buildDebugRecord({
          request,
          selectedModel: 'deterministic',
          fallbackModel,
          usedFallback: false,
          parsedStatus: deterministic.status,
        }),
      };
    }
    return failedMechanicsOutput(request, 'missing_api_key', undefined, fallbackModel);
  }

  const deterministic = !request.revisionFeedback
    ? resolveDeterministicMechanics(request)
    : null;
  if (deterministic) {
    return {
      ...deterministic,
      debug: buildDebugRecord({
        request,
        selectedModel: 'deterministic',
        fallbackModel,
        usedFallback: false,
        parsedStatus: deterministic.status,
      }),
    };
  }

  const selectedModels = [model, fallbackModel].filter(
    (value, index, self): value is string => Boolean(value) && self.indexOf(value) === index,
  );
  let lastFailureReason = 'missing_function_output';
  let lastDebug: MechanicsDebugRecord | undefined;

  for (let index = 0; index < selectedModels.length; index++) {
    const selectedModel = selectedModels[index]!;
    let response;

    try {
      response = await llm.responsesCreate({
        apiKey,
        model: selectedModel,
        reasoning: { effort: 'medium' },
        instructions: MECHANICS_SYSTEM_PROMPT,
        input: JSON.stringify(request),
        tools: [MECHANICS_OUTPUT_TOOL],
        tool_choice: { type: 'function', name: MECHANICS_OUTPUT_TOOL_NAME },
        truncation: 'auto',
        store: true,
      });
    } catch (error) {
      const failureReason = String(classifyLLMError(error));
      pushLLMTrace(trace, {
        agent: 'mechanics',
        inputItems: 1,
        status: 'failed',
        error: failureReason,
      });
      return failedMechanicsOutput(
        request,
        failureReason,
        selectedModel,
        fallbackModel,
        index > 0,
      );
    }

    const functionCalls = response.output.filter(isFunctionCallItem);
    const resultCall = functionCalls.find(call => call.name === MECHANICS_OUTPUT_TOOL_NAME);
    pushLLMTrace(trace, {
      agent: 'mechanics',
      responseId: response.id,
      inputItems: 1,
      outputItems: response.output.length,
      toolCalls: functionCalls.length,
      usage: response.usage,
      status: response.status,
      error: response.error ?? response.incomplete_details,
    });

    if (!resultCall) {
      lastFailureReason = String(response.error ?? response.incomplete_details ?? 'missing_function_output');
      lastDebug = buildDebugRecord({
        request,
        selectedModel,
        fallbackModel,
        usedFallback: index > 0,
        responseId: response.id,
        parsedStatus: 'worker_contract_failed',
        failureReason: lastFailureReason,
      });
      if (index === 0 && selectedModels.length > 1) continue;
      return failedMechanicsOutput(request, lastFailureReason, selectedModel, fallbackModel, index > 0, response.id);
    }

    const parsed = parseMechanicsOutput(resultCall.arguments);
    if (parsed.ok) {
      return {
        ...parsed.draft,
        status: parsed.draft.interpretation === 'none' && parsed.draft.actions.length === 0
          ? 'no_safe_action'
          : 'ok',
        debug: buildDebugRecord({
          request,
          selectedModel,
          fallbackModel,
          usedFallback: index > 0,
          responseId: response.id,
          rawArguments: resultCall.arguments,
          parsedStatus: parsed.draft.interpretation === 'none' && parsed.draft.actions.length === 0 ? 'no_safe_action' : 'ok',
        }),
      };
    }

    const failureReason = 'reason' in parsed ? parsed.reason : 'invalid_function_output';
    lastFailureReason = failureReason;
    lastDebug = buildDebugRecord({
      request,
      selectedModel,
      fallbackModel,
      usedFallback: index > 0,
      responseId: response.id,
      rawArguments: resultCall.arguments,
      parsedStatus: 'worker_contract_failed',
      failureReason,
    });
    if (index === 0 && selectedModels.length > 1) continue;
  }

  return {
    ...failedMechanicsOutput(
      request,
      lastFailureReason,
      lastDebug?.selectedModel,
      fallbackModel,
      lastDebug?.usedFallback ?? false,
      lastDebug?.responseId,
    ),
    debug: lastDebug,
  };
}

export function attachResolutionMetadata(
  draft: MechanicsResolutionDraft,
  resolutionId: string,
  currentPrompt: PendingPrompt | null,
  turn: number,
): MechanicsResolution {
  return {
    resolutionId,
    status: draft.status,
    interpretation: draft.interpretation,
    summary: draft.summary,
    candidateEvents: convertMechanicsActionsToEvents(draft.actions),
    pendingPrompt: materializePendingPrompt(draft.pendingPromptDraft, currentPrompt, turn),
    touchedEntities: draft.touchedEntities,
    confidence: draft.confidence,
    warnings: draft.warnings,
    debug: draft.debug,
  };
}

export function convertMechanicsActionsToEvents(actions: MechanicsAction[]): WorldEvent[] {
  const events: WorldEvent[] = [];

  for (const action of actions) {
    switch (action.type) {
      case 'travel':
        events.push({
          type: 'TravelToLocation',
          actorId: action.actorId,
          locationId: action.locationId,
          pace: action.pace,
          confirmId: action.confirmId,
          note: action.note,
        });
        break;
      case 'move':
        if (!action.to && !action.toLocationId) break;
        events.push({
          type: 'MoveActor',
          actorId: action.actorId,
          to: action.to || { x: 0, y: 0, z: 0 },
          toLocationId: action.toLocationId,
          mode: action.mode,
          note: action.note,
        });
        break;
      case 'inspect':
        events.push({
          type: 'Inspect',
          actorId: action.actorId,
          subject: action.subject,
          note: action.note,
        });
        break;
      case 'explore':
        events.push({
          type: 'Explore',
          actorId: action.actorId,
          area: action.area,
          direction: action.direction,
          note: action.note,
        });
        break;
      case 'wait':
        events.push({
          type: 'AdvanceTime',
          minutes: action.minutes,
          note: action.note,
        });
        break;
      case 'affect_item':
        events.push({
          type: 'AffectItem',
          actorId: action.actorId,
          itemId: action.itemId,
          effect: action.effect,
          at: action.at,
          targetActorId: action.targetActorId,
          targetContainerId: action.targetContainerId,
          instrumentItemId: action.instrumentItemId,
          note: action.note,
        });
        break;
    }
  }

  return events;
}

function failedMechanicsOutput(
  request: MechanicsWorkerRequest,
  error: unknown,
  selectedModel?: string,
  fallbackModel?: string,
  usedFallback = false,
  responseId?: string,
): MechanicsResolutionDraft {
  return {
    status: 'worker_contract_failed',
    interpretation: 'none',
    summary: 'worker failed to produce a valid draft',
    actions: [],
    pendingPromptDraft: null,
    touchedEntities: [],
    confidence: 0,
    warnings: [`worker_contract_failed:${String(error)}`],
    debug: buildDebugRecord({
      request,
      selectedModel,
      fallbackModel,
      usedFallback,
      responseId,
      parsedStatus: 'worker_contract_failed',
      failureReason: String(error),
    }),
  };
}

function buildDebugRecord(params: {
  request: MechanicsWorkerRequest;
  selectedModel?: string;
  fallbackModel?: string;
  usedFallback: boolean;
  responseId?: string;
  rawArguments?: string;
  parsedStatus: MechanicsResolutionStatus;
  failureReason?: string;
}): MechanicsDebugRecord {
  return {
    request: params.request,
    selectedModel: params.selectedModel,
    fallbackModel: params.fallbackModel,
    usedFallback: params.usedFallback,
    responseId: params.responseId,
    rawArguments: params.rawArguments,
    parsedStatus: params.parsedStatus,
    failureReason: params.failureReason,
  };
}

function parseMechanicsOutput(argumentsJSON: string):
  | { ok: true; draft: Omit<MechanicsResolutionDraft, 'status' | 'debug'> }
  | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(argumentsJSON) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'output_not_object' };
    const record = parsed as Record<string, unknown>;
    if (!isInterpretation(record.interpretation)) return { ok: false, reason: 'invalid_interpretation' };
    if (typeof record.summary !== 'string') return { ok: false, reason: 'missing_summary' };
    if (!Array.isArray(record.actions)) return { ok: false, reason: 'missing_actions' };
    if (!Array.isArray(record.touchedEntities) || !record.touchedEntities.every(item => typeof item === 'string')) {
      return { ok: false, reason: 'invalid_touched_entities' };
    }
    if (typeof record.confidence !== 'number' || Number.isNaN(record.confidence)) {
      return { ok: false, reason: 'invalid_confidence' };
    }
    if (!Array.isArray(record.warnings) || !record.warnings.every(item => typeof item === 'string')) {
      return { ok: false, reason: 'invalid_warnings' };
    }

    const actions = parseActions(record.actions);
    if (!actions.ok) return { ok: false, reason: 'reason' in actions ? actions.reason : 'invalid_actions' };

    return {
      ok: true,
      draft: {
        interpretation: record.interpretation,
        summary: record.summary.trim() || 'mechanics draft',
        actions: actions.actions,
        pendingPromptDraft: parsePendingPromptDraft(record.pendingPrompt),
        touchedEntities: (record.touchedEntities as string[]).map(item => item.trim()).filter(Boolean),
        confidence: Math.max(0, Math.min(1, record.confidence)),
        warnings: record.warnings as string[],
      },
    };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

function parseActions(value: unknown): { ok: true; actions: MechanicsAction[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason: 'actions_not_array' };
  if (value.length > 2) return { ok: false, reason: 'too_many_actions' };
  const actions: MechanicsAction[] = [];

  for (const action of value) {
    const parsed = parseAction(action);
    if (!parsed.ok) return { ok: false, reason: 'reason' in parsed ? parsed.reason : 'invalid_action' };
    actions.push(parsed.action);
  }

  return { ok: true, actions };
}

function parseAction(value: unknown): { ok: true; action: MechanicsAction } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'action_not_object' };
  const record = value as Record<string, unknown>;

  switch (record.type) {
    case 'travel':
      if (typeof record.actorId !== 'string' || typeof record.locationId !== 'string') {
        return { ok: false, reason: 'invalid_travel_action' };
      }
      return {
        ok: true,
        action: {
          type: 'travel',
          actorId: record.actorId,
          locationId: record.locationId,
          pace: record.pace === 'walk' || record.pace === 'run' ? record.pace : undefined,
          confirmId: typeof record.confirmId === 'string' ? record.confirmId : undefined,
          note: typeof record.note === 'string' ? record.note : undefined,
        },
      };
    case 'move': {
      if (typeof record.actorId !== 'string') return { ok: false, reason: 'invalid_move_action' };
      const toLocationId = typeof record.toLocationId === 'string' ? record.toLocationId : undefined;
      const to = parseGridPos(record.to);
      if (!toLocationId && !to) return { ok: false, reason: 'move_requires_target' };
      return {
        ok: true,
        action: {
          type: 'move',
          actorId: record.actorId,
          toLocationId,
          to: to || undefined,
          mode: record.mode === 'walk' || record.mode === 'run' ? record.mode : undefined,
          note: typeof record.note === 'string' ? record.note : undefined,
        },
      };
    }
    case 'inspect':
      if (typeof record.actorId !== 'string' || typeof record.subject !== 'string' || !record.subject.trim()) {
        return { ok: false, reason: 'invalid_inspect_action' };
      }
      return {
        ok: true,
        action: {
          type: 'inspect',
          actorId: record.actorId,
          subject: record.subject.trim(),
          note: typeof record.note === 'string' ? record.note : undefined,
        },
      };
    case 'explore':
      if (
        typeof record.actorId !== 'string' ||
        typeof record.area !== 'string' || !record.area.trim()
      ) {
        return { ok: false, reason: 'invalid_explore_action' };
      }
      return {
        ok: true,
        action: {
          type: 'explore',
          actorId: record.actorId,
          area: record.area,
          direction: record.direction === 'east' || record.direction === 'west' || record.direction === 'north' || record.direction === 'south'
            ? record.direction
            : undefined,
          note: typeof record.note === 'string' ? record.note : undefined,
        },
      };
    case 'wait':
      if (typeof record.minutes !== 'number' || !Number.isFinite(record.minutes) || record.minutes <= 0) {
        return { ok: false, reason: 'invalid_wait_action' };
      }
      return {
        ok: true,
        action: {
          type: 'wait',
          minutes: record.minutes,
          note: typeof record.note === 'string' ? record.note : undefined,
        },
      };
    case 'affect_item': {
      if (typeof record.actorId !== 'string' || typeof record.itemId !== 'string' || !record.itemId.trim()) {
        return { ok: false, reason: 'invalid_affect_item_action' };
      }
      if (
        record.effect !== 'pick_up' &&
        record.effect !== 'drop' &&
        record.effect !== 'transfer' &&
        record.effect !== 'open' &&
        record.effect !== 'close' &&
        record.effect !== 'break' &&
        record.effect !== 'consume' &&
        record.effect !== 'empty' &&
        record.effect !== 'fill' &&
        record.effect !== 'ruin'
      ) {
        return { ok: false, reason: 'invalid_affect_item_effect' };
      }
      const at = parseGridPos(record.at);
      return {
        ok: true,
        action: {
          type: 'affect_item',
          actorId: record.actorId,
          itemId: record.itemId.trim(),
          effect: record.effect,
          targetActorId: typeof record.targetActorId === 'string' ? record.targetActorId : undefined,
          targetContainerId: typeof record.targetContainerId === 'string' ? record.targetContainerId : undefined,
          instrumentItemId: typeof record.instrumentItemId === 'string' ? record.instrumentItemId : undefined,
          at: at || undefined,
          note: typeof record.note === 'string' ? record.note : undefined,
        },
      };
    }
    default:
      return { ok: false, reason: 'unknown_action_type' };
  }
}

function parsePendingPromptDraft(value: unknown): MechanicsPendingPromptDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.kind !== 'confirm_travel' &&
    record.kind !== 'clarify_target' &&
    record.kind !== 'clarify_explore'
  ) {
    return null;
  }
  if (typeof record.question !== 'string' || !record.question.trim()) return null;
  const options = Array.isArray(record.options)
    ? record.options
        .filter(option => option && typeof option === 'object')
        .map(option => {
          const entry = option as Record<string, unknown>;
          return {
            key: typeof entry.key === 'string' ? entry.key : '',
            label: typeof entry.label === 'string' ? entry.label : '',
          };
        })
        .filter(option => option.key && option.label)
    : undefined;
  return {
    kind: record.kind,
    question: record.question.trim(),
    options,
    data: normalizePendingPromptData(record.data),
  };
}

function normalizePendingPromptData(value: unknown): PendingPrompt['data'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const data: NonNullable<PendingPrompt['data']> = {};
  if (typeof record.locationId === 'string') data.locationId = record.locationId;
  if (typeof record.estimatedMinutes === 'number' && Number.isFinite(record.estimatedMinutes)) {
    data.estimatedMinutes = record.estimatedMinutes;
  }
  if (typeof record.subject === 'string') data.subject = record.subject;
  if (typeof record.area === 'string' && record.area.trim()) {
    data.area = record.area.trim();
  }
  if (record.direction === 'east' || record.direction === 'west' || record.direction === 'north' || record.direction === 'south') {
    data.direction = record.direction;
  }
  return Object.keys(data).length ? data : undefined;
}

function materializePendingPrompt(
  draft: MechanicsPendingPromptDraft | null,
  currentPrompt: PendingPrompt | null,
  turn: number,
): PendingPrompt | null {
  if (!draft) return null;
  return {
    id: currentPrompt?.id || `mechanics-${turn}-${draft.kind}`,
    kind: draft.kind,
    question: draft.question,
    options: draft.options,
    data: draft.data,
    createdTurn: turn,
  };
}

function parseGridPos(value: unknown): { x: number; y: number; z?: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.x !== 'number' || typeof record.y !== 'number') return null;
  if (record.z != null && typeof record.z !== 'number') return null;
  return {
    x: record.x,
    y: record.y,
    ...(typeof record.z === 'number' ? { z: record.z } : {}),
  };
}

function isInterpretation(value: unknown): value is MechanicsInterpretation {
  return value === 'move' ||
    value === 'travel' ||
    value === 'inspect' ||
    value === 'explore' ||
    value === 'wait' ||
    value === 'affect_item' ||
    value === 'clarify' ||
    value === 'none';
}
