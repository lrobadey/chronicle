import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTranscriptEntries,
  createPendingTurnEntry,
  finalizeTurnCard,
  latestTurnEntry,
  replaceTurnEntry,
  updatePendingNarration,
} from '../../web/model';

describe('web model', () => {
  it('uses opening narration when there is no prior history', () => {
    assert.deepEqual(buildTranscriptEntries({
      initialNarration: 'The tide is out.',
      history: { totalTurns: 0, recentTurns: [] },
    }), [
      { kind: 'opening', id: 'opening', text: 'The tide is out.' },
    ]);
  });

  it('prefers older summary and recent turns when resuming history', () => {
    const entries = buildTranscriptEntries({
      initialNarration: 'Unused opening',
      history: {
        totalTurns: 2,
        olderSummary: {
          fromTurn: 1,
          toTurn: 1,
          turnCount: 1,
          headline: '1 earlier turn led here',
          highlights: ['Turn 1: asked about the pilings'],
        },
        recentTurns: [
          {
            turn: 2,
            atIso: '2025-01-01T14:02:00.000Z',
            playerText: 'Go inside.',
            narration: 'You step through the iron door.',
            summary: {
              headline: 'Moved to the tower interior',
              accepted: ['Moved to the tower interior'],
              rejected: [],
              outcome: 'progress',
            },
          },
        ],
      },
    });

    assert.equal(entries[0]?.kind, 'older-summary');
    assert.equal(entries[1]?.kind, 'turn');
    assert.equal(entries[1]?.turn, 2);
  });

  it('updates a pending turn in place as narration streams and finalizes', () => {
    const pending = createPendingTurnEntry({
      turn: 3,
      playerText: 'Climb the stair.',
      atIso: '2025-01-01T14:03:00.000Z',
    });

    const withNarration = updatePendingNarration([pending], 3, 'The stair complains under your weight.');
    assert.equal(withNarration[0]?.kind, 'turn');
    assert.equal(withNarration[0]?.narration, 'The stair complains under your weight.');

    const finalized = finalizeTurnCard({
      turn: 3,
      atIso: '2025-01-01T14:03:30.000Z',
      playerText: 'Climb the stair.',
      narration: 'The stair complains under your weight.',
      summary: {
        headline: 'Moved to the upper landing',
        accepted: ['Moved to the upper landing'],
        rejected: [],
        outcome: 'progress',
      },
      trace: {
        toolCalls: [],
        llmCalls: [
          {
            agent: 'npc',
            responseId: 'resp-1',
            reasoningHeadings: ['Reading the landing'],
          },
        ],
      },
    });

    const replaced = replaceTurnEntry(withNarration, finalized);
    const latest = latestTurnEntry(replaced);
    assert.equal(latest?.pending, false);
    assert.equal(latest?.summary?.headline, 'Moved to the upper landing');
    assert.equal(latest?.narration, 'The stair complains under your weight.');
    assert.deepEqual(latest?.trace?.llmCalls?.[0]?.reasoningHeadings, ['Reading the landing']);
  });
});
