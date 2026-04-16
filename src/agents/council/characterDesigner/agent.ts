import { DEFAULT_MODEL, MECHANICS_MODEL } from '../../llm/defaults';
import type { LLMClient, ResponseInputItem } from '../../llm/types';
import { isFunctionCallItem, pushLLMTrace } from '../../llm/trace';
import type { CouncilResult, CouncilTask } from '../../hierarchy/types';
import type { WorldEvent } from '../../../sim/events';
import { CHARACTER_DESIGNER_SYSTEM_PROMPT } from './prompts';
import { CHARACTER_RESULT_TOOL_NAME, CHARACTER_TOOL_DEFS } from './tools';
import type {
  CharacterCouncilToolRuntime,
  CharacterDesignerArtifact,
  CharacterDesignerResultDetail,
  CharacterDesignerTaskContext,
  CharacterIntentDraft,
  CharacterReplyDraft,
  CharacterSelectionResult,
} from './types';

export interface CharacterDesignerAgentParams {
  apiKey?: string;
  llm: LLMClient;
  turnNumber: number;
  model?: string;
  workerModel?: string;
  trace?: { toolCalls?: Array<{ tool: string; input: unknown; output: unknown }>; llmCalls?: any[] };
}

export async function runCharacterDesignerTask(
  task: CouncilTask<'character'>,
  params: CharacterDesignerAgentParams,
): Promise<CouncilResult<'character'>> {
  const context = task.context as CharacterDesignerTaskContext;
  const runtime = createCharacterRuntime(context, params);
  return runCharacterDesignerLoop(task, context, runtime, params);
}

async function runCharacterDesignerLoop(
  task: CouncilTask<'character'>,
  context: CharacterDesignerTaskContext,
  runtime: CharacterCouncilToolRuntime,
  params: CharacterDesignerAgentParams,
): Promise<CouncilResult<'character'>> {
  if (!params.apiKey) {
    const selection = await runtime.worker_select_npc({ playerText: context.playerText, maxCandidates: 1 });
    const targetId = selection.npcIds[0];
    if (!targetId) return emptyCharacterResult(task.taskId, 'No NPC available to answer.');
    const reply = await runtime.worker_draft_npc_reply({ npcId: targetId });
    const intent = await runtime.worker_draft_private_intent({ npcId: targetId });
    return materializeCharacterResult(task.taskId, {
      summary: `${lookupNpcName(context, targetId)} answers the player.`,
      candidateEvents: [{
        type: 'Speak',
        actorId: targetId,
        text: reply.publicUtterance,
      }],
      selectedNpcIds: [targetId],
      privateIntentNotes: [{ npcId: targetId, note: intent.privateIntent }],
      relationshipNotes: [],
      artifacts: [{
        npcId: targetId,
        publicUtterance: reply.publicUtterance,
        emotionalTone: reply.emotionalTone ?? undefined,
        privateIntent: intent.privateIntent,
      }],
      warnings: [],
    });
  }

  let previousResponseId: string | undefined;
  let pendingInput: ResponseInputItem[] = [
    { role: 'system', content: JSON.stringify({ task, context }) },
    { role: 'user', content: context.playerText },
  ];

  for (let index = 0; index < 4; index += 1) {
    const response = await params.llm.responsesCreate({
      apiKey: params.apiKey,
      model: params.model || DEFAULT_MODEL,
      reasoning: { effort: 'medium' },
      instructions: CHARACTER_DESIGNER_SYSTEM_PROMPT,
      input: pendingInput,
      previous_response_id: previousResponseId,
      tools: CHARACTER_TOOL_DEFS,
      truncation: 'auto',
      store: true,
    });
    const responseItems = response.output || [];
    const toolCalls = responseItems.filter(isFunctionCallItem);
    pushLLMTrace(params.trace, {
      agent: 'character_designer',
      responseId: response.id,
      previousResponseId,
      inputItems: pendingInput.length,
      outputItems: responseItems.length,
      toolCalls: toolCalls.length,
      usage: response.usage,
      status: response.status,
      error: response.error ?? response.incomplete_details,
    });
    previousResponseId = response.id || previousResponseId;
    if (!toolCalls.length) {
      return emptyCharacterResult(task.taskId, response.output_text || 'Character Designer ended without a result.');
    }

    const nextInput: ResponseInputItem[] = [];
    for (const call of toolCalls) {
      const parsed = parseObjectArgs(call.arguments);
      const callId = call.call_id || `character-call-${index}`;
      const toolInput = parsed.ok ? parsed.value : { raw: call.arguments };
      let output: unknown;
      if (!parsed.ok) {
        output = { ok: false, error: 'arguments_parse_failed' };
      } else if (call.name === CHARACTER_RESULT_TOOL_NAME) {
        return materializeCharacterResult(task.taskId, parsed.value as Parameters<CharacterCouncilToolRuntime['emit_character_result']>[0]);
      } else {
        output = await dispatchCharacterTool(runtime, call.name, parsed.value);
      }
      params.trace?.toolCalls?.push({ tool: call.name, input: toolInput, output });
      nextInput.push({
        type: 'function_call_output',
        call_id: callId,
        output: safeJSONStringify(output),
      });
    }
    pendingInput = nextInput;
  }

  return emptyCharacterResult(task.taskId, 'Character Designer reached the iteration limit.');
}

