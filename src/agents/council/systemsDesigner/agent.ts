import { randomUUID } from 'node:crypto';
import { attachResolutionMetadata, runMechanicsAgent } from '../../mechanics';
import { runScheduleAgent } from '../../schedule';
import type { ScheduleResolution } from '../../schedule/types';
import type { LLMClient, ResponseInputItem } from '../../llm/types';
import { isFunctionCallItem, pushLLMTrace, pushToolTrace } from '../../llm/trace';
import { DEFAULT_MODEL } from '../../llm/defaults';
import type { CouncilResult, CouncilTask } from '../../hierarchy/types';
import { classifyPromptReply } from '../../hierarchy/promptReply';
import { SYSTEMS_DESIGNER_SYSTEM_PROMPT } from './prompts';
import { SYSTEMS_RESULT_TOOL_NAME, SYSTEMS_TOOL_DEFS } from './tools';
import type {
  SystemsCouncilToolRuntime,
  SystemsDesignerResultDetail,
  SystemsDesignerTaskContext,
} from './types';
import type { WorldEvent } from '../../../sim/events';

export interface SystemsDesignerAgentParams {
  apiKey?: string;
  llm: LLMClient;
  turnNumber: number;
  model?: string;
  trace?: { toolCalls?: Array<{ tool: string; input: unknown; output: unknown }>; llmCalls?: any[] };
}

export async function runSystemsDesignerTask(
  task: CouncilTask<'systems'>,
  params: SystemsDesignerAgentParams,
): Promise<CouncilResult<'systems'>> {
  const context = task.context as SystemsDesignerTaskContext;
  const runtime = createSystemsRuntime(context, params);
  return runSystemsDesignerLoop(task, context, runtime, params);
}

