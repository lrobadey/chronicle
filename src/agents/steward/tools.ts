import type { ResponseToolDefinition } from '../llm/types';
import {
  EVENT_ITEM_SCHEMA,
  PENDING_PROMPT_DATA_SCHEMA,
  PROMPT_OPTION_SCHEMA,
  strictObjectSchema,
} from '../sharedSchemas';

const MECHANICS_PENDING_PROMPT_SCHEMA = strictObjectSchema(
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
    description: 'Get a compressed high-level world and planning summary. Prefer this before asking for local detail.',
    parameters: {
      ...strictObjectSchema({
        question: { type: ['string', 'null'] },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_scene_detail',
    description: 'Get a bounded local scene packet when the broad summary is not enough.',
    parameters: {
      ...strictObjectSchema({
        question: { type: ['string', 'null'] },
        focus: { type: ['string', 'null'] },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'delegate_mechanics',
    description: 'Ask the mechanics delegate for a bounded local resolution proposal.',
    parameters: {
      ...strictObjectSchema({
        playerText: { type: ['string', 'null'] },
        objective: { type: ['string', 'null'] },
        focus: { type: ['string', 'null'] },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'consult_npc',
    description: 'Ask a specific NPC for their dialogue and intent. Call this before proposing any Speak event on their behalf.',
    parameters: {
      ...strictObjectSchema({
        npcId: { type: 'string' },
        topic: { type: ['string', 'null'] },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'consult_specialist',
    description: 'Ask a bounded specialist advisor for structured guidance before deciding on world mutations.',
    parameters: {
      ...strictObjectSchema({
        specialistType: { type: 'string', enum: ['scene', 'world'] },
        question: { type: 'string' },
        focus: { type: ['string', 'null'] },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'propose_events',
    description: 'Propose and immediately apply one or more domain events. Use this for incremental world mutations during the turn (e.g. NPC speech, position changes). Do not re-include these events in finish_steward_turn candidateEvents.',
    parameters: {
      ...strictObjectSchema({
        events: { type: 'array', items: EVENT_ITEM_SCHEMA },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'resolve_mechanics',
    description: 'Ask the mechanics worker to draft a mechanical resolution for the current player action. Returns a resolutionId to review.',
    parameters: {
      ...strictObjectSchema({
        playerText: { type: ['string', 'null'] },
        objective: { type: ['string', 'null'] },
        focus: { type: ['string', 'null'] },
        pendingPrompt: MECHANICS_PENDING_PROMPT_SCHEMA,
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'review_mechanics_resolution',
    description: "Approve, revise, or reject a mechanics draft by resolution id. When action='revise', feedback is required.",
    parameters: {
      ...strictObjectSchema({
        resolutionId: { type: 'string' },
        action: { type: 'string', enum: ['approve', 'revise', 'reject'] },
        feedback: { type: ['string', 'null'] },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'schedule_task',
    description: 'Ask the schedule agent to draft ScheduleProcess and/or SetNpcSchedule events for a task. Returns a scheduleResolutionId to review.',
    parameters: {
      ...strictObjectSchema({
        task: { type: 'string' },
        actorId: { type: ['string', 'null'] },
        timeHint: { type: ['string', 'null'] },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'review_schedule_resolution',
    description: "Approve, revise, or reject a schedule draft. When action='revise', feedback must describe what is wrong.",
    parameters: {
      ...strictObjectSchema({
        scheduleResolutionId: { type: 'string' },
        action: { type: 'string', enum: ['approve', 'revise', 'reject'] },
        feedback: { type: ['string', 'null'] },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'finish_steward_turn',
    description: 'Commit the steward-owned turn result and end the turn.',
    parameters: {
      ...strictObjectSchema({
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
    },
    strict: true,
  },
];
