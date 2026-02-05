import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runNpcAgent } from '../../agents/npc/npcAgent';
import { QueueLLM } from '../helpers/queueLLM';

describe('NPC agent', () => {
  it('uses strict function-call payload for NPC output', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-npc-1',
        output: [
          {
            type: 'function_call',
            name: 'emit_npc_turn',
            arguments: '{"publicUtterance":"Storm coming.","privateIntent":"warn_player","emotionalTone":"grim"}',
            call_id: 'npc-call-1',
          },
        ],
        output_text: '',
      },
    ]);

    const trace = { llmCalls: [] as Array<{ agent: 'gm' | 'npc' | 'narrator'; [key: string]: unknown }> };
    const result = await runNpcAgent({
      apiKey: 'test-key',
      npcId: 'mira-salt',
      persona: { name: 'Mira Salt' },
      observation: { nearbyActors: [] },
      playerText: 'What do you see?',
      llm,
      trace,
    });

    assert.equal(result.npcId, 'mira-salt');
    assert.equal(result.publicUtterance, 'Storm coming.');
    assert.equal(result.privateIntent, 'warn_player');
    assert.equal(result.emotionalTone, 'grim');
    assert.equal(trace.llmCalls.length, 1);
  });

  it('falls back deterministically when function-call payload is missing', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-npc-2',
        output: [],
        output_text: 'non-structured text',
      },
    ]);

    const result = await runNpcAgent({
      apiKey: 'test-key',
      npcId: 'mira-salt',
      persona: { name: 'Mira Salt' },
      observation: { nearbyActors: [] },
      playerText: 'What do you see?',
      llm,
    });

    assert.equal(result.npcId, 'mira-salt');
    assert.equal(result.privateIntent, 'wait');
  });
});
