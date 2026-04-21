import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { TurnEngine } from '../../engine/turnEngine';
import { JsonlSessionStore } from '../../engine/session/jsonlStore';
import type { TurnRecord, TurnTrace } from '../../engine/session/types';
import { buildTelemetry } from '../../sim/views/telemetry';
import { resolveWorldModule } from '../../worlds';
import { OperatorCliEngine } from '../../cli/operatorEngine';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0, roots.length)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function createOperator(root: string) {
  const store = new JsonlSessionStore(root);
  const engine = new TurnEngine({ store });
  const operator = new OperatorCliEngine({ engine, store });
  return { store, operator };
}

function createWorldState() {
  return resolveWorldModule('isle-of-marrow').createWorld();
}

function createTelemetry(note?: string) {
  const world = createWorldState();
  const telemetry = buildTelemetry(world, 'player-1');
  if (note) telemetry.knowledge.notes.push(note);
  return telemetry;
}

function createStewardTrace(): TurnTrace {
  return {
    toolCalls: [
      {
        tool: 'open_steward_turn',
        input: { playerText: 'ask tamar about the tide', pendingPromptId: null },
        output: {
          classification: 'simple_council',
          deterministicOwner: null,
          requiredDomains: ['character'],
          optionalDomains: ['world'],
          heldBeatsToConsider: [],
          pendingEventsToCheck: [],
          rationale: 'The player asked an NPC for a grounded answer.',
          councilTasks: 1,
        },
      },
      {
        tool: 'dispatch_council_task',
        input: {
          domain: 'character',
          taskId: 'character-1',
          directive: 'Answer Tamar in-scene.',
          priority: 'high',
          context: { playerText: 'ask tamar about the tide' },
        },
        output: {
          summary: 'Tamar answers the question directly.',
          warnings: [],
          proposedEventCount: 2,
        },
        stage: 'council_dispatch',
      },
      {
        tool: 'close_steward_turn',
        input: {},
        output: {
          route: 'council',
          proposedEventCount: 2,
        },
      },
      {
        tool: 'finish_steward_turn',
        input: {},
        output: { ok: true },
      },
      {
        tool: 'persist_turn_record',
        input: {},
        output: { ok: true },
        stage: 'persistence',
      },
    ],
    llmCalls: [],
  };
}

function createFallbackTrace(): TurnTrace {
  return {
    toolCalls: [
      {
        tool: 'open_steward_turn',
        input: { playerText: 'do something wild', pendingPromptId: null },
        output: {
          classification: 'steward_judgment',
          deterministicOwner: null,
          requiredDomains: ['character', 'world'],
          optionalDomains: [],
          heldBeatsToConsider: [],
          pendingEventsToCheck: [],
          rationale: 'The move needed broader judgment.',
          councilTasks: 2,
        },
      },
      {
        tool: 'legacy_council_fallback',
        input: { reason: 'the steward could not reconcile the scene cleanly' },
        output: {
          reason: 'the steward could not reconcile the scene cleanly',
          summary: 'Legacy GM stepped in and resolved the turn.',
          candidateEvents: [],
          reasoningNotes: ['Needed broader synthesis.'],
        },
      },
      {
        tool: 'finish_turn',
        input: {},
        output: { ok: true },
      },
      {
        tool: 'persist_turn_record',
        input: {},
        output: { ok: true },
        stage: 'persistence',
      },
    ],
    llmCalls: [],
  };
}

