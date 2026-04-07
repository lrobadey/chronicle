import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildNPCConversationContext } from '../../engine/contextBuilders';
import type { TurnRecord } from '../../engine/session/types';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';

describe('contextBuilders', () => {
  it('reconstructs player-facing NPC conversation history in turn order and tolerates sparse records', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: '2025-01-01T14:00:00Z' });
    world.meta.openingNarration = 'Dawn light catches the pilings.';

    const turnHistory: TurnRecord[] = [
      {
        sessionId: 'session-1',
        turn: 1,
        atIso: '2025-01-01T14:01:00.000Z',
        playerId: 'player-1',
        playerText: 'What did the tide leave here?',
        acceptedEvents: [],
        rejectedEvents: [],
        npcOutputs: [
          {
            npcId: 'tamar-vane',
            publicUtterance: 'Kelp too high for this tide.',
            privateIntent: 'warn_player',
          },
          {
            npcId: 'mira-salt',
            publicUtterance: 'And it is fresh.',
            privateIntent: 'reinforce_warning',
          },
        ],
        narration: 'The dock ropes creak in the wind.',
      },
      {
        sessionId: 'session-1',
        turn: 2,
        atIso: '2025-01-01T14:02:00.000Z',
        playerId: 'player-1',
        playerText: 'Show me the mark.',
        acceptedEvents: [],
        rejectedEvents: [],
      },
    ];

    const context = buildNPCConversationContext({
      state: world,
      turnHistory,
      playerId: 'player-1',
      playerText: 'Who else saw it?',
      nextTurn: 3,
    });

    assert.deepEqual(context, {
      conversationHistory: [
        {
          turn: 0,
          role: 'opening',
          speakerName: 'Narrator',
          text: 'Dawn light catches the pilings.',
          source: 'openingNarration',
        },
        {
          turn: 1,
          role: 'player',
          speakerId: 'player-1',
          speakerName: 'You',
          text: 'What did the tide leave here?',
          source: 'playerText',
        },
        {
          turn: 1,
          role: 'npc',
          speakerId: 'tamar-vane',
          speakerName: 'Tamar Vane',
          text: 'Kelp too high for this tide.',
          source: 'npcPublicUtterance',
        },
        {
          turn: 1,
          role: 'npc',
          speakerId: 'mira-salt',
          speakerName: 'Mira Salt',
          text: 'And it is fresh.',
          source: 'npcPublicUtterance',
        },
        {
          turn: 1,
          role: 'narrator',
          speakerName: 'Narrator',
          text: 'The dock ropes creak in the wind.',
          source: 'turnNarration',
        },
        {
          turn: 2,
          role: 'player',
          speakerId: 'player-1',
          speakerName: 'You',
          text: 'Show me the mark.',
          source: 'playerText',
        },
        {
          turn: 3,
          role: 'player',
          speakerId: 'player-1',
          speakerName: 'You',
          text: 'Who else saw it?',
          source: 'playerText',
        },
      ],
    });
  });

  it('omits blank transcript entries and works without opening narration', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: '2025-01-01T14:00:00Z' });
    delete world.meta.openingNarration;

    const turnHistory: TurnRecord[] = [
      {
        sessionId: 'session-2',
        turn: 1,
        atIso: '2025-01-01T14:01:00.000Z',
        playerId: 'player-1',
        playerText: '   look closer   ',
        acceptedEvents: [],
        rejectedEvents: [],
        npcOutputs: [
          {
            npcId: 'tamar-vane',
            publicUtterance: '   ',
            privateIntent: 'hold_back',
          },
        ],
        narration: '   ',
      },
    ];

    const context = buildNPCConversationContext({
      state: world,
      turnHistory,
      playerId: 'player-1',
      playerText: 'keep watching',
      nextTurn: 2,
    });

    assert.deepEqual(context.conversationHistory, [
      {
        turn: 1,
        role: 'player',
        speakerId: 'player-1',
        speakerName: 'You',
        text: 'look closer',
        source: 'playerText',
      },
      {
        turn: 2,
        role: 'player',
        speakerId: 'player-1',
        speakerName: 'You',
        text: 'keep watching',
        source: 'playerText',
      },
    ]);
  });
});
