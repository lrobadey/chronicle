import { DEFAULT_MODEL, MECHANICS_MODEL } from '../../llm/defaults';
import type { LLMClient, ResponseInputItem } from '../../llm/types';
import { isFunctionCallItem, pushLLMTrace, pushToolTrace } from '../../llm/trace';
import type { CouncilResult, CouncilTask } from '../../hierarchy/types';
import { EVENT_ITEM_SCHEMA } from '../../sharedSchemas';
import type { WorldEvent } from '../../../sim/events';
import { WORLD_DESIGNER_SYSTEM_PROMPT } from './prompts';
import { WORLD_RESULT_TOOL_NAME, WORLD_TOOL_DEFS } from './tools';
import type {
  WorldCouncilToolRuntime,
  WorldDesignerResultDetail,
  WorldDesignerTaskContext,
  WorldDraftResult,
} from './types';

export interface WorldDesignerAgentParams {
  apiKey?: string;
  llm: LLMClient;
  turnNumber: number;
  model?: string;
  workerModel?: string;
  trace?: { toolCalls?: Array<{ tool: string; input: unknown; output: unknown }>; llmCalls?: any[] };
}

export async function runWorldDesignerTask(
  task: CouncilTask<'world'>,
  params: WorldDesignerAgentParams,
): Promise<CouncilResult<'world'>> {
  const context = task.context as WorldDesignerTaskContext;
  const runtime = createWorldRuntime(context, params);
  return runWorldDesignerLoop(task, context, runtime, params);
}

