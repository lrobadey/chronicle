import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNPCConversationContext,
  buildRecentSpeechDigests,
  buildWebTranscriptHistory,
  buildWebTurnSummary,
} from '../../engine/contextBuilders';
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
        turnSpeech: [
          {
            speakerActorId: 'tamar-vane',
            speakerName: 'Tamar Vane',
            text: 'Kelp too high for this tide.',
            recipientActorIds: ['player-1'],
            recipientNames: ['You'],
            source: 'npc_consult',
          },
          {
            speakerActorId: 'mira-salt',
            speakerName: 'Mira Salt',
            text: 'And it is fresh.',
            recipientActorIds: ['player-1'],
            recipientNames: ['You'],
            source: 'npc_consult',
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
        turnSpeech: [
          {
            speakerActorId: 'tamar-vane',
            speakerName: 'Tamar Vane',
            text: '   ',
            recipientActorIds: [],
            recipientNames: [],
            source: 'npc_consult',
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

  it('builds bounded recent speech digests from persisted structured speech', () => {
    const turnHistory: TurnRecord[] = [
      {
        sessionId: 'session-4',
        turn: 1,
        atIso: '2025-01-01T14:01:00.000Z',
        playerId: 'player-1',
        playerText: 'hello',
        acceptedEvents: [],
        rejectedEvents: [],
        turnSpeech: [
          {
            speakerActorId: 'tamar-vane',
            speakerName: 'Tamar Vane',
            text: 'Keep your hands dry.',
            recipientActorIds: ['player-1'],
            recipientNames: ['You'],
            source: 'speak_event',
          },
        ],
      },
    ];

    assert.deepEqual(buildRecentSpeechDigests(turnHistory), [
      {
        turn: 1,
        speakerActorId: 'tamar-vane',
        speakerName: 'Tamar Vane',
        text: 'Keep your hands dry.',
        recipientActorIds: ['player-1'],
        recipientNames: ['You'],
      },
    ]);
  });

  it('builds web transcript history with bounded recent turns and a collapsed older summary', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: '2025-01-01T14:00:00Z' });
    const turnHistory: TurnRecord[] = Array.from({ length: 12 }, (_, index) => ({
      sessionId: 'session-3',
      turn: index + 1,
      atIso: `2025-01-01T14:${String(index).padStart(2, '0')}:00.000Z`,
      playerId: 'player-1',
      playerText: `action ${index + 1}`,
      acceptedEvents: [],
      rejectedEvents: index % 2 === 0 ? [] : [{ event: { type: 'Inspect', actorId: 'player-1', subject: 'pilings' }, reason: 'no_effect' }],
      narration: `narration ${index + 1}`,
    }));

    const history = buildWebTranscriptHistory(world, turnHistory);

    assert.equal(history.totalTurns, 12);
    assert.equal(history.recentTurns.length, 10);
    assert.equal(history.recentTurns[0]?.turn, 3);
    assert.equal(history.recentTurns[9]?.turn, 12);
    assert.deepEqual(history.olderSummary, {
      fromTurn: 1,
      toTurn: 2,
      turnCount: 2,
      headline: '2 earlier turns led here',
      highlights: [
        'Turn 1: action 1',
        'Turn 2: action 2 -> No material change',
      ],
    });
  });

  it('prefers diff summaries for web result strips and falls back to subtle failure copy', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: '2025-01-01T14:00:00Z' });

    assert.deepEqual(buildWebTurnSummary(world, {
      acceptedEvents: [],
      rejectedEvents: [],
      diffSummary: 'Moved to the Bone Market',
    }), {
      headline: 'Moved to the Bone Market',
      accepted: [],
      rejected: [],
      outcome: 'quiet',
    });

    assert.deepEqual(buildWebTurnSummary(world, {
      acceptedEvents: [],
      rejectedEvents: [{ event: { type: 'Inspect', actorId: 'player-1', subject: 'door' }, reason: 'blocked_by_tide' }],
    }), {
      headline: 'No material change',
      accepted: [],
      rejected: ['blocked_by_tide'],
      outcome: 'blocked',
    });
  });
});
