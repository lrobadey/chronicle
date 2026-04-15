import type { ResponseInputItem } from '../llm/types';
import { DEFAULT_MODEL } from '../llm/defaults';
import { classifyLLMError } from '../llm/errorUtils';
import { isFunctionCallItem, pushLLMTrace } from '../llm/trace';
import { emitDebugEvent } from '../../engine/debug';
import { STEWARD_SYSTEM_PROMPT } from './prompts';
import { STEWARD_TOOL_DEFS } from './tools';
import type { StewardAgentParams, StewardFinishTurnInput } from './types';

const STEWARD_TOOL_NAMES = new Set([
  'inspect_world_summary',
  'inspect_scene_detail',
  'delegate_mechanics',
  'delegate_legacy_gm',
  'finish_steward_turn',
]);

const LEGACY_GM_TOOL_NAMES = new Set([
  'observe_world',
  'consult_npc',
  'consult_specialist',
  'propose_events',
  'resolve_mechanics',
  'review_mechanics_resolution',
  'schedule_task',
  'review_schedule_resolution',
  'finish_turn',
]);

export async function runStewardAgent(params: StewardAgentParams): Promise<{ finished: boolean }> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    stewardReasoningEffort = 'low',
    playerText,
    context,
    runtime,
    llm,
    maxIterations = 8,
    debug,
    trace,
  } = params;

  trace?.toolCalls.push({
    tool: 'open_steward_turn',
    input: { playerText, hasApiKey: Boolean(apiKey) },
    output: { ok: true },
  });

  if (!apiKey) {
    emitDebugEvent(debug, { type: 'steward.iteration.started', iteration: 1 });
    const mechanicsOutput = await runtime.delegate_mechanics({ playerText, objective: 'Resolve a bounded local action if one is safe.' });
    trace?.toolCalls.push({
      tool: 'delegate_mechanics',
      input: { playerText, objective: 'Resolve a bounded local action if one is safe.' },
      output: mechanicsOutput,
    });
    trace?.toolCalls.push({
      tool: 'steward_preflight_mechanics',
      input: { playerText, objective: 'Resolve a bounded local action if one is safe.' },
      output: mechanicsOutput,
    });
    const mechanicsRecord = mechanicsOutput as Record<string, unknown>;
    if (mechanicsRecord?.status === 'ok') {
      const finish = await runtime.finish_steward_turn({
        summary: typeof mechanicsRecord.summary === 'string' ? mechanicsRecord.summary : 'Steward resolved the turn through mechanics.',
        candidateEvents: Array.isArray(mechanicsRecord.candidateEvents) ? mechanicsRecord.candidateEvents as StewardFinishTurnInput['candidateEvents'] : [],
        playerPrompt: {
          pending: mechanicsRecord.pendingPrompt as StewardFinishTurnInput['playerPrompt'] extends infer T
            ? T extends { pending?: infer P } ? P : null
            : null,
          clear: mechanicsRecord.clearPendingPrompt === true,
        },
      });
      trace?.toolCalls.push({
        tool: 'finish_steward_turn',
        input: {
          summary: typeof mechanicsRecord.summary === 'string' ? mechanicsRecord.summary : 'Steward resolved the turn through mechanics.',
        },
        output: finish,
      });
      return { finished: true };
    }

    const fallback = await runtime.delegate_legacy_gm({
      reason: 'No API key available for steward planning; using legacy fallback worker.',
      focus: null,
    });
    trace?.toolCalls.push({
      tool: 'delegate_legacy_gm',
      input: { reason: 'No API key available for steward planning; using legacy fallback worker.', focus: null },
      output: fallback,
    });
    await runtime.finish_steward_turn({
      summary: fallback.summary,
      candidateEvents: fallback.candidateEvents,
      playerPrompt: {
        pending: fallback.pendingPrompt,
        clear: fallback.clearPendingPrompt === true,
      },
      agendaUpdates: fallback.agendaUpdates,
      directorUpdates: fallback.directorUpdates,
    });
    return { finished: true };
  }

  const preflight = await runtime.delegate_mechanics({
    playerText,
    objective: 'Resolve a bounded local action if one is safe.',
    deterministicOnly: true,
  });
  trace?.toolCalls.push({
    tool: 'steward_preflight_mechanics',
    input: { playerText, objective: 'Resolve a bounded local action if one is safe.' },
    output: preflight,
  });
  const preflightRecord = preflight as Record<string, unknown>;
  if (preflightRecord?.status === 'ok') {
    await runtime.finish_steward_turn({
      summary: typeof preflightRecord.summary === 'string' ? preflightRecord.summary : 'Steward resolved the turn through mechanics.',
      candidateEvents: Array.isArray(preflightRecord.candidateEvents) ? preflightRecord.candidateEvents as StewardFinishTurnInput['candidateEvents'] : [],
      playerPrompt: {
        pending: preflightRecord.pendingPrompt as StewardFinishTurnInput['playerPrompt'] extends infer T
          ? T extends { pending?: infer P } ? P : null
          : null,
        clear: preflightRecord.clearPendingPrompt === true,
      },
    });
    return { finished: true };
  }

  let previousResponseId: string | undefined;
  const compatibilityWorld = buildLegacyWorldCompatibilityContext(context);
  let pendingInput: ResponseInputItem[] = [
    { role: 'system', content: JSON.stringify({ steward: context, world: compatibilityWorld }) },
    { role: 'user', content: playerText },
  ];

  for (let index = 0; index < maxIterations; index += 1) {
    const iteration = index + 1;
    emitDebugEvent(debug, { type: 'steward.iteration.started', iteration });
    let response;
    try {
      response = await llm.responsesCreate({
        apiKey,
        model,
        reasoning: { effort: stewardReasoningEffort },
        instructions: STEWARD_SYSTEM_PROMPT,
        input: pendingInput,
        previous_response_id: previousResponseId,
        tools: STEWARD_TOOL_DEFS,
        truncation: 'auto',
        store: true,
      });
    } catch (error) {
      pushLLMTrace(trace, {
        agent: 'steward',
        previousResponseId,
        inputItems: pendingInput.length,
        status: 'failed',
        error: classifyLLMError(error),
      });
      throw error;
    }

    const responseItems = response.output || [];
    const toolCalls = responseItems.filter(isFunctionCallItem);
    emitDebugEvent(debug, {
      type: 'steward.response.received',
      iteration,
      toolCalls: toolCalls.length,
      toolCallCount: toolCalls.length,
      toolCallNames: toolCalls.map(call => call.name),
      status: response.status,
      responseId: response.id,
      error: response.error ?? response.incomplete_details,
    });
    pushLLMTrace(trace, {
      agent: 'steward',
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
      await runtime.finish_steward_turn({ summary: response.output_text || 'Steward ended the turn.' });
      return { finished: true };
    }

    const nextInput: ResponseInputItem[] = [];
    for (let callIndex = 0; callIndex < toolCalls.length; callIndex += 1) {
      const call = toolCalls[callIndex];
      const parsed = parseToolArgs(call.arguments);
      const toolInput = parsed.ok ? parsed.value : { raw: call.arguments };
      const callId = call.call_id || `missing-call-id-${iteration}-${callIndex}`;
      emitDebugEvent(debug, {
        type: 'tool.called',
        iteration,
        tool: call.name,
        callId,
        callIndex: callIndex + 1,
        callCount: toolCalls.length,
        input: toolInput,
      });

      let output: unknown;
      if ('error' in parsed) {
        output = { error: 'invalid_tool_arguments', details: parsed.error };
      } else {
        const dispatchResult = await dispatchTool(runtime, call.name, parsed.value);
        output = dispatchResult.output;
        if (dispatchResult.finished) {
          trace?.toolCalls.push({ tool: call.name, input: toolInput, output });
          emitDebugEvent(debug, {
            type: 'tool.result',
            iteration,
            tool: call.name,
            callId,
            callIndex: callIndex + 1,
            callCount: toolCalls.length,
            output,
            ok: deriveToolResultOk(output),
          });
          nextInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: safeJSONStringify(output),
          });
          return { finished: true };
        }
      }

      trace?.toolCalls.push({ tool: call.name, input: toolInput, output });
      emitDebugEvent(debug, {
        type: 'tool.result',
        iteration,
        tool: call.name,
        callId,
        callIndex: callIndex + 1,
        callCount: toolCalls.length,
        output,
        ok: deriveToolResultOk(output),
      });
      nextInput.push({
        type: 'function_call_output',
        call_id: callId,
        output: safeJSONStringify(output),
      });

      if (call.name === 'finish_steward_turn' && deriveToolResultOk(output) !== false) {
        return { finished: true };
      }
    }

    pendingInput = nextInput;
  }

  await runtime.finish_steward_turn({ summary: 'Steward reached the iteration limit.' });
  return { finished: false };
}