function createCharacterRuntime(
  context: CharacterDesignerTaskContext,
  params: CharacterDesignerAgentParams,
): CharacterCouncilToolRuntime {
  return {
    inspect_character_scene: async (input) => {
      if (input.focusNpcId) {
        return {
          ok: true,
          npc: context.nearbyNpcs.find(npc => npc.npcId === input.focusNpcId) || null,
          question: input.question || null,
        };
      }
      return {
        ok: true,
        question: input.question || null,
        nearbyNpcs: context.nearbyNpcs,
        recentTurns: context.recentTurns,
        pendingPrompt: context.pendingPrompt,
      };
    },
    inspect_conversation_history: async (input) => ({
      ok: true,
      conversationHistory: typeof input.limit === 'number' && input.limit > 0
        ? context.conversationHistory.slice(-Math.max(1, Math.floor(input.limit)))
        : context.conversationHistory,
    }),
    inspect_relationship_state: async (input) => ({
      ok: true,
      relationships: input.npcId
        ? (context.nearbyNpcs.find(npc => npc.npcId === input.npcId)?.relationships || [])
        : context.nearbyNpcs.map(npc => ({ npcId: npc.npcId, name: npc.name, relationships: npc.relationships })),
    }),
    inspect_faction_context: async (input) => ({
      ok: true,
      factionContext: input.npcId
        ? (context.nearbyNpcs.find(npc => npc.npcId === input.npcId)?.factionMemberships || [])
        : context.factionContext,
    }),
    worker_select_npc: async (input) => selectNpcWorker(context, input.playerText || context.playerText),
    worker_draft_npc_reply: async (input) => draftNpcReplyWorker(context, input.npcId, params),
    worker_draft_private_intent: async (input) => draftNpcIntentWorker(context, input.npcId, params),
    emit_character_result: async (input) => ({ ok: true, ...input }),
  };
}

async function dispatchCharacterTool(
  runtime: CharacterCouncilToolRuntime,
  name: string,
  args: Record<string, unknown>,
) {
  switch (name) {
    case 'inspect_character_scene':
      return runtime.inspect_character_scene(args as Parameters<CharacterCouncilToolRuntime['inspect_character_scene']>[0]);
    case 'inspect_conversation_history':
      return runtime.inspect_conversation_history(args as Parameters<CharacterCouncilToolRuntime['inspect_conversation_history']>[0]);
    case 'inspect_relationship_state':
      return runtime.inspect_relationship_state(args as Parameters<CharacterCouncilToolRuntime['inspect_relationship_state']>[0]);
    case 'inspect_faction_context':
      return runtime.inspect_faction_context(args as Parameters<CharacterCouncilToolRuntime['inspect_faction_context']>[0]);
    case 'worker_select_npc':
      return runtime.worker_select_npc(args as Parameters<CharacterCouncilToolRuntime['worker_select_npc']>[0]);
    case 'worker_draft_npc_reply':
      return runtime.worker_draft_npc_reply(args as Parameters<CharacterCouncilToolRuntime['worker_draft_npc_reply']>[0]);
    case 'worker_draft_private_intent':
      return runtime.worker_draft_private_intent(args as Parameters<CharacterCouncilToolRuntime['worker_draft_private_intent']>[0]);
    default:
      return { ok: false, error: 'unknown_character_tool', name };
  }
}

async function selectNpcWorker(
  context: CharacterDesignerTaskContext,
  playerText: string,
): Promise<CharacterSelectionResult> {
  const lower = playerText.toLowerCase();
  const explicit = context.nearbyNpcs.find(npc => lower.includes(npc.name.toLowerCase()));
  const ranked = [...context.nearbyNpcs].sort((left, right) => left.distanceMeters - right.distanceMeters);
  const target = explicit || ranked[0];
  return {
    npcIds: target ? [target.npcId] : [],
    confidence: target ? (explicit ? 0.95 : 0.72) : 0,
    rationale: explicit ? 'Matched NPC name in player text.' : 'Selected the nearest available NPC.',
  };
}

