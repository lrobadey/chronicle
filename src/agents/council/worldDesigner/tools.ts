import type { ResponseToolDefinition } from '../../llm/types';
import { EVENT_ITEM_SCHEMA, strictObjectSchema } from '../../sharedSchemas';

export const WORLD_RESULT_TOOL_NAME = 'emit_world_result';

export const WORLD_TOOL_DEFS: ResponseToolDefinition[] = [
  {
    type: 'function',
    name: 'inspect_world_scene',
    description: 'Inspect scene-local world framing context.',
    parameters: strictObjectSchema({
      question: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_world_pressure',
    description: 'Inspect the highest-pressure world state currently relevant to the turn.',
    parameters: strictObjectSchema({
      includeThreads: { type: ['boolean', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_world_threads',
    description: 'Inspect active world threads.',
    parameters: strictObjectSchema({
      limit: { type: ['number', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_held_beats',
    description: 'Inspect held beats relevant to the current turn.',
    parameters: strictObjectSchema({
      limit: { type: ['number', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_pending_world_events',
    description: 'Inspect pending world events relevant to the current turn.',
    parameters: strictObjectSchema({
      pressureFloor: { type: ['number', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'worker_draft_scene_motion',
    description: 'Draft scene-framing guidance and candidate local world events.',
    parameters: strictObjectSchema({
      focus: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'worker_draft_world_motion',
    description: 'Draft wider world-motion guidance and candidate world events.',
    parameters: strictObjectSchema({
      focus: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'worker_draft_world_events',
    description: 'Normalize and combine scene/world candidate events into one list.',
    parameters: strictObjectSchema({
      sceneSummary: { type: ['string', 'null'] },
      worldSummary: { type: ['string', 'null'] },
      sceneCandidateEvents: { type: ['array', 'null'], items: EVENT_ITEM_SCHEMA },
      worldCandidateEvents: { type: ['array', 'null'], items: EVENT_ITEM_SCHEMA },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: WORLD_RESULT_TOOL_NAME,
    description: 'Emit the final World Designer result for Steward synthesis.',
    parameters: strictObjectSchema({
      summary: { type: 'string' },
      candidateEvents: { type: 'array', items: EVENT_ITEM_SCHEMA },
      sceneMotionNotes: { type: 'array', items: { type: 'string' } },
      worldMotionNotes: { type: 'array', items: { type: 'string' } },
      surfacedThreadIds: { type: 'array', items: { type: 'string' } },
      surfacedPendingEventIds: { type: 'array', items: { type: 'string' } },
      artifacts: {
        type: ['array', 'null'],
        items: strictObjectSchema({
          type: { type: 'string', enum: ['scene_motion', 'world_motion'] },
          summary: { type: 'string' },
          candidateEvents: { type: 'array', items: EVENT_ITEM_SCHEMA },
        }),
      },
      warnings: { type: ['array', 'null'], items: { type: 'string' } },
    }),
    strict: true,
  },
];
