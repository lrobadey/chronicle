import { randomUUID } from 'node:crypto';
import type { LLMClient, ResponseOutputItem, ResponseToolDefinition } from '../llm/types';
import { MECHANICS_MODEL } from '../llm/defaults';
import { classifyLLMError } from '../llm/errorUtils';
import { isFunctionCallItem, pushLLMTrace } from '../llm/trace';
import {
  NPC_SCHEDULE_ENTRY_SCHEMA,
  SCHEDULABLE_PAYLOAD_SCHEMA,
  strictObjectSchema,
} from '../sharedSchemas';
import { SCHEDULE_OUTPUT_SCHEMA_DESCRIPTION, SCHEDULE_SYSTEM_PROMPT } from './prompts';
import type {
  ScheduleResolution,
  ScheduleResolutionEvent,
  ScheduleResolutionStatus,
  ScheduleTaskInput,
} from './types';

const SCHEDULE_OUTPUT_TOOL_NAME = 'emit_schedule_resolution';

const SCHEDULE_RESOLUTION_EVENT_SCHEMA = {
  anyOf: [
    strictObjectSchema({
      type: { type: 'string', enum: ['ScheduleProcess'] },
      process: strictObjectSchema({
        id: { type: 'string' },
        label: { type: 'string' },
        dueAtMinutes: { type: 'number' },
        cadenceMinutes: { type: ['number', 'null'] },
        payload: SCHEDULABLE_PAYLOAD_SCHEMA,
      }),
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['SetNpcSchedule'] },
      actorId: { type: 'string' },
      entries: { type: 'array', items: NPC_SCHEDULE_ENTRY_SCHEMA },
      note: { type: ['string', 'null'] },
    }),
  ],
} as const;

const SCHEDULE_OUTPUT_TOOL: ResponseToolDefinition = {
  type: 'function',
  name: SCHEDULE_OUTPUT_TOOL_NAME,
  description: `Return a valid ScheduleResolution JSON object. Schema: ${SCHEDULE_OUTPUT_SCHEMA_DESCRIPTION}`,
  strict: true,
  parameters: strictObjectSchema({
    id: { type: 'string' },
    status: { type: 'string', enum: ['resolved', 'cannot_resolve', 'needs_clarification'] },
    rationale: { type: 'string' },
    confidence: { type: 'number' },
    events: { type: 'array', items: SCHEDULE_RESOLUTION_EVENT_SCHEMA },
    clarificationNeeded: { type: ['string', 'null'] },
  }),
};

export interface ScheduleAgentParams {
  apiKey?: string;
  model?: string;
  input: ScheduleTaskInput;
  llm: LLMClient;
  trace?: {
    llmCalls?: Array<{
      agent:
        | 'gm'
        | 'steward'
        | 'legacy_gm'
        | 'observer'
        | 'npc'
        | 'narrator'
        | 'specialist'
        | 'mechanics'
        | 'schedule'
        | 'staff_interview'
        | 'character_designer'
        | 'world_designer'
        | 'systems_designer'
        | 'character_worker'
        | 'world_worker';
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

export async function runScheduleAgent(params: ScheduleAgentParams): Promise<ScheduleResolution> {
  const { apiKey, model = MECHANICS_MODEL, input, llm, trace } = params;

  if (!apiKey) {
    return fallbackResolution('cannot_resolve', 'missing_api_key');
  }

  let response;
  try {
    response = await llm.responsesCreate({
      apiKey,
      model,
      reasoning: { effort: 'medium' },
      instructions: SCHEDULE_SYSTEM_PROMPT,
      input: JSON.stringify(input),
      tools: [SCHEDULE_OUTPUT_TOOL],
      tool_choice: { type: 'function', name: SCHEDULE_OUTPUT_TOOL_NAME },
      truncation: 'auto',
      store: true,
    });
  } catch (error) {
    const failure = String(classifyLLMError(error));
    pushLLMTrace(trace, {
      agent: 'schedule',
      inputItems: 1,
      status: 'failed',
      error: failure,
    });
    return fallbackResolution('cannot_resolve', failure);
  }

  const functionCalls = response.output.filter(isFunctionCallItem);
  const resultCall = functionCalls.find(call => call.name === SCHEDULE_OUTPUT_TOOL_NAME);
  pushLLMTrace(trace, {
    agent: 'schedule',
    responseId: response.id,
    inputItems: 1,
    outputItems: response.output.length,
    toolCalls: functionCalls.length,
    usage: response.usage,
    status: response.status,
    error: response.error ?? response.incomplete_details,
  });

  if (!resultCall) {
    return fallbackResolution('cannot_resolve', String(response.error ?? response.incomplete_details ?? 'missing_function_output'));
  }

  const parsed = parseScheduleOutput(resultCall.arguments);
  if (!parsed.ok) {
    return fallbackResolution('cannot_resolve', 'reason' in parsed ? parsed.reason : 'invalid_output');
  }

  return parsed.resolution;
}

function fallbackResolution(status: Extract<ScheduleResolutionStatus, 'cannot_resolve'>, rationale: string): ScheduleResolution {
  return {
    id: createResolutionId(),
    status,
    rationale,
    confidence: 0,
    events: [],
  };
}

function parseScheduleOutput(argumentsJSON: string):
  | { ok: true; resolution: ScheduleResolution }
  | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(argumentsJSON) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'output_not_object' };
    const record = parsed as Record<string, unknown>;
    if (!isResolutionStatus(record.status)) return { ok: false, reason: 'invalid_status' };
    if (typeof record.rationale !== 'string' || !record.rationale.trim()) return { ok: false, reason: 'missing_rationale' };
    if (typeof record.confidence !== 'number' || Number.isNaN(record.confidence)) return { ok: false, reason: 'invalid_confidence' };
    if (!Array.isArray(record.events)) return { ok: false, reason: 'events_not_array' };

    const events = parseResolutionEvents(record.events);
    if (!events.ok) return { ok: false, reason: 'reason' in events ? events.reason : 'invalid_events' };

    const clarificationNeeded = typeof record.clarificationNeeded === 'string' && record.clarificationNeeded.trim()
      ? record.clarificationNeeded.trim()
      : undefined;

    return {
      ok: true,
      resolution: {
        id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : createResolutionId(),
        status: record.status,
        rationale: record.rationale.trim(),
        confidence: Math.max(0, Math.min(1, record.confidence)),
        events: events.events,
        clarificationNeeded,
      },
    };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

function parseResolutionEvents(value: unknown):
  | { ok: true; events: ScheduleResolutionEvent[] }
  | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason: 'events_not_array' };
  const events: ScheduleResolutionEvent[] = [];

