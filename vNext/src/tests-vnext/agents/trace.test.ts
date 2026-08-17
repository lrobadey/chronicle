import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emitTraceToolCalled,
  pushLLMTrace,
  pushToolTrace,
} from '../../agents/llm/trace';
import type { DebugEvent } from '../../engine/debug';
import type { TurnTrace } from '../../engine/session/types';

describe('LLM trace live debug bridge', () => {
  it('emits current thought headings when an LLM trace entry is pushed', () => {
    const events: DebugEvent[] = [];
    const trace = { llmCalls: [], toolCalls: [], debugSink: event => events.push(event) } as TurnTrace & {
      debugSink: (event: DebugEvent) => void;
    };

    pushLLMTrace(trace, {
      agent: 'steward',
      responseId: 'resp-1',
      status: 'completed',
      toolCalls: 1,
      reasoningHeadings: ['Reading the scene'],
    });

    assert.deepEqual(events, [{
      type: 'llm.response.received',
      agent: 'steward',
      specialistType: undefined,
      status: 'completed',
      responseId: 'resp-1',
      toolCalls: 1,
      reasoningHeadings: ['Reading the scene'],
      error: undefined,
    }]);
    assert.deepEqual(trace.llmCalls?.[0]?.reasoningHeadings, ['Reading the scene']);
  });

  it('emits live tool call and result events around trace tool records', () => {
    const events: DebugEvent[] = [];
    const trace = { llmCalls: [], toolCalls: [], debugSink: event => events.push(event) } as TurnTrace & {
      debugSink: (event: DebugEvent) => void;
    };

    emitTraceToolCalled(trace, {
      tool: 'inspect_local_affordances',
      input: { actorId: 'player-1' },
      agent: 'systems_designer',
      callId: 'call-1',
      callIndex: 1,
      callCount: 1,
    });
    pushToolTrace(trace, {
      tool: 'inspect_local_affordances',
      input: { actorId: 'player-1' },
      output: { ok: true },
      agent: 'systems_designer',
      callId: 'call-1',
      callIndex: 1,
      callCount: 1,
    });

    assert.equal(events[0]?.type, 'trace.tool.called');
    assert.equal(events[1]?.type, 'trace.tool.result');
    assert.deepEqual(trace.toolCalls?.[0]?.output, { ok: true });
  });
});
