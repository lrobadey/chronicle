import type { ResponseToolDefinition } from '../llm/types';
import {
  EVENT_ITEM_SCHEMA,
  PENDING_PROMPT_DATA_SCHEMA,
  PROMPT_OPTION_SCHEMA,
  strictObjectSchema,
} from '../sharedSchemas';

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
}, { nullable: false });

const NEW_THREAD_SCHEMA = strictObjectSchema({
  name: { type: 'string' },
  pressure: { type: ['number', 'null'] },
  domain: { type: ['string', 'null'] },
  status: { type: ['string', 'null'], enum: ['rising', 'stable', 'cooling', null] },
}, { nullable: false });

const HELD_BEAT_SCHEMA = strictObjectSchema({
  note: { type: 'string' },
  releaseConditions: { type: ['array', 'null'], items: { type: 'string' } },
}, { nullable: false });

const PENDING_EVENT_SCHEMA = strictObjectSchema({
  summary: { type: 'string' },
  dueTurn: { type: ['number', 'null'] },
  pressure: { type: ['number', 'null'] },
  domain: { type: ['string', 'null'] },
}, { nullable: false });

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

const MECHANICS_RESOLUTION_ID_SCHEMA = { type: 'string' } as const;

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

export const GM_TOOL_DEFS: ResponseToolDefinition[] = [
  {
    type: 'function',
    name: 'observe_world',
    description: 'Re-read world state after propose_events has changed it. Do not call this before proposing events — the current observation and telemetry are already in your initial context.',
    parameters: {
      ...strictObjectSchema({
        perspective: { type: 'string', enum: ['gm', 'player'] },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'consult_npc',
    description: 'Ask a specific NPC for dialogue + intent.',
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
    description: 'Propose one or more domain events. The engine validates and applies them.',
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
    description: 'Ask the mechanics worker to draft a simple mechanical resolution for the current player action.',
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
    description: "Approve, revise, or reject a mechanics draft by resolution id. When action='revise', feedback is required and must describe what is wrong and what correction to make.",
    parameters: {
      ...strictObjectSchema({
        resolutionId: MECHANICS_RESOLUTION_ID_SCHEMA,
        action: { type: 'string', enum: ['approve', 'revise', 'reject'] },
        feedback: { type: ['string', 'null'] },
      }),
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'finish_turn',
    description: 'Finish the turn when done.',
    parameters: {
      ...strictObjectSchema({
        summary: { type: 'string' },
        playerPrompt: strictObjectSchema(
          {
            pending: strictObjectSchema(
              {
                id: { type: 'string' },
                kind: { type: 'string', enum: ['confirm_travel', 'clarify_target', 'clarify_explore'] },
                question: { type: 'string' },
                options: { type: ['array', 'null'], items: PROMPT_OPTION_SCHEMA },
                data: PENDING_PROMPT_DATA_SCHEMA,
                createdTurn: { type: 'number' },
              },
              { nullable: true },
            ),
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
      }),
    },
    strict: true,
  },
];