  for (const entry of value) {
    const parsed = parseResolutionEvent(entry);
    if (!parsed.ok) return { ok: false, reason: 'reason' in parsed ? parsed.reason : 'invalid_event' };
    events.push(parsed.event);
  }

  return { ok: true, events };
}

function parseResolutionEvent(value: unknown):
  | { ok: true; event: ScheduleResolutionEvent }
  | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'event_not_object' };
  const record = value as Record<string, unknown>;

  if (record.type === 'ScheduleProcess') {
    const process = record.process;
    if (!process || typeof process !== 'object' || Array.isArray(process)) {
      return { ok: false, reason: 'invalid_schedule_process' };
    }
    const processRecord = process as Record<string, unknown>;
    if (
      typeof processRecord.id !== 'string' ||
      typeof processRecord.label !== 'string' ||
      typeof processRecord.dueAtMinutes !== 'number' ||
      !isSchedulablePayload(processRecord.payload)
    ) {
      return { ok: false, reason: 'invalid_schedule_process' };
    }
    return {
      ok: true,
      event: {
        type: 'ScheduleProcess',
        process: {
          id: processRecord.id,
          label: processRecord.label,
          dueAtMinutes: processRecord.dueAtMinutes,
          cadenceMinutes: typeof processRecord.cadenceMinutes === 'number' ? processRecord.cadenceMinutes : undefined,
          payload: processRecord.payload,
        },
        note: typeof record.note === 'string' ? record.note : undefined,
      },
    };
  }

  if (record.type === 'SetNpcSchedule') {
    if (typeof record.actorId !== 'string' || !Array.isArray(record.entries)) {
      return { ok: false, reason: 'invalid_set_npc_schedule' };
    }
    const entries: Array<{ id: string; label: string; atHour: number; payload: { type: string; [key: string]: unknown } }> = [];
    for (const entry of record.entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, reason: 'invalid_set_npc_schedule_entry' };
      }
      const entryRecord = entry as Record<string, unknown>;
      const atHour = entryRecord.atHour;
      if (
        typeof entryRecord.id !== 'string' ||
        typeof entryRecord.label !== 'string' ||
        typeof atHour !== 'number' ||
        !Number.isInteger(atHour) ||
        atHour < 0 ||
        atHour > 23 ||
        !isSchedulablePayload(entryRecord.payload)
      ) {
        return { ok: false, reason: 'invalid_set_npc_schedule_entry' };
      }
      entries.push({
        id: entryRecord.id,
        label: entryRecord.label,
        atHour,
        payload: entryRecord.payload,
      });
    }
    return {
      ok: true,
      event: {
        type: 'SetNpcSchedule',
        actorId: record.actorId,
        entries,
        note: typeof record.note === 'string' ? record.note : undefined,
      },
    };
  }

  return { ok: false, reason: 'unknown_schedule_event_type' };
}

function isResolutionStatus(value: unknown): value is ScheduleResolutionStatus {
  return value === 'resolved' || value === 'cannot_resolve' || value === 'needs_clarification';
}

function isSchedulablePayload(value: unknown): value is { type: string; [key: string]: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === 'string' && record.type !== 'AdvanceTime' && record.type !== 'ScheduleProcess' && record.type !== 'SetNpcSchedule';
}


function createResolutionId(): string {
  try {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through.
  }
  return randomUUID();
}
