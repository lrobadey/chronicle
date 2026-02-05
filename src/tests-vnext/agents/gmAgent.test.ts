import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runGMAgent } from '../../agents/gm/gmAgent';
import { QueueLLM } from '../helpers/queueLLM';

describe('GM agent loop', () => {
  it('handles multiple tool calls and explicit finish', async () => {
    let observeCalls = 0;
    let consultCalls = 0;
    let proposeCalls = 0;
    let finishCalls = 0;

    const observeWorld = async () => {
      observeCalls += 1;
      return { ok: true };
    };
    const consultNpc = async () => {
      consultCalls += 1;
      return { npcId: 'mira-salt', publicUtterance: '...', privateIntent: 'watch' };
    };
    const proposeEvents = async () => {
      proposeCalls += 1;
      return { ok: true, accepted: 1, rejected: 0 };
    };
    const finishTurn = async () => {
      finishCalls += 1;
      return { ok: true };
    };

    const llm = new QueueLLM([
      {
        output: [
          { type: 'function_call', name: 'observe_world', arguments: '{"perspective":"gm"}', call_id: 'c1' },
          { type: 'function_call', name: 'propose_events', arguments: '{"events":[]}', call_id: 'c2' },
        ],
        output_text: '',
      },
      {
        output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'c3' }],
        output_text: '',
      },
    ]);

    const result = await runGMAgent({
      apiKey: 'test-key',
      playerText: 'advance',
      llm,
      runtime: {
        observe_world: observeWorld,
        consult_npc: consultNpc,
        propose_events: proposeEvents,
        finish_turn: finishTurn,
      },
      trace: { toolCalls: [] },
    });

    assert.equal(result.finished, true);
    assert.equal(observeCalls, 1);
    assert.equal(consultCalls, 0);
    assert.equal(proposeCalls, 1);
    assert.equal(finishCalls, 1);

    const secondCallInput = llm.calls[1]?.input;
    assert.equal(Array.isArray(secondCallInput), true);
    const outputs = (secondCallInput as Array<Record<string, unknown>>).filter(item => item.type === 'function_call_output');
    const callIds = outputs.map(item => item.call_id);
    assert.ok(callIds.includes('c1'));
    assert.ok(callIds.includes('c2'));
  });
});