async function runSystemsDesignerLoop(
  task: CouncilTask<'systems'>,
  context: SystemsDesignerTaskContext,
  runtime: SystemsCouncilToolRuntime,
  params: SystemsDesignerAgentParams,
): Promise<CouncilResult<'systems'>> {
  const pendingPromptReply = resolvePendingPromptReply(
    context.pendingPrompt,
    context.playerText,
    context.telemetry.player.id,
  );
  if (pendingPromptReply) {
    return {
      taskId: task.taskId,
      domain: 'systems',
      summary: pendingPromptReply.summary,
      proposedEvents: pendingPromptReply.events,
      detail: {
        handled: true,
        narratorPacket: pendingPromptReply.events.length
          ? {
              version: 'systems_v1',
              intent: context.intent,
              playerText: context.playerText,
              summary: pendingPromptReply.summary,
              warnings: [],
            }
          : null,
        mechanicsResolution: null,
        scheduleResolution: null,
        pendingPromptRecommendation: pendingPromptReply.clearPrompt ? null : context.pendingPrompt,
        artifacts: [{ type: 'mechanics', summary: pendingPromptReply.summary, candidateEvents: pendingPromptReply.events }],
      } satisfies SystemsDesignerResultDetail,
      confidence: 1,
      warnings: [],
    };
  }

  if (context.intent === 'observation') {
    return materializeSystemsResult(task.taskId, {
      summary: 'Observed the local state without mutating the world.',
      candidateEvents: [],
      narratorPacket: {
        version: 'systems_v1',
        intent: context.intent,
        playerText: context.playerText,
        summary: 'Read-only observation of the player surroundings.',
        warnings: [],
      },
      handled: true,
      artifacts: [{ type: 'inspection', summary: 'Observation packet prepared.', candidateEvents: [] }],
    });
  }

  if (context.executionMode === 'direct_mechanics' && context.mechanicsRequest) {
    const draft = await runMechanicsAgent({
      apiKey: params.apiKey,
      request: context.mechanicsRequest,
      llm: params.llm,
      trace: params.trace,
    });
    const resolution = attachResolutionMetadata(
      draft,
      `systems-${params.turnNumber}-${task.taskId}`,
      context.mechanicsRequest.pendingPrompt,
      params.turnNumber,
    );
    const handled = resolution.status === 'ok';
    return {
      taskId: task.taskId,
      domain: 'systems',
      summary: handled ? resolution.summary : 'Systems could not safely resolve the turn.',
      proposedEvents: handled ? resolution.candidateEvents : [],
      detail: {
        handled,
        fallbackReason: handled ? undefined : `systems_mechanics_${resolution.status}`,
        narratorPacket: handled
          ? {
              version: 'systems_v1',
              intent: context.intent,
              playerText: context.playerText,
              summary: resolution.summary,
              warnings: resolution.warnings,
            }
          : null,
        mechanicsResolution: resolution,
        scheduleResolution: null,
        pendingPromptRecommendation: resolution.pendingPrompt,
        artifacts: [{ type: 'mechanics', summary: resolution.summary, candidateEvents: resolution.candidateEvents }],
      } satisfies SystemsDesignerResultDetail,
      confidence: resolution.confidence,
      warnings: resolution.warnings,
    };
  }

  if (!params.apiKey) {
    return emptySystemsResult(task.taskId, 'Systems Designer had no safe deterministic path.');
  }

  let previousResponseId: string | undefined;
  let pendingInput: ResponseInputItem[] = [
    { role: 'system', content: JSON.stringify(task) },
    { role: 'user', content: context.playerText },
  ];
  for (let index = 0; index < 4; index += 1) {
    const response = await params.llm.responsesCreate({
      apiKey: params.apiKey,
      model: params.model || DEFAULT_MODEL,
      reasoning: { effort: 'low' },
      instructions: SYSTEMS_DESIGNER_SYSTEM_PROMPT,
      input: pendingInput,
      previous_response_id: previousResponseId,
      tools: SYSTEMS_TOOL_DEFS,
      truncation: 'auto',
      store: true,
    });
    const toolCalls = response.output.filter(isFunctionCallItem);
    pushLLMTrace(params.trace, {
      agent: 'systems_designer',
      responseId: response.id,
      previousResponseId,
      inputItems: pendingInput.length,
      outputItems: response.output.length,
      toolCalls: toolCalls.length,
      usage: response.usage,
      status: response.status,
      error: response.error ?? response.incomplete_details,
    });
    previousResponseId = response.id || previousResponseId;
    if (!toolCalls.length) {
      return emptySystemsResult(task.taskId, response.output_text || 'Systems Designer ended without a result.');
    }
    const nextInput: ResponseInputItem[] = [];
    for (const call of toolCalls) {
      const parsed = parseObjectArgs(call.arguments);
      const callId = call.call_id || `systems-call-${index}`;
      const callStartedAt = Date.now();
      let output: unknown;
      if (!parsed.ok) {
        output = { ok: false, error: 'arguments_parse_failed' };
      } else if (call.name === SYSTEMS_RESULT_TOOL_NAME) {
        return materializeSystemsResult(task.taskId, parsed.value as Parameters<SystemsCouncilToolRuntime['emit_systems_result']>[0]);
      } else {
        output = await dispatchSystemsTool(runtime, call.name, parsed.value);
      }
      pushToolTrace(params.trace, { tool: call.name, input: parsed.ok ? parsed.value : call.arguments, output }, callStartedAt);
      nextInput.push({
        type: 'function_call_output',
        call_id: callId,
        output: safeJSONStringify(output),
      });
    }
    pendingInput = nextInput;
  }
  return emptySystemsResult(task.taskId, 'Systems Designer reached the iteration limit.');
}

