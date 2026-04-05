import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_MODEL } from '../../agents/llm/defaults';
import { narrateOpening, narrateTurn } from '../../agents/narrator/narratorAgent';
import { QueueLLM } from '../helpers/queueLLM';
import type { LLMClient } from '../../agents/llm/types';
import type { DebugEvent } from '../../engine/debug';

const telemetry = {
  location: { name: 'The Landing', description: 'Mist hangs over the stones.' },
} as any;

const openingContext = {
  isFirstWorldMessage: true,
  focusLocation: {
    id: 'the-landing',
    name: 'The Landing',
    description: 'Mist hangs over the stones.',
  },
  focalLocal: {
    id: 'tamar-vane',
    name: 'Tamar Vane',
    role: 'dockhand',
    stance: 'Brisk, tide-wise, unsentimental.',
  },
  openingHook: 'Tamar Vane has paused halfway through the dawn rope-check at the outer pilings.',
  playerQuestion: 'Why has Tamar Vane broken his routine at the docks?',
} as const;

const diff = {
  moved: false,
  newItems: [],
  timeDeltaMinutes: 0,
} as any;

describe('narrator streaming', () => {
  it('emits deltas in live mode and returns final narration text', async () => {
    const llm = new QueueLLM([
      {
        output: [],
        output_text: 'The tide turns and the harbor lights wake.',
      },
    ]);
    const deltas: string[] = [];
    const debugEvents: DebugEvent[] = [];

    const narration = await narrateTurn({
      apiKey: 'test-key',
      playerText: 'Look to sea',
      telemetry,
      diff,
      recentTurns: [],
      llm,
      debug: event => debugEvents.push(event),
      onNarrationDelta: delta => deltas.push(delta),
    });

    assert.equal(narration, 'The tide turns and the harbor lights wake.');
    assert.deepEqual(deltas, ['The tide turns and the harbor lights wake.']);
    assert.equal(llm.calls[0]?.model, DEFAULT_MODEL);
    assert.deepEqual(debugEvents.map(event => event.type), ['narrator.started', 'narrator.completed']);
  });

  it('emits a single fallback chunk with no api key', async () => {
    const llm = new QueueLLM([]);
    const deltas: string[] = [];

    const narration = await narrateTurn({
      playerText: 'Wait',
      telemetry,
      diff,
      recentTurns: [],
      llm,
      onNarrationDelta: delta => deltas.push(delta),
    });

    assert.equal(deltas.length, 1);
    assert.equal(narration, deltas[0]);
  });

  it('streams opening deltas in live mode', async () => {
    const llm = new QueueLLM([
      {
        output: [],
        output_text: 'Fog glows amber above the old pier.',
      },
    ]);
    const deltas: string[] = [];

    const opening = await narrateOpening({
      apiKey: 'test-key',
      openingMode: 'first-world',
      openingContext,
      telemetry,
      llm,
      onOpeningDelta: delta => deltas.push(delta),
    });

    assert.equal(opening, 'Fog glows amber above the old pier.');
    assert.deepEqual(deltas, ['Fog glows amber above the old pier.']);
    assert.equal(llm.calls[0]?.model, DEFAULT_MODEL);
    const input = JSON.parse(String(llm.calls[0]?.input));
    assert.equal(input.openingMode, 'first-world');
    assert.deepEqual(input.openingContext, openingContext);
    assert.ok(String(llm.calls[0]?.instructions).includes('absolute first message'));
  });

  it('uses resume-mode opening instructions when reopening an existing session', async () => {
    const llm = new QueueLLM([
      {
        output: [],
        output_text: 'The old pier waits where you left it.',
      },
    ]);

    await narrateOpening({
      apiKey: 'test-key',
      openingMode: 'resume',
      telemetry,
      llm,
    });

    const input = JSON.parse(String(llm.calls[0]?.input));
    assert.equal(input.openingMode, 'resume');
    assert.equal(input.openingContext, null);
    assert.ok(String(llm.calls[0]?.instructions).includes('reorients the player'));
  });

  it('uses authored opener beats in first-world fallback mode', async () => {
    const llm = new QueueLLM([]);

    const opening = await narrateOpening({
      openingMode: 'first-world',
      openingContext,
      telemetry,
      llm,
    });

    assert.ok(opening.includes('first light'));
    assert.ok(opening.includes('Tamar Vane'));
    assert.ok(opening.includes('Why has Tamar Vane broken his routine at the docks?'));
  });

  it('uses streamed deltas when streamed response output_text is empty', async () => {
    const llm: LLMClient = {
      async responsesCreate(params) {
        params.onOutputTextDelta?.('A gull wheels above the bones.');
        return {
          id: 'streamed-empty-output-text',
          status: 'completed',
          output: [],
          output_text: '',
        };
      },
    };
    const deltas: string[] = [];
    const narration = await narrateTurn({
      apiKey: 'test-key',
      playerText: 'look up',
      telemetry,
      diff,
      recentTurns: [],
      llm,
      onNarrationDelta: delta => deltas.push(delta),
    });

    assert.equal(narration, 'A gull wheels above the bones.');
    assert.deepEqual(deltas, ['A gull wheels above the bones.']);
  });

  it('includes recent turn digests in narrator input', async () => {
    const llm = new QueueLLM([
      {
        output: [],
        output_text: 'The market shutters clatter in the wind.',
      },
    ]);

    await narrateTurn({
      apiKey: 'test-key',
      playerText: 'head north',
      telemetry,
      diff,
      recentTurns: [
        {
          turn: 1,
          playerText: 'go to the rib market',
          narration: 'You set out toward the market.',
          accepted: ['Traveled to Dock Approach'],
          rejected: [],
        },
      ],
      llm,
    });

    const input = JSON.parse(String(llm.calls[0]?.input));
    assert.deepEqual(input.recentTurns, [
      {
        turn: 1,
        playerText: 'go to the rib market',
        narration: 'You set out toward the market.',
        accepted: ['Traveled to Dock Approach'],
        rejected: [],
      },
    ]);
  });
});
