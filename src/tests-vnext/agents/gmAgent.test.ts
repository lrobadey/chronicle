import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runGMAgent } from '../../agents/gm/gmAgent';
import { QueueLLM } from '../helpers/queueLLM';

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
    assert.equal(secondCall.previous_response_id, 'resp-first');

    const secondInput = secondCall.input;
    assert.equal(Array.isArray(secondInput), true);
    const outputItems = (secondInput as Array<Record<string, unknown>>).filter(item => item.type === 'function_call_output');
    assert.equal(outputItems.length, 2);
    assert.equal((secondInput as Array<Record<string, unknown>>).every(item => item.type === 'function_call_output'), true);
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
});
