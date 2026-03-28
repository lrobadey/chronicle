import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_MODEL } from '../../agents/llm/defaults';
import { finalizeSpecialistConsultations, runSpecialistAgent } from '../../agents/specialists';
import { QueueLLM } from '../helpers/queueLLM';
import type { DebugEvent } from '../../engine/debug';

describe('specialist agent', () => {
  it('uses strict function-call payload for specialist output', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-specialist-1',
        output: [
          {
            type: 'function_call',
            name: 'emit_specialist_advice',
            arguments:
              '{"summary":"Raise the scene pressure.","recommendations":["Introduce a witness."],"candidateEvents":[],"creationIntent":{"kind":"npc","purpose":"Add a dockworker who saw the arrival."},"risks":["Too many introductions at once."]}',
            call_id: 'specialist-call-1',
          },
        ],
        output_text: '',
      },
    ]);
    const debugEvents: DebugEvent[] = [];

    const trace = { llmCalls: [] as Array<{ agent: 'gm' | 'npc' | 'narrator' | 'specialist'; [key: string]: unknown }> };
    const result = await runSpecialistAgent({
      apiKey: 'test-key',
      specialistType: 'scene',
      question: 'How should this scene escalate?',
      focus: 'the landing',
      context: {
        agendas: { currentFocus: 'Arrival', pressures: [], unresolvedBeats: [], immediateTensions: [] },
        pendingPrompt: null,
        telemetry: { turn: 1 },
        observation: { nearbyActors: [] },
        playerText: 'look around',
        transcriptTail: [],
      },
      llm,
      debug: event => debugEvents.push(event),
      trace,
    });

    assert.equal(result.specialistType, 'scene');
    assert.equal(result.summary, 'Raise the scene pressure.');
    assert.equal(result.creationIntent?.kind, 'npc');
    assert.equal(trace.llmCalls.length, 1);
    assert.equal(llm.calls[0]?.model, DEFAULT_MODEL);
    assert.deepEqual(debugEvents.map(event => event.type), ['specialist.started', 'specialist.completed']);
  });

  it('falls back deterministically when function-call payload is missing', async () => {
    const llm = new QueueLLM([
      {
        id: 'resp-specialist-2',
        output: [],
        output_text: 'non-structured text',
      },
    ]);

    const result = await runSpecialistAgent({
      apiKey: 'test-key',
      specialistType: 'world',
      question: 'What bigger change should follow?',
      context: {
        agendas: { activeThreads: [], introductionOpportunities: [], escalationHooks: [] },
        pendingPrompt: null,
        telemetry: { turn: 1 },
        worldSnapshot: {},
        playerText: 'look around',
        transcriptTail: [],
      },
      llm,
    });

    assert.equal(result.specialistType, 'world');
    assert.equal(Array.isArray(result.recommendations), true);
    assert.equal(result.candidateEvents.length, 0);
  });

  it('marks suggested events as used only when the GM accepts matching events', () => {
    const consultations = finalizeSpecialistConsultations(
      [
        {
          specialistType: 'scene' as const,
          question: 'Who should appear?',
          focus: 'the landing',
          output: {
            specialistType: 'scene' as const,
            summary: 'Introduce a witness.',
            recommendations: ['Add one dockworker.'],
            candidateEvents: [
              {
                type: 'CreateEntity',
                entity: {
                  kind: 'npc',
                  data: {
                    id: 'dock-eye',
                    name: 'Dock Eye',
                    pos: { x: 1, y: 0, z: 0 },
                    persona: {
                      tagline: 'A wary laborer.',
                      background: 'Keeps to the piers.',
                      voice: 'Brief.',
                      goals: ['stay out of trouble'],
                    },
                  },
                },
              },
            ],
            creationIntent: { kind: 'npc', purpose: 'Introduce a witness.' },
            risks: [],
          },
        },
      ],
      [
        {
          meta: { id: 'e1', turn: 1, by: 'gm' },
          type: 'CreateEntity',
          entity: {
            kind: 'npc',
            data: {
              id: 'dock-eye',
              name: 'Dock Eye',
              pos: { x: 1, y: 0, z: 0 },
              persona: {
                tagline: 'A wary laborer.',
                background: 'Keeps to the piers.',
                voice: 'Brief.',
                goals: ['stay out of trouble'],
              },
            },
          },
        },
      ],
    );

    assert.equal(consultations[0]?.usedSuggestion, true);
    assert.equal(consultations[0]?.usedCandidateEvents.length, 1);
  });
});
