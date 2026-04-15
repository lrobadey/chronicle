import type { LLMClient, ResponseOutputItem } from '../llm/types';
import { MECHANICS_MODEL, MECHANICS_FALLBACK_MODEL } from '../llm/defaults';
import { classifyLLMError } from '../llm/errorUtils';
import { SCHEDULE_SYSTEM_PROMPT } from './prompts';
import { strictObjectSchema } from '../sharedSchemas';
import type {
  ScheduleResolution,
  ScheduleResolutionEvent,
  ScheduleResolutionStatus,
  ScheduleTaskInput,
} from './types';

const SCHEDULE_OUTPUT_TOOL_NAME = 'emit_schedule_resolution';

const SCHEDULE_OUTPUT_TOOL = {
  type: 'function' as const,
  name: SCHEDULE_OUTPUT_TOOL_NAME,
  description: 'Return the schedule resolution for the GM to review.',
  strict: true,
  parameters: strictObjectSchema({
    status: { type: 'string', enum: ['resolved', 'cannot_resolve', 'needs_clarification'] },
    rationale: { type: 'string' },
    confidence: { type: 'number' },
    events: { type: 'array', items: { type: 'object' } },
    clarificationNeeded: { type: ['string', 'null'] },
  }),
};

export interface ScheduleAgentParams {
  apiKey?: string;
  model?: string;
  fallbackModel?: string;
  input: ScheduleTaskInput;
  llm: LLMClient;
}

export async function runScheduleAgent(params: ScheduleAgentParams): Promise<ScheduleResolution> {
  const {
    apiKey,
    model = MECHANICS_MODEL,
    fallbackModel = MECHANICS_FALLBACK_MODEL,
    input,
    llm,
  } = params;

  const resolutionId = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (!apiKey) {
    return failedResolution(resolutionId, 'missing_api_key');
  }

  const requestBody = buildRequestBody(input);
  const selectedModels = [model, fallbackModel].filter(
    (v, i, self): v is string => Boolean(v) && self.indexOf(v) === i,
  );

  for (let index = 0; index < selectedModels.length; index++) {
    const selectedModel = selectedModels[index]!;
    let response;

    try {
      response = await llm.responsesCreate({
        apiKey,
        model: selectedModel,
        reasoning: { effort: 'medium' },
        instructions: SCHEDULE_SYSTEM_PROMPT,
        input: JSON.stringify(requestBody),
        tools: [SCHEDULE_OUTPUT_TOOL],
        tool_choice: { type: 'function', name: SCHEDULE_OUTPUT_TOOL_NAME },
        truncation: 'auto',
        store: true,
      });
    } catch (error) {
      if (index === 0 && selectedModels.length > 1) continue;
      return failedResolution(resolutionId, String(classifyLLMError(error)));
    }

    const functionCalls = response.output.filter(isFunctionCallItem);
    const resultCall = functionCalls.find(call => call.name === SCHEDULE_OUTPUT_TOOL_NAME);

    if (!resultCall) {
      if (index === 0 && selectedModels.length > 1) continue;
      return failedResolution(
        resolutionId,
        String(response.error ?? response.incomplete_details ?? 'missing_function_output'),
      );
    }

    const parsed = parseScheduleOutput(resultCall.arguments, resolutionId);
    if (parsed.ok) return parsed.resolution;

    if (index === 0 && selectedModels.length > 1) continue;
    return failedResolution(resolutionId, parsed.ok === false ? parsed.reason : 'parse_failed');
  }

  return failedResolution(resolutionId, 'no_models_succeeded');
}

function buildRequestBody(input: ScheduleTaskInput): Record<string, unknown> {
  return {
    task: input.task,
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.actorName ? { actorName: input.actorName } : {}),
    currentElapsedMinutes: input.currentElapsedMinutes,
    worldTimeContext: input.worldTimeContext,
    ...(input.existingSchedule?.length ? { existingSchedule: input.existingSchedule } : {}),
    ...(input.pendingProcessesForActor?.length
      ? { pendingProcessesForActor: input.pendingProcessesForActor }
      : {}),
    ...(input.revisionFeedback ? { revisionFeedback: input.revisionFeedback } : {}),
    ...(input.previousDraft ? { previousDraft: input.previousDraft } : {}),
  };
}