async function dispatchTool(
  runtime: StewardAgentParams['runtime'],
  name: string,
  args: Record<string, unknown>,
): Promise<{ output: unknown; finished: boolean }> {
  if (LEGACY_GM_TOOL_NAMES.has(name)) {
    const legacyProposal = await runtime.delegate_legacy_gm({
      reason: `Steward requested legacy GM tool "${name}" via compatibility routing.`,
      focus: resolveLegacyFocus(args),
      seedToolCall: { name, arguments: args },
    });
    const finishInput = mapLegacyProposalToFinishInput(legacyProposal);
    const finishOutput = await runtime.finish_steward_turn(finishInput);
    return {
      output: {
        ok: deriveToolResultOk(finishOutput) !== false,
        delegated: true,
        legacyToolName: name,
        legacyProposal,
        finishResult: finishOutput,
      },
      finished: true,
    };
  }
  if (!STEWARD_TOOL_NAMES.has(name)) {
    return { output: { ok: false, error: 'unknown_tool', name }, finished: false };
  }
  switch (name) {
    case 'inspect_world_summary':
      return {
        output: await runtime.inspect_world_summary(args as Parameters<typeof runtime.inspect_world_summary>[0]),
        finished: false,
      };
    case 'inspect_scene_detail':
      return {
        output: await runtime.inspect_scene_detail(args as Parameters<typeof runtime.inspect_scene_detail>[0]),
        finished: false,
      };
    case 'delegate_mechanics':
      return {
        output: await runtime.delegate_mechanics(args as Parameters<typeof runtime.delegate_mechanics>[0]),
        finished: false,
      };
    case 'delegate_legacy_gm':
      return {
        output: await runtime.delegate_legacy_gm(args as Parameters<typeof runtime.delegate_legacy_gm>[0]),
        finished: false,
      };
    case 'finish_steward_turn':
      return {
        output: await runtime.finish_steward_turn(args as unknown as StewardFinishTurnInput),
        finished: true,
      };
  }
}