function createSystemsRuntime(
  context: SystemsDesignerTaskContext,
  params: SystemsDesignerAgentParams,
): SystemsCouncilToolRuntime {
  const mechanicsResolutions = new Map<string, { resolution: ReturnType<typeof attachResolutionMetadata>; request: NonNullable<SystemsDesignerTaskContext['mechanicsRequest']> }>();
  const scheduleResolutions = new Map<string, ScheduleResolution>();

  return {
    inspect_systems_scene: async (input) => ({
      ok: true,
      question: input.question || null,
      intent: context.intent,
      telemetry: context.telemetry,
      observation: context.observation,
      nearby: context.nearby,
      travelCandidates: context.travelCandidates,
      landmarks: context.landmarks,
    }),
    inspect_local_affordances: async (input) => ({
      ok: true,
      focus: input.focus || null,
      localAffordances: context.localAffordances,
    }),
    inspect_pending_prompt: async () => ({
      ok: true,
      pendingPrompt: context.pendingPrompt,
    }),
    resolve_mechanics: async (input) => {
      const request = {
        ...(context.mechanicsRequest || {
          playerText: context.playerText,
          objective: undefined,
          focus: undefined,
          pendingPrompt: context.pendingPrompt,
          telemetry: context.telemetry,
          travelCandidates: context.travelCandidates,
          nearby: context.nearby,
          landmarks: context.landmarks,
          observation: context.observation,
          localAffordances: context.localAffordances,
        }),
        playerText: input.playerText || context.playerText,
        objective: input.objective || undefined,
        focus: input.focus || undefined,
        pendingPrompt: input.pendingPrompt || context.pendingPrompt,
      };
      const draft = await runMechanicsAgent({
        apiKey: params.apiKey,
        request,
        llm: params.llm,
        trace: params.trace,
      });
      const resolutionId = createRuntimeId();
      const resolution = attachResolutionMetadata(draft, resolutionId, request.pendingPrompt, params.turnNumber);
      mechanicsResolutions.set(resolutionId, { request, resolution });
      const { debug: _debug, ...resolutionForModel } = resolution;
      return resolutionForModel;
    },
    review_mechanics_resolution: async (input) => {
      const cached = mechanicsResolutions.get(input.resolutionId);
      if (!cached) {
        return { ok: false, error: 'mechanics_resolution_not_found', resolutionId: input.resolutionId };
      }
      if (input.action === 'reject') {
        mechanicsResolutions.delete(input.resolutionId);
        return { ok: true, status: 'rejected', resolutionId: input.resolutionId };
      }
      if (input.action === 'approve') {
        return {
          ok: true,
          status: 'approved',
          resolutionId: input.resolutionId,
          summary: cached.resolution.summary,
          candidateEvents: cached.resolution.candidateEvents,
          pendingPrompt: cached.resolution.pendingPrompt,
          confidence: cached.resolution.confidence,
          warnings: cached.resolution.warnings,
        };
      }
      const feedback = typeof input.feedback === 'string' ? input.feedback.trim() : '';
      if (!feedback) {
        return { ok: false, error: 'revision_feedback_required', resolutionId: input.resolutionId };
      }
      const revised = await runMechanicsAgent({
        apiKey: params.apiKey,
        request: {
          ...cached.request,
          revisionFeedback: feedback,
          previousDraft: {
            interpretation: cached.resolution.interpretation,
            summary: cached.resolution.summary,
            candidateEvents: cached.resolution.candidateEvents,
            confidence: cached.resolution.confidence,
          },
        },
        llm: params.llm,
        trace: params.trace,
      });
      const nextId = createRuntimeId();
      const resolution = attachResolutionMetadata(revised, nextId, cached.request.pendingPrompt, params.turnNumber);
      mechanicsResolutions.delete(input.resolutionId);
      mechanicsResolutions.set(nextId, { request: cached.request, resolution });
      const { debug: _debug, ...resolutionForModel } = resolution;
      return { ok: true, status: 'revised', previousResolutionId: input.resolutionId, resolution: resolutionForModel };
    },
    schedule_task: async (input) => {
      const resolution = await runScheduleAgent({
        apiKey: params.apiKey,
        input: {
          task: input.task,
          actorId: input.actorId || undefined,
          actorName: undefined,
          timeHint: input.timeHint || undefined,
          currentElapsedMinutes: context.telemetry.time.elapsedMinutes,
          worldTimeContext: {
            clockDisplay: context.telemetry.time.absoluteIso || '',
            currentDayIndex: context.telemetry.time.currentDay,
            namedTimepoints: { dawn: 480, noon: 720, dusk: 1080, midnight: 0 },
          },
          existingSchedule: [],
        },
        llm: params.llm,
        trace: params.trace,
      });
      scheduleResolutions.set(resolution.id, resolution);
      return resolution;
    },
    review_schedule_resolution: async (input) => {
      const cached = scheduleResolutions.get(input.scheduleResolutionId);
      if (!cached) {
        return { ok: false, error: 'schedule_resolution_not_found', scheduleResolutionId: input.scheduleResolutionId };
      }
      if (input.action === 'reject') {
        scheduleResolutions.delete(input.scheduleResolutionId);
        return { ok: true, status: 'rejected', scheduleResolutionId: input.scheduleResolutionId };
      }
      if (input.action === 'approve') {
        return {
          ok: true,
          status: 'approved',
          scheduleResolutionId: input.scheduleResolutionId,
          events: cached.events,
          confidence: cached.confidence,
          rationale: cached.rationale,
        };
      }
      return {
        ok: false,
        error: 'schedule_revisions_not_supported_in_systems_designer',
        scheduleResolutionId: input.scheduleResolutionId,
      };
    },
    emit_systems_result: async (input) => ({ ok: true, ...input }),
  };
}

