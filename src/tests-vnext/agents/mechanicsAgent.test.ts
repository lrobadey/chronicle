import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MECHANICS_FALLBACK_MODEL, MECHANICS_MODEL } from '../../agents/llm/defaults';
import { attachResolutionMetadata, runMechanicsAgent } from '../../agents/mechanics';
import { QueueLLM } from '../helpers/queueLLM';

describe('mechanics agent', () => {
  it('resolves obvious travel commands deterministically before calling the model', async () => {
    const llm = new QueueLLM([]);

    const result = await runMechanicsAgent({
      apiKey: 'test-key',
      request: {
        playerText: 'I got the dock approach',
        pendingPrompt: null,
        telemetry: { turn: 1, player: { id: 'player-1' } },
        travelCandidates: [{ id: 'dock-approach', name: 'Dock Approach', aliases: ['dock approach', 'docks'], distanceMeters: 140, estimatedWalkMinutes: 1, blockedNow: false, requiresConfirm: false }],
        nearby: { actors: [], itemsOnGround: [] },
        landmarks: [{ id: 'dock-approach', name: 'Dock Approach' }],
        observation: { nearbyLocations: [] },
      },
      llm,
      trace: { llmCalls: [] },
    });

    assert.equal(llm.calls.length, 0);
    assert.equal(result.status, 'ok');
    assert.equal(result.interpretation, 'travel');
    assert.equal(result.actions[0]?.type, 'travel');
    assert.equal(result.debug?.selectedModel, 'deterministic');
  });

  it('uses the mini model by default when deterministic resolution does not apply', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-mech-1',
        output: [
          {
            type: 'function_call',
            name: 'emit_mechanics_resolution',
            arguments:
              '{"interpretation":"inspect","summary":"inspect the mug","actions":[{"type":"inspect","actorId":"player-1","subject":"mug","note":"Inspect the mug."}],"pendingPrompt":null,"touchedEntities":["player-1","mug"],"confidence":0.93,"warnings":[]}',
            call_id: 'mechanics-call-1',
          },
        ],
        output_text: '',
      },
    ]);

    const result = await runMechanicsAgent({
      apiKey: 'test-key',
      request: {
        playerText: 'I inspect the mug',
        pendingPrompt: null,
        telemetry: { turn: 1, player: { id: 'player-1' } },
        travelCandidates: [],
        nearby: { actors: [], itemsOnGround: [] },
        landmarks: [],
        observation: { nearbyItems: [{ id: 'mug' }] },
      },
      llm,
      trace: { llmCalls: [] },
    });

    assert.equal(llm.calls[0]?.model, MECHANICS_MODEL);
    assert.deepEqual(llm.calls[0]?.reasoning, { effort: 'minimal' });
    assert.ok(String(llm.calls[0]?.input).includes('"travelCandidates"'));
    assert.equal(result.status, 'ok');
    assert.equal(result.interpretation, 'inspect');
    assert.equal(result.actions[0]?.type, 'inspect');
    assert.equal(result.debug?.selectedModel, MECHANICS_MODEL);
  });

  it('falls back to the configured stronger model only when the first model fails the output contract', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-mech-1',
        output: [],
        output_text: 'not structured',
      },
      {
        id: 'resp-mech-2',
        output: [
          {
            type: 'function_call',
            name: 'emit_mechanics_resolution',
            arguments:
              '{"interpretation":"inspect","summary":"inspect the mug","actions":[{"type":"inspect","actorId":"player-1","subject":"mug","note":"Inspect the mug."}],"pendingPrompt":null,"touchedEntities":["player-1","mug"],"confidence":0.82,"warnings":["retried"]}',
            call_id: 'mechanics-call-2',
          },
        ],
        output_text: '',
      },
    ]);

    const result = await runMechanicsAgent({
      apiKey: 'test-key',
      request: {
        playerText: 'I inspect the mug',
        pendingPrompt: null,
        telemetry: { turn: 1, player: { id: 'player-1' } },
        travelCandidates: [],
        nearby: { actors: [], itemsOnGround: [] },
        landmarks: [],
        observation: { nearbyItems: [{ id: 'mug' }] },
      },
      llm,
    });

    assert.equal(llm.calls[0]?.model, MECHANICS_MODEL);
    assert.equal(llm.calls[1]?.model, MECHANICS_FALLBACK_MODEL);
    assert.equal(result.status, 'ok');
    assert.equal(result.interpretation, 'inspect');
    assert.equal(result.debug?.usedFallback, true);
  });

  it('surfaces contract failures distinctly from valid no-safe-action results', async () => {
    const contractFailureLLM = new QueueLLM([
      {
        id: 'resp-mech-1',
        output: [],
        output_text: 'not structured',
      },
      {
        id: 'resp-mech-2',
        output: [],
        output_text: 'still not structured',
      },
    ]);

    const contractFailure = await runMechanicsAgent({
      apiKey: 'test-key',
      request: {
        playerText: 'I inspect the mug',
        pendingPrompt: null,
        telemetry: { turn: 1, player: { id: 'player-1' } },
        travelCandidates: [],
        nearby: { actors: [], itemsOnGround: [] },
        landmarks: [],
        observation: { nearbyItems: [{ id: 'mug', name: 'Tin Mug' }] },
      },
      llm: contractFailureLLM,
    });

    assert.equal(contractFailure.status, 'worker_contract_failed');
    assert.equal(contractFailure.summary, 'worker failed to produce a valid draft');
    assert.equal(contractFailure.debug?.failureReason, 'missing_function_output');

    const noneLLM = new QueueLLM([
      {
        id: 'resp-mech-3',
        output: [
          {
            type: 'function_call',
            name: 'emit_mechanics_resolution',
            arguments:
              '{"interpretation":"none","summary":"no safe action found","actions":[],"pendingPrompt":null,"touchedEntities":[],"confidence":0.31,"warnings":[]}',
            call_id: 'mechanics-call-3',
          },
        ],
        output_text: '',
      },
    ]);

    const noSafeAction = await runMechanicsAgent({
      apiKey: 'test-key',
      request: {
        playerText: 'I hum to myself',
        pendingPrompt: null,
        telemetry: { turn: 1, player: { id: 'player-1' } },
        travelCandidates: [],
        nearby: { actors: [], itemsOnGround: [] },
        landmarks: [],
        observation: {},
      },
      llm: noneLLM,
    });

    assert.equal(noSafeAction.status, 'no_safe_action');
    assert.equal(noSafeAction.summary, 'no safe action found');
  });

  it('materializes pending prompt metadata and converts actions to world events when attaching a resolution id', () => {
    const resolution = attachResolutionMetadata(
      {
        status: 'ok',
        interpretation: 'clarify',
        summary: 'ask which mug the player means',
        actions: [{ type: 'travel', actorId: 'player-1', locationId: 'dock-approach', pace: 'walk', note: 'Go there.' }],
        pendingPromptDraft: {
          kind: 'clarify_target',
          question: 'Which mug do you mean?',
          options: [{ key: 'tin-mug', label: 'Tin mug' }],
          data: { subject: 'mug' },
        },
        touchedEntities: ['mug'],
        confidence: 0.45,
        warnings: [],
      },
      'res-clarify',
      null,
      3,
    );

    assert.equal(resolution.resolutionId, 'res-clarify');
    assert.equal(resolution.pendingPrompt?.createdTurn, 3);
    assert.equal(resolution.pendingPrompt?.kind, 'clarify_target');
    assert.equal(resolution.candidateEvents[0]?.type, 'TravelToLocation');
  });
});
