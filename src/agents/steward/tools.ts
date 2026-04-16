import type { ResponseToolDefinition } from '../llm/types';
import {
  EVENT_ITEM_SCHEMA,
  PENDING_PROMPT_DATA_SCHEMA,
  PROMPT_OPTION_SCHEMA,
  strictObjectSchema,
} from '../sharedSchemas';

const MEMORY_UPDATE_SCHEMA = strictObjectSchema(
  {
    currentGoals: { type: ['array', 'null'], items: { type: 'string' } },
    workingHypotheses: { type: ['array', 'null'], items: { type: 'string' } },
    intendedBeats: { type: ['array', 'null'], items: { type: 'string' } },
    deferredQuestions: { type: ['array', 'null'], items: { type: 'string' } },
    continuityNotes: { type: ['array', 'null'], items: { type: 'string' } },
  },
  { nullable: true },
);

const SCENE_AGENDA_UPDATE_SCHEMA = strictObjectSchema(
  {
    currentFocus: { type: ['string', 'null'] },
    pressures: { type: 'array', items: { type: 'string' } },
    unresolvedBeats: { type: 'array', items: { type: 'string' } },
    immediateTensions: { type: 'array', items: { type: 'string' } },
  },
  { nullable: true },
);

const WORLD_AGENDA_UPDATE_SCHEMA = strictObjectSchema(
  {
    activeThreads: { type: 'array', items: { type: 'string' } },
    introductionOpportunities: { type: 'array', items: { type: 'string' } },
    escalationHooks: { type: 'array', items: { type: 'string' } },
  },
  { nullable: true },
);

const THREAD_UPDATE_SCHEMA = strictObjectSchema({
  id: { type: 'string' },
  pressure: { type: ['number', 'null'] },
  status: { type: ['string', 'null'], enum: ['rising', 'stable', 'cooling', null] },
  remove: { type: ['boolean', 'null'] },
});

const NEW_THREAD_SCHEMA = strictObjectSchema({
  name: { type: 'string' },
  pressure: { type: ['number', 'null'] },
  domain: { type: ['string', 'null'] },
  status: { type: ['string', 'null'], enum: ['rising', 'stable', 'cooling', null] },
});

const HELD_BEAT_SCHEMA = strictObjectSchema({
  note: { type: 'string' },
  releaseConditions: { type: ['array', 'null'], items: { type: 'string' } },
});

const PENDING_EVENT_SCHEMA = strictObjectSchema({
  summary: { type: 'string' },
  dueTurn: { type: ['number', 'null'] },
  pressure: { type: ['number', 'null'] },
  domain: { type: ['string', 'null'] },
});

const DIRECTOR_UPDATES_SCHEMA = strictObjectSchema(
  {
    threadUpdates: { type: ['array', 'null'], items: THREAD_UPDATE_SCHEMA },
    newThreads: { type: ['array', 'null'], items: NEW_THREAD_SCHEMA },
    addHeldBeats: { type: ['array', 'null'], items: HELD_BEAT_SCHEMA },
    removeHeldBeats: { type: ['array', 'null'], items: { type: 'string' } },
    addPendingEvents: { type: ['array', 'null'], items: PENDING_EVENT_SCHEMA },
    removePendingEvents: { type: ['array', 'null'], items: { type: 'string' } },
  },
  { nullable: true },
);

const STEWARD_PENDING_PROMPT_SCHEMA = strictObjectSchema(
  {
    id: { type: 'string' },
    kind: { type: 'string', enum: ['confirm_travel', 'clarify_target', 'clarify_explore'] },
    question: { type: 'string' },
    options: { type: ['array', 'null'], items: PROMPT_OPTION_SCHEMA },
    data: PENDING_PROMPT_DATA_SCHEMA,
    createdTurn: { type: 'number' },
  },
  { nullable: true },
);

export const STEWARD_TOOL_DEFS: ResponseToolDefinition[] = [
  {
    type: 'function',
    name: 'inspect_world_summary',
    description: 'Get the high-level routing and synthesis summary for this turn.',
    parameters: strictObjectSchema({
      question: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'dispatch_character_task',
    description: 'Dispatch Character Designer for this turn.',
    parameters: strictObjectSchema({
      reason: { type: ['string', 'null'] },
      priority: { type: ['string', 'null'], enum: ['required', 'optional', null] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'dispatch_world_task',
    description: 'Dispatch World Designer for this turn.',
    parameters: strictObjectSchema({
      reason: { type: ['string', 'null'] },
      priority: { type: ['string', 'null'], enum: ['required', 'optional', null] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'dispatch_systems_task',
    description: 'Dispatch Systems Designer for this turn.',
    parameters: strictObjectSchema({
      reason: { type: ['string', 'null'] },
      priority: { type: ['string', 'null'], enum: ['required', 'optional', null] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_council_results',
    description: 'Inspect the currently collected council results before final synthesis.',
    parameters: strictObjectSchema({
      domains: { type: ['array', 'null'], items: { type: 'string', enum: ['character', 'world', 'systems'] } },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'finish_steward_turn',
    description: 'Commit the synthesized turn result and end the turn.',
    parameters: strictObjectSchema({
      summary: { type: 'string' },
      candidateEvents: { type: ['array', 'null'], items: EVENT_ITEM_SCHEMA },
      playerPrompt: strictObjectSchema(
        {
          pending: STEWARD_PENDING_PROMPT_SCHEMA,
          clear: { type: ['boolean', 'null'] },
        },
        { nullable: true },
      ),
      agendaUpdates: strictObjectSchema(
        {
          scene: SCENE_AGENDA_UPDATE_SCHEMA,
          world: WORLD_AGENDA_UPDATE_SCHEMA,
        },
        { nullable: true },
      ),
      directorUpdates: DIRECTOR_UPDATES_SCHEMA,
      stewardMemoryUpdate: MEMORY_UPDATE_SCHEMA,
    }),
    strict: true,
  },
];
