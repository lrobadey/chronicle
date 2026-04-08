import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_MODEL } from '../../agents/llm/defaults';
import { FINISH_STAFF_INTERVIEW_TOOL_NAME, runStaffInterview } from '../../agents/staffInterview';
import { QueueLLM } from '../helpers/queueLLM';

describe('staff interview agent', () => {
  const baseContext: any = {
    sessionId: 'session-1',
    playerId: 'player-1',
    observation: { summary: 'foggy docks' },
    telemetry: {
      turn: 2,
      location: { id: 'the-landing', name: 'The Landing' },
    },
    agendas: {
      scene: { currentFocus: 'Arrival', pressures: ['Be noticed'], unresolvedBeats: [], immediateTensions: [] },
      world: { activeThreads: ['Dock gossip'], introductionOpportunities: [], escalationHooks: [] },
      activeThreads: [],
      heldBeats: [],
      pendingWorldEvents: [],
      playerBehaviorPatterns: {},
      capabilityCandidates: [],
    },
    pendingPrompt: null,
    landmarks: [],
    nearby: { actors: [], itemsOnGround: [] },
    map: { cellSizeMeters: 2 },
    playerTranscriptTail: [{ turn: 1, playerId: 'player-1', playerText: 'look around' }],
    recentTurns: [],
    recentTurnDetails: [],
    heuristics: {
      repeatedClarificationCount: 0,
      rejectedEventCount: 0,
      noAcceptedTurnCount: 0,
      specialistConsultCount: 0,
      pendingPromptActive: false,
      scenePressureCount: 1,
      worldThreadCount: 1,
    },
  };

  it('returns structured interview output via dedicated tool', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-staff-1',
        output: [
          {
            type: 'function_call',
            name: FINISH_STAFF_INTERVIEW_TOOL_NAME,
            arguments:
              '{"employeeReply":"I understand the player has just arrived and the scene is still thin.","diagnostics":{"currentUnderstanding":"I am tracking an arrival scene at The Landing.","knownGoals":["Anchor the arrival","Make the dock attention matter"],"missingContext":["I do not know what emotional tone the operator wants next."],"frictionPoints":["The current scene focus is still broad."],"improvementIdeas":["Give me a one-line target for the next beat."],"suggestedQuestions":["Should the next beat emphasize suspicion or welcome?"],"confidenceNotes":["Location and turn are grounded in current state."]}}',
            call_id: 'staff-call-1',
          },
        ],
        output_text: '',
      },
    ]);

    const result = await runStaffInterview({
      apiKey: 'test-key',
      question: 'How are you experiencing this session?',
      context: baseContext,
      llm,
    });

    assert.equal(result.source, 'live');
    assert.equal(result.diagnostics.knownGoals[0], 'Anchor the arrival');
    assert.equal(llm.calls[0]?.model, DEFAULT_MODEL);
    assert.deepEqual(
      (llm.calls[0]?.tools || []).map(tool => tool.name),
      [FINISH_STAFF_INTERVIEW_TOOL_NAME],
    );
    assert.deepEqual(llm.calls[0]?.tool_choice, { type: 'function', name: FINISH_STAFF_INTERVIEW_TOOL_NAME });
  });

  it('falls back deterministically when tool output is missing', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-staff-2',
        output: [],
        output_text: 'free text only',
      },
    ]);

    const result = await runStaffInterview({
      apiKey: 'test-key',
      question: 'What is missing?',
      context: baseContext,
      llm,
    });

    assert.equal(result.source, 'fallback');
    assert.equal(Array.isArray(result.diagnostics.improvementIdeas), true);
    assert.equal(result.employeeReply.length > 0, true);
  });
});