function buildLegacyWorldCompatibilityContext(context: StewardAgentParams['context']) {
  return {
    opening: context.opening,
    recentTurns: context.recentTurns,
    playerTranscriptTail: context.playerTranscriptTail,
    pendingPrompt: context.pendingPrompt,
    telemetry: context.telemetry,
    agendas: context.directorState,
    stewardMemory: context.stewardMemory,
    sceneSummary: context.sceneSummary,
    worldSummary: context.worldSummary,
  };
}

function mapLegacyProposalToFinishInput(
  proposal: Awaited<ReturnType<StewardAgentParams['runtime']['delegate_legacy_gm']>>,
): StewardFinishTurnInput {
  return {
    summary: proposal.summary,
    candidateEvents: proposal.candidateEvents,
    playerPrompt: {
      pending: proposal.pendingPrompt,
      clear: proposal.clearPendingPrompt === true,
    },
    agendaUpdates: proposal.agendaUpdates,
    directorUpdates: proposal.directorUpdates,
  };
}

function resolveLegacyFocus(args: Record<string, unknown>): string | null {
  if (typeof args.focus === 'string' && args.focus.trim()) return args.focus.trim();
  if (typeof args.question === 'string' && args.question.trim()) return args.question.trim();
  if (typeof args.topic === 'string' && args.topic.trim()) return args.topic.trim();
  return null;
}

function parseToolArgs(value: string | undefined): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!value || !value.trim()) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'arguments_must_be_json_object' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'arguments_parse_failed' };
  }
}

function deriveToolResultOk(output: unknown): boolean | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const record = output as Record<string, unknown>;
  if (typeof record.ok === 'boolean') return record.ok;
  if (typeof record.error === 'string') return false;
  return undefined;
}

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'non_serializable_tool_output' });
  }
}