async function draftNpcReplyWorker(
  context: CharacterDesignerTaskContext,
  npcId: string,
  params: CharacterDesignerAgentParams,
): Promise<CharacterReplyDraft> {
  const npc = context.nearbyNpcs.find(candidate => candidate.npcId === npcId);
  if (!npc) {
    return { publicUtterance: '...', emotionalTone: 'guarded' };
  }
  if (!params.apiKey) {
    return {
      publicUtterance: `${npc.name} acknowledges you with a brief reply.`,
      emotionalTone: npc.persona?.voice || 'measured',
    };
  }

  const output = await runCharacterWorkerTool({
    apiKey: params.apiKey,
    llm: params.llm,
    model: params.workerModel || MECHANICS_MODEL,
    system: `You are a small Chronicle character worker. Draft only the public reply for one NPC. Keep it to 1-3 short sentences and stay grounded in the supplied transcript and persona.`,
    toolName: 'emit_character_reply',
    schema: strictWorkerSchema({
      publicUtterance: { type: 'string' },
      emotionalTone: { type: ['string', 'null'] },
    }),
    input: {
      playerText: context.playerText,
      npc,
      conversationHistory: context.conversationHistory.slice(-12),
      sceneObservation: context.sceneObservation,
    },
    trace: params.trace,
    agent: 'character_worker',
  });

  return {
    publicUtterance: typeof output.publicUtterance === 'string' && output.publicUtterance.trim()
      ? output.publicUtterance.trim()
      : `${npc.name} answers cautiously.`,
    emotionalTone: typeof output.emotionalTone === 'string' ? output.emotionalTone : null,
  };
}

async function draftNpcIntentWorker(
  context: CharacterDesignerTaskContext,
  npcId: string,
  params: CharacterDesignerAgentParams,
): Promise<CharacterIntentDraft> {
  const npc = context.nearbyNpcs.find(candidate => candidate.npcId === npcId);
  if (!npc) return { privateIntent: 'wait' };
  if (!params.apiKey) {
    return { privateIntent: npc.persona?.goals?.[0] || 'respond_cautiously' };
  }

  const output = await runCharacterWorkerTool({
    apiKey: params.apiKey,
    llm: params.llm,
    model: params.workerModel || MECHANICS_MODEL,
    system: `You are a small Chronicle character worker. Draft a short hidden private intent note for one NPC for the current turn. Return a terse action-oriented note only.`,
    toolName: 'emit_character_intent',
    schema: strictWorkerSchema({
      privateIntent: { type: 'string' },
    }),
    input: {
      playerText: context.playerText,
      npc,
      factionContext: context.factionContext,
      conversationHistory: context.conversationHistory.slice(-12),
    },
    trace: params.trace,
    agent: 'character_worker',
  });
  return {
    privateIntent: typeof output.privateIntent === 'string' && output.privateIntent.trim()
      ? output.privateIntent.trim()
      : 'respond_cautiously',
  };
}

function materializeCharacterResult(
  taskId: string,
  input: Parameters<CharacterCouncilToolRuntime['emit_character_result']>[0],
): CouncilResult<'character'> {
  const detail: CharacterDesignerResultDetail = {
    selectedNpcIds: input.selectedNpcIds,
    privateIntentNotes: input.privateIntentNotes,
    relationshipNotes: input.relationshipNotes || [],
    artifacts: input.artifacts.map(artifact => ({
      npcId: artifact.npcId,
      publicUtterance: artifact.publicUtterance,
      emotionalTone: artifact.emotionalTone || undefined,
      privateIntent: artifact.privateIntent,
    })),
  };
  return {
    taskId,
    domain: 'character',
    summary: input.summary,
    proposedEvents: input.candidateEvents,
    detail,
    confidence: input.selectedNpcIds.length ? 0.9 : 0.3,
    warnings: input.warnings || [],
  };
}

function emptyCharacterResult(taskId: string, summary: string): CouncilResult<'character'> {
  return {
    taskId,
    domain: 'character',
    summary,
    proposedEvents: [],
    detail: {
      selectedNpcIds: [],
      privateIntentNotes: [],
      relationshipNotes: [],
      artifacts: [],
    } satisfies CharacterDesignerResultDetail,
    confidence: 0,
    warnings: ['character_unhandled'],
  };
}

function lookupNpcName(context: CharacterDesignerTaskContext, npcId: string) {
  return context.nearbyNpcs.find(npc => npc.npcId === npcId)?.name || npcId;
}

async function runCharacterWorkerTool(params: {
  apiKey: string;
  llm: LLMClient;
  model: string;
  system: string;
  toolName: string;
  schema: Record<string, unknown>;
  input: unknown;
  trace?: { llmCalls?: any[] };
  agent: 'character_worker';
}) {
  const response = await params.llm.responsesCreate({
    apiKey: params.apiKey,
    model: params.model,
    reasoning: { effort: 'low' },
    instructions: params.system,
    input: JSON.stringify(params.input),
    tools: [{
      type: 'function',
      name: params.toolName,
      description: 'Return the structured worker output.',
      parameters: params.schema,
      strict: true,
    }],
    tool_choice: { type: 'function', name: params.toolName },
    truncation: 'auto',
    store: true,
  });
  const toolCall = response.output.filter(isFunctionCallItem).find(call => call.name === params.toolName);
  pushLLMTrace(params.trace, {
    agent: params.agent,
    responseId: response.id,
    inputItems: 1,
    outputItems: response.output.length,
    toolCalls: toolCall ? 1 : 0,
    usage: response.usage,
    status: response.status,
    error: response.error ?? response.incomplete_details,
  });
  if (!toolCall) return {};
  const parsed = parseObjectArgs(toolCall.arguments);
  return parsed.ok ? parsed.value : {};
}

function strictWorkerSchema(properties: Record<string, unknown>) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  } as const;
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
