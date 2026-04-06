import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MECHANICS_FALLBACK_MODEL, MECHANICS_MODEL } from '../../agents/llm/defaults';
import { attachResolutionMetadata, runMechanicsAgent } from '../../agents/mechanics';
import { MECHANICS_SYSTEM_PROMPT } from '../../agents/mechanics/prompts';
import { QueueLLM } from '../helpers/queueLLM';

describe('mechanics agent', () => {
  it('resolves obvious travel commands deterministically before calling the model', async () => {
    const llm = new QueueLLM([]);

    const result = await runMechanicsAgent({
      apiKey: 'test-key',
      request: {
        playerText: 'I got to the dock approach',
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
    assert.deepEqual(llm.calls[0]?.reasoning, { effort: 'medium' });
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

  it('skips deterministic resolution when revisionFeedback is present', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-revision-1',
        output: [
          {
            type: 'function_call',
            name: 'emit_mechanics_resolution',
            arguments:
              '{"interpretation":"travel","summary":"travel to lighthouse-02","actions":[{"type":"travel","actorId":"player-1","locationId":"lighthouse-02","pace":"walk","confirmId":null,"note":null}],"pendingPrompt":null,"touchedEntities":["player-1","lighthouse-02"],"confidence":0.91,"warnings":[]}',
            call_id: 'revision-call-1',
          },
        ],
        output_text: '',
      },
    ]);

    const result = await runMechanicsAgent({
      apiKey: 'test-key',
      request: {
        playerText: 'go to the lighthouse',
        revisionFeedback: 'locationId should be lighthouse-02, not lighthouse-01',
        pendingPrompt: null,
        telemetry: { turn: 1, player: { id: 'player-1' } },
        travelCandidates: [
          { id: 'lighthouse-01', name: 'Lighthouse', aliases: ['lighthouse'], distanceMeters: 400, estimatedWalkMinutes: 5, blockedNow: false, requiresConfirm: false },
          { id: 'lighthouse-02', name: 'Old Lighthouse', aliases: ['old lighthouse'], distanceMeters: 600, estimatedWalkMinutes: 8, blockedNow: false, requiresConfirm: false },
        ],
        nearby: { actors: [], itemsOnGround: [] },
        landmarks: [],
        observation: {},
      },
      llm,
      trace: { llmCalls: [] },
    });

    assert.equal(llm.calls.length, 1, 'must call LLM, not use deterministic path');
    assert.notEqual(result.debug?.selectedModel, 'deterministic');
    assert.equal(result.status, 'ok');
    assert.equal(result.interpretation, 'travel');
    assert.equal((result.actions[0] as { locationId?: string })?.locationId, 'lighthouse-02');
  });

  it('does not deterministically resolve travel to a blocked location', async () => {
    const llm = new QueueLLM([]);

    const result = await runMechanicsAgent({
      apiKey: 'test-key',
      request: {
        playerText: 'go to the market',
        pendingPrompt: null,
        telemetry: { turn: 1, player: { id: 'player-1' } },
        travelCandidates: [
          { id: 'market-01', name: 'Market', aliases: ['market'], distanceMeters: 100, estimatedWalkMinutes: 1, blockedNow: true, requiresConfirm: false },
        ],
        nearby: { actors: [], itemsOnGround: [] },
        landmarks: [],
        observation: {},
      },
      llm,
      trace: { llmCalls: [] },
    });

    assert.notEqual(result.debug?.selectedModel, 'deterministic');
  });

  it('selects unblocked candidate deterministically when a blocked candidate also matches', async () => {
    const llm = new QueueLLM([]);

    const result = await runMechanicsAgent({
      apiKey: 'test-key',
      request: {
        playerText: 'go to the tavern',
        pendingPrompt: null,
        telemetry: { turn: 1, player: { id: 'player-1' } },
        travelCandidates: [
          { id: 'old-tavern', name: 'Old Tavern', aliases: ['tavern'], distanceMeters: 50, estimatedWalkMinutes: 1, blockedNow: true, requiresConfirm: false },
          { id: 'new-tavern', name: 'New Tavern', aliases: ['tavern'], distanceMeters: 80, estimatedWalkMinutes: 1, blockedNow: false, requiresConfirm: false },
        ],
        nearby: { actors: [], itemsOnGround: [] },
        landmarks: [],
        observation: {},
      },
      llm,
      trace: { llmCalls: [] },
    });

    assert.equal(result.debug?.selectedModel, 'deterministic');
    assert.equal(result.status, 'ok');
    assert.equal(result.interpretation, 'travel');
    assert.equal((result.actions[0] as { locationId?: string })?.locationId, 'new-tavern');
  });

  it('mechanics prompt includes explore and handoff examples', () => {
    assert.ok(MECHANICS_SYSTEM_PROMPT.includes('"type":"explore"'), 'missing explore example');
    assert.ok(MECHANICS_SYSTEM_PROMPT.includes('"type":"handoff"'), 'missing handoff example');
  });

  it('does not trigger travel when player says "I got [item]" without directional to', async () => {
    const llm = new QueueLLM([]);

    const result = await runMechanicsAgent({
      apiKey: 'test-key',
      request: {
        playerText: 'I got the sword',
        pendingPrompt: null,
        telemetry: { turn: 1, player: { id: 'player-1' } },
        travelCandidates: [
          { id: 'sword-shrine', name: 'Sword', aliases: ['sword'], distanceMeters: 300, estimatedWalkMinutes: 4, blockedNow: false, requiresConfirm: false },
        ],
        nearby: { actors: [], itemsOnGround: [] },
        landmarks: [],
        observation: {},
      },
      llm,
      trace: { llmCalls: [] },
    });

    assert.notEqual(result.debug?.selectedModel, 'deterministic');
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
