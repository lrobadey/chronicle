import type { ResponseInputItem } from '../llm/types';
import { DEFAULT_MODEL } from '../llm/defaults';
import { classifyLLMError } from '../llm/errorUtils';
import { isFunctionCallItem, pushLLMTrace, pushToolTrace } from '../llm/trace';
import { emitDebugEvent } from '../../engine/debug';
import { STEWARD_SYSTEM_PROMPT } from './prompts';
import { STEWARD_TOOL_DEFS } from './tools';
import type { StewardAgentParams, StewardFinishTurnInput } from './types';
import { buildStewardBrief } from './types';

const STEWARD_TOOL_NAMES = new Set([
  'inspect_world_summary',
  'dispatch_character_task',
  'dispatch_world_task',
  'dispatch_systems_task',
  'inspect_council_results',
  'finish_steward_turn',
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

  pushToolTrace(trace, {
    tool: 'open_steward_turn',
    input: { playerText, hasApiKey: Boolean(apiKey) },
    output: { ok: true },
    agent: 'steward',
    stage: 'open',
    executionMs: 0,
  });

  const brief = buildStewardBrief(context);
  let previousResponseId: string | undefined;
  let pendingInput: ResponseInputItem[] = [
    { role: 'system', content: JSON.stringify({ brief }) },
    { role: 'user', content: playerText },
  ];

  for (let index = 0; index < maxIterations; index += 1) {
    const iteration = index + 1;
    emitDebugEvent(debug, { type: 'steward.iteration.started', iteration });
    let response;
    const llmStartedAt = Date.now();
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
      }, llmStartedAt);
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
    }, llmStartedAt);

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

      const callStartedAt = Date.now();
      let output: unknown;
      if ('error' in parsed) {
        output = { error: 'invalid_tool_arguments', details: parsed.error };
      } else {
        const dispatchResult = await dispatchTool(runtime, call.name, parsed.value);
        output = dispatchResult.output;
        if (dispatchResult.finished) {
          pushToolTrace(trace, {
            tool: call.name,
            input: toolInput,
            output,
            agent: 'steward',
            iteration,
            callId,
            callIndex: callIndex + 1,
            callCount: toolCalls.length,
          }, callStartedAt);
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

      pushToolTrace(trace, {
        tool: call.name,
        input: toolInput,
        output,
        agent: 'steward',
        iteration,
        callId,
        callIndex: callIndex + 1,
        callCount: toolCalls.length,
      }, callStartedAt);
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
  if (!STEWARD_TOOL_NAMES.has(name)) {
    return { output: { ok: false, error: 'unknown_tool', name }, finished: false };
  }
  switch (name) {
    case 'inspect_world_summary':
      return { output: await runtime.inspect_world_summary(args as Parameters<typeof runtime.inspect_world_summary>[0]), finished: false };
    case 'dispatch_character_task':
      return { output: await runtime.dispatch_character_task(args as Parameters<typeof runtime.dispatch_character_task>[0]), finished: false };
    case 'dispatch_world_task':
      return { output: await runtime.dispatch_world_task(args as Parameters<typeof runtime.dispatch_world_task>[0]), finished: false };
    case 'dispatch_systems_task':
      return { output: await runtime.dispatch_systems_task(args as Parameters<typeof runtime.dispatch_systems_task>[0]), finished: false };
    case 'inspect_council_results':
      return { output: await runtime.inspect_council_results(args as Parameters<typeof runtime.inspect_council_results>[0]), finished: false };
    case 'finish_steward_turn':
      return { output: await runtime.finish_steward_turn(args as unknown as StewardFinishTurnInput), finished: true };
  }
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
