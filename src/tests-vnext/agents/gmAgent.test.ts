import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runGMAgent } from '../../agents/gm/gmAgent';
import { DEFAULT_MODEL } from '../../agents/llm/defaults';
import { QueueLLM } from '../helpers/queueLLM';
import type { DebugEvent } from '../../engine/debug';

describe('GM agent loop', () => {
  it('chains calls with previous_response_id and sends only function outputs to follow-up calls', async () => {
    let observeCalls = 0;
    let proposeCalls = 0;
    let finishCalls = 0;

    const llm = new QueueLLM([
      {
        id: 'resp-first',
        output: [
          { type: 'function_call', name: 'observe_world', arguments: '{"perspective":"gm"}', call_id: 'c1' },
          { type: 'function_call', name: 'propose_events', arguments: '{"events":[]}', call_id: 'c2' },
        ],
        output_text: '',
      },
      {
        id: 'resp-second',
        output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'c3' }],
        output_text: '',
      },
    ]);
    const debugEvents: DebugEvent[] = [];

    const result = await runGMAgent({
      apiKey: 'test-key',
      playerText: 'advance',
      worldContext: { turn: 3, weather: 'clear' },
      llm,
      runtime: {
        observe_world: async () => {
          observeCalls += 1;
          return { ok: true };
        },
        consult_npc: async () => ({ ok: true }),
        consult_specialist: async () => ({ ok: true }),
        propose_events: async () => {
          proposeCalls += 1;
          return { ok: true, accepted: 0, rejected: 0 };
        },
        finish_turn: async () => {
          finishCalls += 1;
          return { ok: true };
        },
      },
      debug: event => debugEvents.push(event),
      trace: { toolCalls: [], llmCalls: [] },
    });

    assert.equal(result.finished, true);
    assert.equal(observeCalls, 1);
    assert.equal(proposeCalls, 1);
    assert.equal(finishCalls, 1);

    const firstCall = llm.calls[0];
    const secondCall = llm.calls[1];
    assert.ok(firstCall);
    assert.ok(secondCall);
    assert.equal(Array.isArray(firstCall.input), true);
    const firstInput = firstCall.input as Array<Record<string, unknown>>;
    assert.equal(firstInput.length, 2);
    assert.equal(firstInput[0]?.role, 'system');
    assert.equal(firstInput[1]?.role, 'user');
    const firstSystemPayload = JSON.parse(String(firstInput[0]?.content));
    assert.deepEqual(firstSystemPayload, { world: { turn: 3, weather: 'clear' } });
    assert.equal(firstInput[1]?.content, 'advance');
    assert.equal(firstCall.model, DEFAULT_MODEL);
    assert.deepEqual(firstCall.reasoning, { effort: 'low' });
    assert.equal(secondCall.previous_response_id, 'resp-first');

    const secondInput = secondCall.input;
    assert.equal(Array.isArray(secondInput), true);
    const outputItems = (secondInput as Array<Record<string, unknown>>).filter(item => item.type === 'function_call_output');
    assert.equal(outputItems.length, 2);
    assert.equal((secondInput as Array<Record<string, unknown>>).every(item => item.type === 'function_call_output'), true);
    assert.equal(debugEvents[0]?.type, 'gm.iteration.started');
    assert.equal(debugEvents[1]?.type, 'gm.response.received');
    assert.equal(debugEvents[2]?.type, 'tool.called');
    assert.equal(debugEvents[3]?.type, 'tool.result');
    if (debugEvents[1]?.type === 'gm.response.received') {
      assert.equal(debugEvents[1].responseId, 'resp-first');
      assert.equal(debugEvents[1].toolCallCount, 2);
      assert.deepEqual(debugEvents[1].toolCallNames, ['observe_world', 'propose_events']);
    }
    if (debugEvents[2]?.type === 'tool.called') {
      assert.equal(debugEvents[2].iteration, 1);
      assert.equal(debugEvents[2].callId, 'c1');
      assert.equal(debugEvents[2].callIndex, 1);
      assert.equal(debugEvents[2].callCount, 2);
    }
    if (debugEvents[4]?.type === 'tool.called') {
      assert.equal(debugEvents[4].callId, 'c2');
      assert.equal(debugEvents[4].callIndex, 2);
      assert.equal(debugEvents[4].callCount, 2);
    }
  });

  it('allows propose_events without requiring observe_world first', async () => {
    let observeCalls = 0;
    let proposeCalls = 0;
    let finishCalls = 0;

    const llm = new QueueLLM([
      {
        id: 'resp-first',
        output: [{ type: 'function_call', name: 'propose_events', arguments: '{"events":[]}', call_id: 'p1' }],
        output_text: '',
      },
      {
        id: 'resp-second',
        output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'f1' }],
        output_text: '',
      },
    ]);

    const result = await runGMAgent({
      apiKey: 'test-key',
      playerText: 'do something',
      llm,
      runtime: {
        observe_world: async () => {
          observeCalls += 1;
          return { ok: true };
        },
        consult_npc: async () => ({ ok: true }),
        consult_specialist: async () => ({ ok: true }),
        propose_events: async () => {
          proposeCalls += 1;
          return { ok: true, accepted: 0, rejected: 0 };
        },
        finish_turn: async () => {
          finishCalls += 1;
          return { ok: true };
        },
      },
      trace: { toolCalls: [], llmCalls: [] },
    });

    assert.equal(result.finished, true);
    assert.equal(observeCalls, 0);
    assert.equal(proposeCalls, 1);
    assert.equal(finishCalls, 1);
  });

  it('can consult a specialist before proposing events', async () => {
    let specialistCalls = 0;
    let proposeCalls = 0;

    const llm = new QueueLLM([
      {
        id: 'resp-first',
        output: [{ type: 'function_call', name: 'consult_specialist', arguments: '{"specialistType":"scene","question":"What should complicate this scene?","focus":"the landing"}', call_id: 's1' }],
        output_text: '',
      },
      {
        id: 'resp-second',
        output: [{ type: 'function_call', name: 'propose_events', arguments: '{"events":[]}', call_id: 'p1' }],
        output_text: '',
      },
      {
        id: 'resp-third',
        output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'f1' }],
        output_text: '',
      },
    ]);

    const result = await runGMAgent({
      apiKey: 'test-key',
      playerText: 'look around',
      llm,
      runtime: {
        observe_world: async () => ({ ok: true }),
        consult_npc: async () => ({ ok: true }),
        consult_specialist: async input => {
          specialistCalls += 1;
          assert.equal(input.specialistType, 'scene');
          return {
            summary: 'Raise the local pressure.',
            recommendations: ['Introduce a witness.'],
            candidateEvents: [],
            creationIntent: { kind: 'npc', purpose: 'Introduce a local witness.' },
            risks: [],
          };
        },
        propose_events: async () => {
          proposeCalls += 1;
          return { ok: true, accepted: 0, rejected: 0 };
        },
        finish_turn: async () => ({ ok: true }),
      },
      trace: { toolCalls: [], llmCalls: [] },
    });

    assert.equal(result.finished, true);
    assert.equal(specialistCalls, 1);
    assert.equal(proposeCalls, 1);
  });

  it('handles malformed tool arguments and continues', async () => {
    let observeCalls = 0;
    let finishCalls = 0;

    const llm = new QueueLLM([
      {
        id: 'resp-1',
        output: [{ type: 'function_call', name: 'observe_world', arguments: '{', call_id: 'bad-args' }],
        output_text: '',
      },
      {
        id: 'resp-2',
        output: [{ type: 'function_call', name: 'observe_world', arguments: '{"perspective":"gm"}', call_id: 'ok-args' }],
        output_text: '',
      },
      {
        id: 'resp-3',
        output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'done' }],
        output_text: '',
      },
    ]);

    const result = await runGMAgent({
      apiKey: 'test-key',
      playerText: 'test malformed',
      llm,
      runtime: {
        observe_world: async () => {
          observeCalls += 1;
          return { ok: true };
        },
        consult_npc: async () => ({ ok: true }),
        consult_specialist: async () => ({ ok: true }),
        propose_events: async () => ({ ok: true }),
        finish_turn: async () => {
          finishCalls += 1;
          return { ok: true };
        },
      },
      trace: { toolCalls: [], llmCalls: [] },
    });

    assert.equal(result.finished, true);
    assert.equal(observeCalls, 1);
    assert.equal(finishCalls, 1);

    const secondInput = llm.calls[1]?.input;
    assert.equal(Array.isArray(secondInput), true);
    const outputItem = (secondInput as Array<Record<string, unknown>>).find(item => item.type === 'function_call_output');
    assert.ok(outputItem);
    const parsedOutput = JSON.parse(String(outputItem?.output));
    assert.equal(parsedOutput.error, 'invalid_tool_arguments');
  });

  it('accepts an explicit GM reasoning override', async () => {
    const highLLM = new QueueLLM([
      {
        id: 'resp-high',
        output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'done' }],
        output_text: '',
      },
    ]);

    await runGMAgent({
      apiKey: 'test-key',
      gmReasoningEffort: 'high',
      playerText: 'think harder',
      worldContext: { turn: 1 },
      llm: highLLM,
      runtime: {
        observe_world: async () => ({ ok: true }),
        consult_npc: async () => ({ ok: true }),
        consult_specialist: async () => ({ ok: true }),
        propose_events: async () => ({ ok: true }),
        finish_turn: async () => ({ ok: true }),
      },
    });

    assert.deepEqual(highLLM.calls[0]?.reasoning, { effort: 'high' });

    const mediumLLM = new QueueLLM([
      {
        id: 'resp-medium',
        output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'done' }],
        output_text: '',
      },
    ]);

    await runGMAgent({
      apiKey: 'test-key',
      gmReasoningEffort: 'medium',
      playerText: 'split the difference',
      worldContext: { turn: 2 },
      llm: mediumLLM,
      runtime: {
        observe_world: async () => ({ ok: true }),
        consult_npc: async () => ({ ok: true }),
        consult_specialist: async () => ({ ok: true }),
        propose_events: async () => ({ ok: true }),
        finish_turn: async () => ({ ok: true }),
      },
    });

    assert.deepEqual(mediumLLM.calls[0]?.reasoning, { effort: 'medium' });
  });
});
