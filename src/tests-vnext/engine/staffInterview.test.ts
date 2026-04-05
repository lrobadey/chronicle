import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { TurnEngine } from '../../engine/turnEngine';
import { JsonlSessionStore } from '../../engine/session/jsonlStore';
import { QueueLLM } from '../helpers/queueLLM';

async function createStore() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chronicle-staff-'));
  return { rootDir, store: new JsonlSessionStore(rootDir) };
}

async function removeDir(rootDir: string) {
  await fs.rm(rootDir, { recursive: true, force: true });
}

describe('staff interview engine path', () => {
  it('builds read-only interview context and does not mutate the session', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'resp-staff-engine-1',
          output: [
            {
              type: 'function_call',
              name: 'finish_staff_interview',
              arguments:
                '{"employeeReply":"I can see the arrival context clearly.","diagnostics":{"currentUnderstanding":"I am looking at turn 0 on the Isle of Marrow opening.","knownGoals":["Establish the opening"],"missingContext":[],"frictionPoints":[],"improvementIdeas":["Tell me what flavor of opening you want next."],"suggestedQuestions":["What should feel most important in the opening?"],"confidenceNotes":["This answer is grounded in fresh session state."]}}',
              call_id: 'staff-engine-call-1',
            },
          ],
          output_text: '',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const ensured = await engine.ensureStaffSession({ playerId: 'player-1' });

      const beforeState = await store.loadSession(ensured.sessionId);
      const beforeLog = await store.loadTurnLog(ensured.sessionId);

      const context = await engine.getStaffInterviewContext(ensured.sessionId, 'player-1');
      assert.equal(context.sessionId, ensured.sessionId);
      assert.equal(Array.isArray(context.playerTranscriptTail), true);
      assert.equal(Array.isArray(context.recentTurns), true);
      assert.equal(Array.isArray(context.recentTurnDetails), true);

      const result = await engine.runStaffInterview({
        sessionId: ensured.sessionId,
        playerId: 'player-1',
        question: 'How are you doing?',
        apiKey: 'test-key',
      });

      const afterState = await store.loadSession(ensured.sessionId);
      const afterLog = await store.loadTurnLog(ensured.sessionId);

      assert.equal(result.source, 'live');
      assert.deepEqual(afterState, beforeState);
      assert.deepEqual(afterLog, beforeLog);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('counts clarification loops from persisted pending prompts without debug trace', async () => {
    const { rootDir, store } = await createStore();
    try {
      const longPlayerText = 'y'.repeat(260);
      const clippedPlayerText = `${'y'.repeat(239)}…`;
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [
            {
              type: 'function_call',
              name: 'finish_turn',
              arguments:
                '{"summary":"need clarification","playerPrompt":{"pending":{"id":"clarify-docks","kind":"clarify_target","question":"Which part of the docks do you mean?","options":[{"key":"warehouses","label":"The warehouses"},{"key":"moorings","label":"The moorings"}],"data":{"subject":"docks"},"createdTurn":1},"clear":false}}',
              call_id: 'g1',
            },
          ],
          output_text: '',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});

      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: longPlayerText,
        apiKey: 'test-key',
      });

      const turnLog = await store.loadTurnLog(init.sessionId);
      const context = await engine.getStaffInterviewContext(init.sessionId, 'player-1');

      assert.equal(turnLog[0]?.pendingPrompt?.kind, 'clarify_target');
      assert.equal(turnLog[0]?.trace, undefined);
      assert.equal(context.heuristics.repeatedClarificationCount, 1);
      assert.equal(context.recentTurnDetails[0]?.playerText, clippedPlayerText);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('falls back to legacy trace data for clarification-loop heuristics', async () => {
    const { rootDir, store } = await createStore();
    try {
      const engine = new TurnEngine({ store, llm: new QueueLLM([]) });
      const ensured = await engine.ensureStaffSession({ playerId: 'player-1' });
      const state = await store.loadSession(ensured.sessionId);

      assert.ok(state);
      state.meta.turn = 1;
      await store.saveSnapshot(ensured.sessionId, state);
      await store.appendTurn(ensured.sessionId, {
        sessionId: ensured.sessionId,
        turn: 1,
        atIso: new Date().toISOString(),
        playerId: 'player-1',
        playerText: 'legacy turn',
        acceptedEvents: [],
        rejectedEvents: [],
        trace: {
          toolCalls: [
            {
              tool: 'finish_turn',
              input: {
                summary: 'need clarification',
                playerPrompt: {
                  pending: {
                    id: 'legacy-clarify',
                    kind: 'clarify_explore',
                    question: 'Where do you want to search?',
                    createdTurn: 1,
                  },
                },
              },
              output: { ok: true },
            },
          ],
        },
      });

      const context = await engine.getStaffInterviewContext(ensured.sessionId, 'player-1');
      assert.equal(context.heuristics.repeatedClarificationCount, 1);
    } finally {
      await removeDir(rootDir);
    }
  });
});