async function runWorldDesignerLoop(
  task: CouncilTask<'world'>,
  context: WorldDesignerTaskContext,
  runtime: WorldCouncilToolRuntime,
  params: WorldDesignerAgentParams,
): Promise<CouncilResult<'world'>> {
  if (!params.apiKey) {
    const scene = await runtime.worker_draft_scene_motion({});
    const world = await runtime.worker_draft_world_motion({});
    const combined = await runtime.worker_draft_world_events({
      sceneSummary: scene.summary,
      worldSummary: world.summary,
      sceneCandidateEvents: scene.candidateEvents,
      worldCandidateEvents: world.candidateEvents,
    });
    return materializeWorldResult(task.taskId, {
      summary: scene.summary || world.summary || 'World Designer produced no motion.',
      candidateEvents: combined.candidateEvents,
      sceneMotionNotes: scene.summary ? [scene.summary] : [],
      worldMotionNotes: world.summary ? [world.summary] : [],
      surfacedThreadIds: context.activeThreads.slice(0, 3).map(thread => thread.id),
      surfacedPendingEventIds: context.pendingWorldEvents.slice(0, 3).map(event => event.id),
      artifacts: [
        { type: 'scene_motion', summary: scene.summary, candidateEvents: scene.candidateEvents },
        { type: 'world_motion', summary: world.summary, candidateEvents: world.candidateEvents },
      ],
      warnings: [],
    });
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
      instructions: WORLD_DESIGNER_SYSTEM_PROMPT,
      input: pendingInput,
      previous_response_id: previousResponseId,
      tools: WORLD_TOOL_DEFS,
      truncation: 'auto',
      store: true,
    });
    const toolCalls = response.output.filter(isFunctionCallItem);
    pushLLMTrace(params.trace, {
      agent: 'world_designer',
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
      return emptyWorldResult(task.taskId, response.output_text || 'World Designer ended without a result.');
    }
    const nextInput: ResponseInputItem[] = [];
    for (const call of toolCalls) {
      const parsed = parseObjectArgs(call.arguments);
      const callId = call.call_id || `world-call-${index}`;
      const callStartedAt = Date.now();
      let output: unknown;
      if (!parsed.ok) {
        output = { ok: false, error: 'arguments_parse_failed' };
      } else if (call.name === WORLD_RESULT_TOOL_NAME) {
        return materializeWorldResult(task.taskId, parsed.value as Parameters<WorldCouncilToolRuntime['emit_world_result']>[0]);
      } else {
        output = await dispatchWorldTool(runtime, call.name, parsed.value);
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
  return emptyWorldResult(task.taskId, 'World Designer reached the iteration limit.');
}

function createWorldRuntime(
  context: WorldDesignerTaskContext,
  params: WorldDesignerAgentParams,
): WorldCouncilToolRuntime {
  return {
    inspect_world_scene: async (input) => ({
      ok: true,
      question: input.question || null,
      playerText: context.playerText,
      sceneAgenda: context.sceneAgenda,
      recentTurns: context.recentTurns,
    }),
    inspect_world_pressure: async (input) => ({
      ok: true,
      includeThreads: input.includeThreads === true,
      sceneAgenda: context.sceneAgenda,
      worldAgenda: context.worldAgenda,
      activeThreads: input.includeThreads === true ? context.activeThreads : [],
      pendingWorldEvents: context.pendingWorldEvents,
    }),
    inspect_world_threads: async (input) => ({
      ok: true,
      activeThreads: typeof input.limit === 'number' && input.limit > 0
        ? context.activeThreads.slice(0, Math.floor(input.limit))
        : context.activeThreads,
    }),
    inspect_held_beats: async (input) => ({
      ok: true,
      heldBeats: typeof input.limit === 'number' && input.limit > 0
        ? context.heldBeats.slice(0, Math.floor(input.limit))
        : context.heldBeats,
    }),
    inspect_pending_world_events: async (input) => ({
      ok: true,
      pendingWorldEvents: typeof input.pressureFloor === 'number'
        ? context.pendingWorldEvents.filter(event => (event.pressure || 0) >= input.pressureFloor!)
        : context.pendingWorldEvents,
    }),
    worker_draft_scene_motion: async () => draftWorldWorker({
      apiKey: params.apiKey,
      llm: params.llm,
      model: params.workerModel || MECHANICS_MODEL,
      agent: 'world_worker',
      system: `You are a small Chronicle world worker focused on immediate scene framing. Return one concise summary and optional candidate events.`,
      input: {
        playerText: context.playerText,
        sceneAgenda: context.sceneAgenda,
        recentTurns: context.recentTurns,
        worldSnapshot: context.worldSnapshot,
      },
      fallbackSummary: context.sceneAgenda.currentFocus
        ? `Keep the next beat grounded in ${context.sceneAgenda.currentFocus}.`
        : 'Keep the next beat grounded in the current scene.',
      trace: params.trace,
    }),
    worker_draft_world_motion: async () => draftWorldWorker({
      apiKey: params.apiKey,
      llm: params.llm,
      model: params.workerModel || MECHANICS_MODEL,
      agent: 'world_worker',
      system: `You are a small Chronicle world worker focused on wider world pressure. Return one concise summary and optional candidate events.`,
      input: {
        playerText: context.playerText,
        worldAgenda: context.worldAgenda,
        activeThreads: context.activeThreads,
        pendingWorldEvents: context.pendingWorldEvents,
      },
      fallbackSummary: context.activeThreads.length
        ? `Surface pressure from ${context.activeThreads[0]!.name}.`
        : 'Maintain wider world coherence without forcing escalation.',
      trace: params.trace,
    }),
    worker_draft_world_events: async (input) => ({
      candidateEvents: [
        ...(input.sceneCandidateEvents || []),
        ...(input.worldCandidateEvents || []),
      ],
    }),
    emit_world_result: async (input) => ({ ok: true, ...input }),
  };
}

async function dispatchWorldTool(
  runtime: WorldCouncilToolRuntime,
  name: string,
  args: Record<string, unknown>,
) {
  switch (name) {
    case 'inspect_world_scene':
      return runtime.inspect_world_scene(args as Parameters<WorldCouncilToolRuntime['inspect_world_scene']>[0]);
    case 'inspect_world_pressure':
      return runtime.inspect_world_pressure(args as Parameters<WorldCouncilToolRuntime['inspect_world_pressure']>[0]);
    case 'inspect_world_threads':
      return runtime.inspect_world_threads(args as Parameters<WorldCouncilToolRuntime['inspect_world_threads']>[0]);
    case 'inspect_held_beats':
      return runtime.inspect_held_beats(args as Parameters<WorldCouncilToolRuntime['inspect_held_beats']>[0]);
    case 'inspect_pending_world_events':
      return runtime.inspect_pending_world_events(args as Parameters<WorldCouncilToolRuntime['inspect_pending_world_events']>[0]);
    case 'worker_draft_scene_motion':
      return runtime.worker_draft_scene_motion(args as Parameters<WorldCouncilToolRuntime['worker_draft_scene_motion']>[0]);
    case 'worker_draft_world_motion':
      return runtime.worker_draft_world_motion(args as Parameters<WorldCouncilToolRuntime['worker_draft_world_motion']>[0]);
    case 'worker_draft_world_events':
      return runtime.worker_draft_world_events(args as Parameters<WorldCouncilToolRuntime['worker_draft_world_events']>[0]);
    default:
      return { ok: false, error: 'unknown_world_tool', name };
  }
}

async function draftWorldWorker(params: {
  apiKey?: string;
  llm: LLMClient;
  model: string;
  agent: 'world_worker';
  system: string;
  input: unknown;
  fallbackSummary: string;
  trace?: { llmCalls?: any[] };
}): Promise<WorldDraftResult> {
  if (!params.apiKey) return { summary: params.fallbackSummary, candidateEvents: [] };
  const response = await params.llm.responsesCreate({
    apiKey: params.apiKey,
    model: params.model,
    reasoning: { effort: 'medium' },
    instructions: params.system,
    input: JSON.stringify(params.input),
    tools: [{
      type: 'function',
      name: 'emit_world_worker_result',
      description: 'Return the world worker draft output.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          candidateEvents: { type: 'array', items: EVENT_ITEM_SCHEMA },
        },
        required: ['summary', 'candidateEvents'],
        additionalProperties: false,
      },
      strict: true,
    }],
    tool_choice: { type: 'function', name: 'emit_world_worker_result' },
    truncation: 'auto',
    store: true,
  });
  pushLLMTrace(params.trace, {
    agent: params.agent,
    responseId: response.id,
    inputItems: 1,
    outputItems: response.output.length,
    toolCalls: response.output.filter(isFunctionCallItem).length,
    usage: response.usage,
    status: response.status,
    error: response.error ?? response.incomplete_details,
  });
  const toolCall = response.output.filter(isFunctionCallItem).find(call => call.name === 'emit_world_worker_result');
  const parsed = toolCall ? parseObjectArgs(toolCall.arguments) : null;
  return {
    summary: parsed?.ok && typeof parsed.value.summary === 'string' && parsed.value.summary.trim()
      ? parsed.value.summary.trim()
      : params.fallbackSummary,
    candidateEvents: parsed?.ok && Array.isArray(parsed.value.candidateEvents)
      ? parsed.value.candidateEvents as WorldEvent[]
      : [],
  };
}

function materializeWorldResult(
  taskId: string,
  input: Parameters<WorldCouncilToolRuntime['emit_world_result']>[0],
): CouncilResult<'world'> {
  const detail: WorldDesignerResultDetail = {
    sceneMotionNotes: input.sceneMotionNotes,
    worldMotionNotes: input.worldMotionNotes,
    surfacedThreadIds: input.surfacedThreadIds,
    surfacedPendingEventIds: input.surfacedPendingEventIds,
    artifacts: input.artifacts || [],
  };
  return {
    taskId,
    domain: 'world',
    summary: input.summary,
    proposedEvents: input.candidateEvents,
    detail,
    confidence: 0.8,
    warnings: input.warnings || [],
  };
}

function emptyWorldResult(taskId: string, summary: string): CouncilResult<'world'> {
  return {
    taskId,
    domain: 'world',
    summary,
    proposedEvents: [],
    detail: {
      sceneMotionNotes: [],
      worldMotionNotes: [],
      surfacedThreadIds: [],
      surfacedPendingEventIds: [],
      artifacts: [],
    } satisfies WorldDesignerResultDetail,
    confidence: 0,
    warnings: ['world_unhandled'],
  };
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
