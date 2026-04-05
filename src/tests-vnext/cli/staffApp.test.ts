import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StaffCliEngine, StaffCliState } from '../../cli/staffApp';
import { handleStaffCliLine, runStaffCli } from '../../cli/staffApp';
import { ScriptedTerminal } from './scriptedTerminal';

class StubStaffCliEngine implements StaffCliEngine {
  ensureCalls: Array<{ sessionId?: string; playerId: string }> = [];
  interviewCalls: Array<{ sessionId: string; playerId: string; question: string; apiKey?: string; conversation?: unknown[] }> = [];

  async ensureStaffSession(params: { sessionId?: string; playerId: string }) {
    this.ensureCalls.push(params);
    return {
      sessionId: params.sessionId || 'staff-session-1',
      created: !params.sessionId,
      telemetry: {
        turn: 3,
        location: { id: 'the-landing', name: 'The Landing' },
      },
    };
  }

  async getStaffInterviewContext(sessionId: string, playerId: string) {
    return {
      sessionId,
      playerId,
      observation: {},
      telemetry: {
        turn: 3,
        location: { id: 'the-landing', name: 'The Landing' },
      },
      agendas: {
        scene: { currentFocus: 'Arrival', pressures: [], unresolvedBeats: [], immediateTensions: [] },
        world: { activeThreads: [], introductionOpportunities: [], escalationHooks: [] },
      },
      pendingPrompt: null,
      landmarks: [],
      nearby: { actors: [], itemsOnGround: [] },
      map: { cellSizeMeters: 2 },
      playerTranscriptTail: [],
      recentTurns: [],
      recentTurnDetails: [],
      heuristics: {
        repeatedClarificationCount: 0,
        rejectedEventCount: 0,
        noAcceptedTurnCount: 0,
        specialistConsultCount: 0,
        pendingPromptActive: false,
        scenePressureCount: 0,
        worldThreadCount: 0,
      },
    } as any;
  }

  async runStaffInterview(input: {
    sessionId: string;
    playerId: string;
    question: string;
    apiKey?: string;
    conversation?: Array<{ role: 'operator' | 'employee'; content: string }>;
  }) {
    this.interviewCalls.push(input);
    return {
      employeeReply: 'I think the main issue is pace in the current scene.',
      diagnostics: {
        currentUnderstanding: 'I am focused on the arrival scene.',
        knownGoals: ['Keep the arrival coherent'],
        missingContext: ['Desired emotional temperature'],
        frictionPoints: ['The next beat target is not explicit'],
        improvementIdeas: ['Tell me what success looks like next turn'],
        suggestedQuestions: ['Should the next beat escalate?'],
        confidenceNotes: ['This is based on current session state.'],
      },
      source: input.apiKey ? 'live' as const : 'fallback' as const,
    };
  }
}

describe('staff CLI app', () => {
  it('runs independently with its own prompt loop', async () => {
    const engine = new StubStaffCliEngine();
    const terminal = new ScriptedTerminal(['How is this feeling?', '/exit']);

    const result = await runStaffCli({
      engine,
      terminal,
      sessionId: 'existing-session',
      apiKey: 'test-key',
    });

    assert.equal(result.exitCode, 0);
    assert.equal(engine.ensureCalls.length, 1);
    assert.equal(engine.interviewCalls.length, 1);
    assert.equal(terminal.output().includes('Chronicle Staff Interview'), true);
    assert.equal(terminal.output().includes('Employee (live):'), true);
    assert.equal(terminal.output().includes('How is this feeling?'), false);
  });

  it('keeps interview continuity in memory only', async () => {
    const engine = new StubStaffCliEngine();
    const writes: string[] = [];
    let state: StaffCliState = {
      sessionId: 'session-1',
      playerId: 'player-1',
      apiKey: 'test-key',
      conversation: [],
    };

    ({ state } = await handleStaffCliLine({
      state,
      line: 'First question',
      engine,
      write: text => writes.push(text),
    }));

    ({ state } = await handleStaffCliLine({
      state,
      line: 'Second question',
      engine,
      write: text => writes.push(text),
    }));

    assert.equal(engine.interviewCalls.length, 2);
    assert.equal((engine.interviewCalls[1]?.conversation || []).length, 2);
    assert.equal(state.conversation.length, 4);
    assert.equal(writes.join('').includes('Diagnostics:'), true);
  });
});