function createStewardJudgmentTrace(): TurnTrace {
  return {
    toolCalls: [
      {
        tool: 'open_steward_turn',
        input: { playerText: 'coordinate the harbor crew and inspect the tide gate', pendingPromptId: null },
        output: {
          classification: 'steward_judgment',
          deterministicOwner: null,
          requiredDomains: ['character', 'world', 'systems'],
          optionalDomains: [],
          heldBeatsToConsider: [],
          pendingEventsToCheck: [],
          rationale: 'The move needed live steward synthesis across multiple domains.',
          councilTasks: 0,
        },
      },
      {
        tool: 'dispatch_character_task',
        input: {
          reason: 'Understand what Tamar and the harbor crew would do next.',
          priority: 'required',
        },
        output: {
          ok: true,
          domain: 'character',
          result: {
            domain: 'character',
            summary: 'Tamar directs the crew toward the gate.',
          },
        },
        agent: 'steward',
      },
      {
        tool: 'dispatch_world_task',
        input: {
          reason: 'Clarify the physical state of the tide gate and dock.',
          priority: 'required',
        },
        output: {
          ok: true,
          domain: 'world',
          result: {
            domain: 'world',
            summary: 'The gate is jammed with kelp and drift.',
          },
        },
        agent: 'steward',
      },
      {
        tool: 'dispatch_systems_task',
        input: {
          reason: 'Check what state changes can be applied safely.',
          priority: 'required',
        },
        output: {
          ok: true,
          domain: 'systems',
          result: {
            domain: 'systems',
            summary: 'The gate can be inspected and cleared this turn.',
            warnings: ['clearance_needs_follow_through'],
          },
        },
        agent: 'steward',
      },
      {
        tool: 'finish_steward_turn',
        input: {
          summary: 'The steward coordinated character, world, and systems guidance.',
        },
        output: { ok: true },
      },
      {
        tool: 'persist_turn_record',
        input: {},
        output: { ok: true },
        stage: 'persistence',
      },
    ],
    llmCalls: [],
  };
}

function createTurnRecord(params: {
  sessionId: string;
  turn: number;
  atIso: string;
  playerText: string;
  narration: string;
  trace: TurnTrace;
  telemetryNote?: string;
  telemetry?: TurnRecord['telemetry'];
  acceptedEvents?: TurnRecord['acceptedEvents'];
  councilArtifacts?: TurnRecord['councilArtifacts'];
}): TurnRecord {
  const telemetry = Object.prototype.hasOwnProperty.call(params, 'telemetry')
    ? params.telemetry
    : createTelemetry(params.telemetryNote);
  return {
    sessionId: params.sessionId,
    turn: params.turn,
    atIso: params.atIso,
    playerId: 'player-1',
    playerText: params.playerText,
    acceptedEvents: params.acceptedEvents || [],
    rejectedEvents: [],
    councilArtifacts: params.councilArtifacts || [
      {
        domain: 'character',
        summary: 'Tamar answers the player directly and keeps the scene grounded.',
        selectedNpcIds: ['tamar-vane'],
        privateIntentNotes: [{ npcId: 'tamar-vane', note: 'Answer plainly.' }],
        publicUtterances: [{ npcId: 'tamar-vane', text: 'The water climbed too high.', emotionalTone: 'grim' }],
      },
    ],
    npcOutputs: [],
    turnSpeech: [],
    specialistOutputs: [],
    narration: params.narration,
    telemetry,
    trace: params.trace,
  };
}

async function seedSessionWithTurns(root: string, sessionId: string, turns: TurnRecord[]) {
  const store = new JsonlSessionStore(root);
  const world = createWorldState();
  world.meta.turn = turns.length;
  await store.saveInitialState(sessionId, createWorldState());
  await store.saveSnapshot(sessionId, world);
  for (const turn of turns) {
    await store.appendTurn(sessionId, turn);
  }
}

async function seedIncompatibleSessionWithTurns(root: string, sessionId: string, turns: TurnRecord[]) {
  const sessionDir = path.join(root, sessionId);
  const initial = createWorldState();
  const snapshot = createWorldState();
  initial.meta.version = 'legacy-v1';
  snapshot.meta.version = 'legacy-v1';
  snapshot.meta.turn = turns.length;
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, 'initial.json'), JSON.stringify(initial, null, 2));
  await fs.writeFile(path.join(sessionDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  await fs.writeFile(
    path.join(sessionDir, 'events.jsonl'),
    `${turns.map(turn => JSON.stringify(turn)).join('\n')}\n`,
  );
}

async function runPythonHelper(args: string[], env: Record<string, string>) {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const child = spawn('python3', ['scripts/last_run_explain.py', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => stdoutChunks.push(chunk));
  child.stderr.on('data', chunk => stderrChunks.push(chunk));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code));
  });

  return {
    exitCode,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
  };
}