function resolvePendingPromptReply(
  pendingPrompt: SystemsDesignerTaskContext['pendingPrompt'],
  playerText: string,
  playerId: string,
): { summary: string; events: WorldEvent[]; clearPrompt: boolean } | null {
  if (!pendingPrompt || pendingPrompt.kind !== 'confirm_travel') return null;
  const reply = classifyPromptReply(playerText);
  if (!reply) return null;
  if (reply === 'no') {
    return {
      summary: 'Declined the pending travel choice.',
      events: [],
      clearPrompt: true,
    };
  }

  const locationId = typeof pendingPrompt.data?.locationId === 'string' ? pendingPrompt.data.locationId : null;
  if (!locationId) return null;
  return {
    summary: 'Confirmed the pending travel choice.',
    events: [{
      type: 'TravelToLocation',
      actorId: playerId,
      locationId,
      pace: 'walk',
      confirmId: pendingPrompt.id,
      note: `Travel confirmed to ${locationId}.`,
    }],
    clearPrompt: false,
  };
}

async function dispatchSystemsTool(
  runtime: SystemsCouncilToolRuntime,
  name: string,
  args: Record<string, unknown>,
) {
  switch (name) {
    case 'inspect_systems_scene':
      return runtime.inspect_systems_scene(args as Parameters<SystemsCouncilToolRuntime['inspect_systems_scene']>[0]);
    case 'inspect_local_affordances':
      return runtime.inspect_local_affordances(args as Parameters<SystemsCouncilToolRuntime['inspect_local_affordances']>[0]);
    case 'inspect_pending_prompt':
      return runtime.inspect_pending_prompt({} as Record<string, never>);
    case 'resolve_mechanics':
      return runtime.resolve_mechanics(args as Parameters<SystemsCouncilToolRuntime['resolve_mechanics']>[0]);
    case 'review_mechanics_resolution':
      return runtime.review_mechanics_resolution(args as Parameters<SystemsCouncilToolRuntime['review_mechanics_resolution']>[0]);
    case 'schedule_task':
      return runtime.schedule_task(args as Parameters<SystemsCouncilToolRuntime['schedule_task']>[0]);
    case 'review_schedule_resolution':
      return runtime.review_schedule_resolution(args as Parameters<SystemsCouncilToolRuntime['review_schedule_resolution']>[0]);
    default:
      return { ok: false, error: 'unknown_systems_tool', name };
  }
}

function materializeSystemsResult(
  taskId: string,
  input: Parameters<SystemsCouncilToolRuntime['emit_systems_result']>[0],
): CouncilResult<'systems'> {
  const detail: SystemsDesignerResultDetail = {
    handled: input.handled ?? true,
    fallbackReason: input.fallbackReason || undefined,
    narratorPacket: input.narratorPacket || null,
    mechanicsResolution: null,
    scheduleResolution: null,
    pendingPromptRecommendation: input.pendingPromptRecommendation || null,
    artifacts: input.artifacts || [],
  };
  return {
    taskId,
    domain: 'systems',
    summary: input.summary,
    proposedEvents: input.candidateEvents,
    detail,
    confidence: detail.handled ? 0.9 : 0.2,
    warnings: input.warnings || [],
  };
}

function emptySystemsResult(taskId: string, summary: string): CouncilResult<'systems'> {
  return {
    taskId,
    domain: 'systems',
    summary,
    proposedEvents: [],
    detail: {
      handled: false,
      fallbackReason: 'systems_unhandled',
      narratorPacket: null,
      mechanicsResolution: null,
      scheduleResolution: null,
      pendingPromptRecommendation: null,
      artifacts: [],
    } satisfies SystemsDesignerResultDetail,
    confidence: 0,
    warnings: ['systems_unhandled'],
  };
}

function createRuntimeId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // ignore
  }
  return randomUUID();
}

function parseObjectArgs(value: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'arguments_must_be_object' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'arguments_parse_failed' };
  }
}

function safeJSONStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'non_serializable_tool_output' });
  }
}
