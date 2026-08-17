import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runNpcAgent } from '../../agents/npc/npcAgent';
import { DEFAULT_MODEL } from '../../agents/llm/defaults';
import { QueueLLM } from '../helpers/queueLLM';
import type { DebugEvent } from '../../engine/debug';

describe('NPC agent', () => {
  it('uses strict function-call payload for NPC output', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-npc-1',
        output: [
          {
            type: 'reasoning',
            summary: [
              { type: 'summary_text', text: '**Reading Mira**\n\nThis body should not be persisted into the trace heading.' },
            ],
          },
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
    const debugEvents: DebugEvent[] = [];

    const trace = { llmCalls: [] as Array<{ agent: 'gm' | 'npc' | 'narrator' | 'specialist'; [key: string]: unknown }> };
    const result = await runNpcAgent({
      apiKey: 'test-key',
      npcId: 'mira-salt',
      persona: { name: 'Mira Salt' },
      observation: { nearbyActors: [] },
      conversationHistory: [
        {
          turn: 1,
          role: 'player',
          speakerId: 'player-1',
          speakerName: 'You',
          text: 'What do you see?',
          source: 'playerText',
        },
      ],
      currentTurn: { turn: 1, playerId: 'player-1' },
      llm,
      debug: event => debugEvents.push(event),
      trace,
    });

    assert.equal(result.npcId, 'mira-salt');
    assert.equal(result.publicUtterance, 'Storm coming.');
    assert.equal(result.privateIntent, 'warn_player');
    assert.equal(result.emotionalTone, 'grim');
    assert.equal(trace.llmCalls.length, 1);
    assert.deepEqual(trace.llmCalls[0]?.reasoningHeadings, ['Reading Mira']);
    assert.equal(llm.calls[0]?.model, DEFAULT_MODEL);
    const input = JSON.parse(String(llm.calls[0]?.input));
    assert.equal(input.conversationHistory[0]?.text, 'What do you see?');
    assert.equal(input.currentTurn.turn, 1);
    assert.deepEqual(debugEvents.map(event => event.type), ['npc.started', 'npc.completed']);
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
      conversationHistory: [
        {
          turn: 1,
          role: 'player',
          speakerId: 'player-1',
          speakerName: 'You',
          text: 'What do you see?',
          source: 'playerText',
        },
      ],
      currentTurn: { turn: 1, playerId: 'player-1' },
      llm,
    });

    assert.equal(result.npcId, 'mira-salt');
    assert.equal(result.privateIntent, 'wait');
  });

  it('summarizes older turns when the transcript exceeds the NPC context budget', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-npc-3',
        output: [
          {
            type: 'function_call',
            name: 'emit_npc_turn',
            arguments: '{"publicUtterance":"I remember enough.","privateIntent":"answer","emotionalTone":"steady"}',
            call_id: 'npc-call-3',
          },
        ],
        output_text: '',
      },
    ]);

    const conversationHistory = Array.from({ length: 8 }, (_, index) => ({
      turn: index + 1,
      role: 'player' as const,
      speakerId: 'player-1',
      speakerName: 'You',
      text: `Turn ${index + 1} ${'x'.repeat(2400)}`,
      source: 'playerText' as const,
    }));

    await runNpcAgent({
      apiKey: 'test-key',
      npcId: 'mira-salt',
      persona: { name: 'Mira Salt' },
      observation: { nearbyActors: [] },
      conversationHistory,
      currentTurn: { turn: 8, playerId: 'player-1' },
      llm,
    });

    const input = JSON.parse(String(llm.calls[0]?.input));
    assert.equal(typeof input.olderTurnsSummary, 'string');
    assert.equal(input.olderTurnsSummary.includes('Earlier conversation from turns 1-'), true);
    assert.equal(input.conversationHistory.some((entry: { turn: number }) => entry.turn === 1), false);
    assert.equal(input.conversationHistory.some((entry: { turn: number }) => entry.turn === 8), true);
  });
});