describe('last run explain report', () => {
  it('resolves the latest completed session and skips newer empty sessions', async () => {
    const root = await makeTempRoot('chronicle-last-run-');
    const { store, operator } = await createOperator(root);

    const completedTurn = createTurnRecord({
      sessionId: 'session-completed',
      turn: 1,
      atIso: '2026-04-20T10:00:00.000Z',
      playerText: 'ask tamar about the tide',
      narration: 'Tamar answers in a low, practical voice.',
      trace: createStewardTrace(),
      telemetryNote: 'The tide mark is too high on the pilings.',
      acceptedEvents: [
        {
          type: 'RecordClue',
          actorId: 'tamar-vane',
          text: 'The tide reached too high before dawn.',
          subject: 'dock tide-mark',
          note: 'Tamar confirms the anomaly.',
        },
      ],
    });

    await seedSessionWithTurns(root, 'session-completed', [completedTurn]);
    await store.ensureSession('session-empty', {
      worldId: 'isle-of-marrow',
      createWorld: () => createWorldState(),
    });

    const report = await operator.getLastRunExplainReport();

    assert.equal(report.status, 'ok');
    assert.equal(report.sessionId, 'session-completed');
    assert.equal(report.turnCount, 1);
  });

  it('returns a clear no-run report when no completed sessions exist', async () => {
    const root = await makeTempRoot('chronicle-last-run-empty-');
    const { store, operator } = await createOperator(root);

    await store.ensureSession('session-empty', {
      worldId: 'isle-of-marrow',
      createWorld: () => createWorldState(),
    });

    const report = await operator.getLastRunExplainReport();

    assert.equal(report.status, 'no_completed_run');
    assert.match(report.message, /No completed Chronicle run was found yet/);
    assert.equal(report.turnCount, 0);
  });

  it('skips newer incompatible sessions when resolving the latest completed run', async () => {
    const root = await makeTempRoot('chronicle-last-run-incompatible-');
    const { operator } = await createOperator(root);

    const compatibleTurn = createTurnRecord({
      sessionId: 'session-compatible',
      turn: 1,
      atIso: '2026-04-20T10:00:00.000Z',
      playerText: 'ask tamar about the tide',
      narration: 'Tamar answers in a low, practical voice.',
      trace: createStewardTrace(),
    });
    const incompatibleTurn = createTurnRecord({
      sessionId: 'session-incompatible',
      turn: 1,
      atIso: '2026-04-20T11:00:00.000Z',
      playerText: 'do something wild',
      narration: 'The marrow wind answers with an uneasy stillness.',
      trace: createFallbackTrace(),
    });

    await seedSessionWithTurns(root, 'session-compatible', [compatibleTurn]);
    await seedIncompatibleSessionWithTurns(root, 'session-incompatible', [incompatibleTurn]);

    const report = await operator.getLastRunExplainReport();

    assert.equal(report.status, 'ok');
    assert.equal(report.sessionId, 'session-compatible');
  });

  it('reports steward-owned council turns with accepted outcomes and narration', async () => {
    const root = await makeTempRoot('chronicle-last-run-steward-');
    const { operator } = await createOperator(root);

    const turn = createTurnRecord({
      sessionId: 'session-steward',
      turn: 1,
      atIso: '2026-04-20T11:00:00.000Z',
      playerText: 'ask tamar about the tide',
      narration: 'Tamar answers in a low, practical voice.',
      trace: createStewardTrace(),
      telemetryNote: 'The tide mark is too high on the pilings.',
      acceptedEvents: [
        {
          type: 'RecordClue',
          actorId: 'tamar-vane',
          text: 'The tide reached too high before dawn.',
          subject: 'dock tide-mark',
          note: 'Tamar confirms the anomaly.',
        },
      ],
    });

    await seedSessionWithTurns(root, 'session-steward', [turn]);
    const report = await operator.getLastRunExplainReport({ sessionId: 'session-steward' });

    assert.equal(report.status, 'ok');
    assert.equal(report.turns[0]?.ownerLabel, 'owned by character council');
    assert.ok(report.turns[0]?.majorDecisions.some(note => note.includes('Committed outcomes')));
    assert.match(report.turns[0]?.narrationOutcome || '', /The player received narration/);
    assert.match(report.turns[0]?.stateDeltaSummary || '', /Learned|No major changes/);
  });

  it('reports fallback turns with the recorded fallback reason', async () => {
    const root = await makeTempRoot('chronicle-last-run-fallback-');
    const { operator } = await createOperator(root);

    const turn = createTurnRecord({
      sessionId: 'session-fallback',
      turn: 1,
      atIso: '2026-04-20T12:00:00.000Z',
      playerText: 'do something wild',
      narration: 'The marrow wind answers with an uneasy stillness.',
      trace: createFallbackTrace(),
      acceptedEvents: [],
    });

    await seedSessionWithTurns(root, 'session-fallback', [turn]);
    const report = await operator.getLastRunExplainReport({ sessionId: 'session-fallback' });

    assert.equal(report.status, 'ok');
    assert.equal(report.fallbackTurnCount, 1);
    assert.equal(report.turns[0]?.fallbackUsed, true);
    assert.match(report.turns[0]?.fallbackSummary || '', /legacy GM fallback was used/i);
    assert.match(report.turns[0]?.fallbackSummary || '', /could not reconcile the scene cleanly/);
  });

  it('marks state delta as unavailable when a persisted turn has no telemetry', async () => {
    const root = await makeTempRoot('chronicle-last-run-missing-telemetry-');
    const { operator } = await createOperator(root);

    const turn = createTurnRecord({
      sessionId: 'session-missing-telemetry',
      turn: 1,
      atIso: '2026-04-20T12:30:00.000Z',
      playerText: 'ask tamar about the tide',
      narration: 'Tamar hesitates, then points toward the pilings.',
      trace: createStewardTrace(),
      telemetry: undefined,
      acceptedEvents: [
        {
          type: 'RecordClue',
          actorId: 'tamar-vane',
          text: 'The tide reached too high before dawn.',
          subject: 'dock tide-mark',
          note: 'Tamar confirms the anomaly.',
        },
      ],
    });

    await seedSessionWithTurns(root, 'session-missing-telemetry', [turn]);
    const report = await operator.getLastRunExplainReport({ sessionId: 'session-missing-telemetry' });

    assert.equal(report.status, 'ok');
    assert.match(
      report.turns[0]?.stateDeltaSummary || '',
      /persisted telemetry was not detailed enough to explain the delta cleanly/i,
    );
  });

  it('keeps the last real telemetry baseline after a telemetry gap', async () => {
    const root = await makeTempRoot('chronicle-last-run-telemetry-gap-');
    const { operator } = await createOperator(root);

    const turnOne = createTurnRecord({
      sessionId: 'session-telemetry-gap',
      turn: 1,
      atIso: '2026-04-20T12:40:00.000Z',
      playerText: 'ask tamar about the tide',
      narration: 'Tamar points to an old salt line on the dock.',
      trace: createStewardTrace(),
      telemetry: createTelemetry('The old salt line sits above the newest water mark.'),
    });
    const turnTwo = createTurnRecord({
      sessionId: 'session-telemetry-gap',
      turn: 2,
      atIso: '2026-04-20T12:45:00.000Z',
      playerText: 'keep listening',
      narration: 'The dock creaks while Tamar gathers her thoughts.',
      trace: createStewardTrace(),
      telemetry: undefined,
    });
    const turnThreeTelemetry = createTelemetry();
    turnThreeTelemetry.knowledge.notes.push('The old salt line sits above the newest water mark.');
    turnThreeTelemetry.knowledge.notes.push('A second tide mark shows the surge reached the gate itself.');
    const turnThree = createTurnRecord({
      sessionId: 'session-telemetry-gap',
      turn: 3,
      atIso: '2026-04-20T12:50:00.000Z',
      playerText: 'inspect the tide gate',
      narration: 'The gate bears a fresh strand of kelp high above the latch.',
      trace: createStewardTrace(),
      telemetry: turnThreeTelemetry,
    });

    await seedSessionWithTurns(root, 'session-telemetry-gap', [turnOne, turnTwo, turnThree]);
    const report = await operator.getLastRunExplainReport({ sessionId: 'session-telemetry-gap' });

    assert.equal(report.status, 'ok');
    assert.match(
      report.turns[1]?.stateDeltaSummary || '',
      /No state delta was available from the persisted telemetry/i,
    );
    assert.match(
      report.turns[2]?.stateDeltaSummary || '',
      /A second tide mark shows the surge reached the gate itself/i,
    );
    assert.doesNotMatch(
      report.turns[2]?.stateDeltaSummary || '',
      /The old salt line sits above the newest water mark/i,
    );
  });

  it('includes steward-judgment council dispatches in the explained owner path', async () => {
    const root = await makeTempRoot('chronicle-last-run-steward-judgment-');
    const { operator } = await createOperator(root);

    const turn = createTurnRecord({
      sessionId: 'session-steward-judgment',
      turn: 1,
      atIso: '2026-04-20T13:00:00.000Z',
      playerText: 'coordinate the harbor crew and inspect the tide gate',
      narration: 'Tamar rallies the crew while you study the jammed gate.',
      trace: createStewardJudgmentTrace(),
      councilArtifacts: [
        {
          domain: 'world',
          summary: 'The gate is jammed with kelp and drift from the surge.',
          sceneMotionNotes: ['Crew gather at the gate.'],
          worldMotionNotes: ['The tide gate becomes the scene focus.'],
          surfacedThreadIds: ['tide-gate'],
          surfacedPendingEventIds: [],
        },
      ],
    });

    await seedSessionWithTurns(root, 'session-steward-judgment', [turn]);
    const report = await operator.getLastRunExplainReport({ sessionId: 'session-steward-judgment' });

    assert.equal(report.status, 'ok');
    assert.deepEqual(report.turns[0]?.councilDomains, ['character', 'world', 'systems']);
    assert.equal(report.turns[0]?.ownerLabel, 'closed by steward');
    assert.match(report.turns[0]?.ownerSummary || '', /handed judgment to character council, world council, and systems council/i);
    assert.equal(report.turns[0]?.raw.council.domains.find(domain => domain.domain === 'character')?.ran, true);
    assert.match(
      report.turns[0]?.raw.council.domains.find(domain => domain.domain === 'world')?.summary || '',
      /jammed with kelp and drift/i,
    );
    assert.match(
      report.turns[0]?.majorDecisions.join('\n') || '',
      /Warnings carried forward: systems: clearance_needs_follow_through\./i,
    );
  });
});