function parseScheduleOutput(
  argumentsJSON: string,
  resolutionId: string,
): { ok: true; resolution: ScheduleResolution } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(argumentsJSON) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'output_not_object' };
    }
    const record = parsed as Record<string, unknown>;

    if (!isResolutionStatus(record.status)) return { ok: false, reason: 'invalid_status' };
    if (typeof record.rationale !== 'string') return { ok: false, reason: 'missing_rationale' };
    if (typeof record.confidence !== 'number' || Number.isNaN(record.confidence)) {
      return { ok: false, reason: 'invalid_confidence' };
    }
    if (!Array.isArray(record.events)) return { ok: false, reason: 'missing_events' };

    const events = parseResolutionEvents(record.events);

    return {
      ok: true,
      resolution: {
        id: resolutionId,
        status: record.status,
        rationale: record.rationale.trim() || 'no rationale provided',
        confidence: Math.max(0, Math.min(1, record.confidence)),
        events,
        clarificationNeeded:
          typeof record.clarificationNeeded === 'string' ? record.clarificationNeeded : undefined,
      },
    };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

function parseResolutionEvents(value: unknown[]): ScheduleResolutionEvent[] {
  const events: ScheduleResolutionEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;

    if (record.type === 'ScheduleProcess') {
      const proc = record.process;
      if (!proc || typeof proc !== 'object' || Array.isArray(proc)) continue;
      const p = proc as Record<string, unknown>;
      if (typeof p.id !== 'string' || typeof p.label !== 'string' || typeof p.dueAtMinutes !== 'number') continue;
      if (!p.payload || typeof p.payload !== 'object') continue;
      events.push({
        type: 'ScheduleProcess',
        process: {
          id: p.id,
          label: p.label,
          dueAtMinutes: p.dueAtMinutes,
          cadenceMinutes: typeof p.cadenceMinutes === 'number' ? p.cadenceMinutes : undefined,
          payload: p.payload as { type: string; [key: string]: unknown },
        },
        note: typeof record.note === 'string' ? record.note : undefined,
      });
    } else if (record.type === 'SetNpcSchedule') {
      if (typeof record.actorId !== 'string') continue;
      if (!Array.isArray(record.entries)) continue;
      const entries = parseScheduleEntries(record.entries);
      events.push({
        type: 'SetNpcSchedule',
        actorId: record.actorId,
        entries,
        note: typeof record.note === 'string' ? record.note : undefined,
      });
    }
  }
  return events;
}

function parseScheduleEntries(
  value: unknown[],
): Array<{ id: string; label: string; atHour: number; payload: { type: string; [key: string]: unknown } }> {
  const entries = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      typeof record.label !== 'string' ||
      typeof record.atHour !== 'number' ||
      !record.payload ||
      typeof record.payload !== 'object'
    ) {
      continue;
    }
    entries.push({
      id: record.id,
      label: record.label,
      atHour: Math.max(0, Math.min(23, Math.round(record.atHour))),
      payload: record.payload as { type: string; [key: string]: unknown },
    });
  }
  return entries;
}

function isResolutionStatus(value: unknown): value is ScheduleResolutionStatus {
  return value === 'resolved' || value === 'cannot_resolve' || value === 'needs_clarification';
}

function failedResolution(id: string, reason: string): ScheduleResolution {
  return {
    id,
    status: 'cannot_resolve',
    rationale: `agent_failed: ${reason}`,
    confidence: 0,
    events: [],
  };
}

function isFunctionCallItem(item: ResponseOutputItem): item is {
  type: 'function_call';
  name: string;
  arguments: string;
} {
  return item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string';
}
