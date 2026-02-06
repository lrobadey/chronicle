import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { narrateOpening, narrateTurn } from '../../agents/narrator/narratorAgent';
import { QueueLLM } from '../helpers/queueLLM';

const telemetry = {
  location: { name: 'The Landing', description: 'Mist hangs over the stones.' },
} as any;

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

    const narration = await narrateTurn({
      apiKey: 'test-key',
      playerText: 'Look to sea',
      telemetry,
      diff,
      llm,
      onNarrationDelta: delta => deltas.push(delta),
    });

    assert.equal(narration, 'The tide turns and the harbor lights wake.');
    assert.deepEqual(deltas, ['The tide turns and the harbor lights wake.']);
  });

  it('emits a single fallback chunk with no api key', async () => {
    const llm = new QueueLLM([]);
    const deltas: string[] = [];

    const narration = await narrateTurn({
      playerText: 'Wait',
      telemetry,
      diff,
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
      telemetry,
      llm,
      onOpeningDelta: delta => deltas.push(delta),
    });

    assert.equal(opening, 'Fog glows amber above the old pier.');
    assert.deepEqual(deltas, ['Fog glows amber above the old pier.']);
  });
});