describe('last run explain helper', () => {
  it('prints a prose systems report for the latest completed run', async () => {
    const root = await makeTempRoot('chronicle-last-run-helper-');
    const turn = createTurnRecord({
      sessionId: 'session-helper',
      turn: 1,
      atIso: '2026-04-20T13:00:00.000Z',
      playerText: 'ask tamar about the tide',
      narration: 'Tamar answers in a low, practical voice.',
      trace: createStewardTrace(),
      telemetryNote: 'The tide mark is too high on the pilings.',
      acceptedEvents: [
        {
          type: 'RecordClue',
          actorId: 'tamar-vane',
          text: 'The tide reached too high before dawn.',
          subject: 'dock tide-mark',
          note: 'Tamar confirms the anomaly.',
        },
      ],
    });

    await seedSessionWithTurns(root, 'session-helper', [turn]);

    const result = await runPythonHelper([], {
      CHRONICLE_SESSION_ROOT: root,
      NODE_NO_WARNINGS: '1',
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes('## Last Run'));
    assert.ok(result.stdout.includes('## Turn 1'));
    assert.ok(result.stdout.includes('Owning subsystem:'));
    assert.ok(result.stdout.includes('State change:'));
    assert.ok(result.stdout.includes('Narration outcome:'));
  });

  it('returns stable JSON for machine consumers', async () => {
    const root = await makeTempRoot('chronicle-last-run-helper-json-');
    const turn = createTurnRecord({
      sessionId: 'session-helper-json',
      turn: 1,
      atIso: '2026-04-20T14:00:00.000Z',
      playerText: 'ask tamar about the tide',
      narration: 'Tamar answers in a low, practical voice.',
      trace: createStewardTrace(),
    });

    await seedSessionWithTurns(root, 'session-helper-json', [turn]);

    const result = await runPythonHelper(['--json'], {
      CHRONICLE_SESSION_ROOT: root,
      NODE_NO_WARNINGS: '1',
    });

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      sessionId: string;
      turns: Array<{ ownerLabel?: string }>;
    };
    assert.equal(payload.status, 'ok');
    assert.equal(payload.sessionId, 'session-helper-json');
    assert.ok(Array.isArray(payload.turns));
    assert.ok(payload.turns[0]?.ownerLabel);
  });

  it('prints a clear message when only empty sessions exist', async () => {
    const root = await makeTempRoot('chronicle-last-run-helper-empty-');
    const store = new JsonlSessionStore(root);
    await store.ensureSession('session-empty', {
      worldId: 'isle-of-marrow',
      createWorld: () => createWorldState(),
    });

    const result = await runPythonHelper([], {
      CHRONICLE_SESSION_ROOT: root,
      NODE_NO_WARNINGS: '1',
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /No completed Chronicle run was found yet/);
  });
});
