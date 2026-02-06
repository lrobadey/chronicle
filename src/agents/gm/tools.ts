import type { ResponseToolDefinition } from '../llm/types';

const GRID_POS_SCHEMA = {
  type: 'object',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: ['number', 'null'] },
  },
  required: ['x', 'y', 'z'],
  additionalProperties: false,
} as const;

const PROMPT_OPTION_SCHEMA = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    label: { type: 'string' },
  },
  required: ['key', 'label'],
  additionalProperties: false,
} as const;

const EVENT_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: [
        'MoveActor',
        'PickUpItem',
        'DropItem',
        'Speak',
        'AdvanceTime',
        'CreateEntity',
        'SetFlag',
        'TravelToLocation',
        'Explore',
        'Inspect',
      ],
    },
    actorId: { type: 'string' },
    to: GRID_POS_SCHEMA,
    toLocationId: { type: ['string', 'null'] },
    mode: { type: ['string', 'null'], enum: ['walk', 'run', null] },
    itemId: { type: 'string' },
    at: { type: ['object', 'null'], additionalProperties: true },
    text: { type: 'string' },
    toActorId: { type: ['string', 'null'] },
    minutes: { type: 'number' },
    entity: { type: 'object', additionalProperties: true },
    key: { type: 'string' },
    value: {
      type: ['string', 'number', 'boolean', 'null', 'object', 'array'],
    },
    locationId: { type: 'string' },
    pace: { type: ['string', 'null'], enum: ['walk', 'run', null] },
    confirmId: { type: ['string', 'null'] },
    area: { type: 'string', enum: ['shoreline', 'docks', 'under_ribs', 'around_here'] },
    direction: { type: ['string', 'null'], enum: ['east', 'west', 'north', 'south', null] },
    subject: { type: 'string' },
    note: { type: ['string', 'null'] },
  },
  required: ['type'],
  additionalProperties: false,
} as const;

export const GM_TOOL_DEFS: ResponseToolDefinition[] = [
  {
    type: 'function',
    name: 'observe_world',
    description: 'Get current world observation (player or GM view).',
    parameters: {
      type: 'object',
      properties: {
        perspective: { type: 'string', enum: ['gm', 'player'] },
      },
      required: ['perspective'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'consult_npc',
    description: 'Ask a specific NPC for dialogue + intent.',
    parameters: {
      type: 'object',
      properties: {
        npcId: { type: 'string' },
        topic: { type: ['string', 'null'] },
      },
      required: ['npcId', 'topic'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'propose_events',
    description: 'Propose one or more domain events. The engine validates and applies them.',
    parameters: {
      type: 'object',
      properties: {
        events: { type: 'array', items: EVENT_ITEM_SCHEMA },
      },
      required: ['events'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'finish_turn',
    description: 'Finish the turn when done.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        playerPrompt: {
          type: ['object', 'null'],
          properties: {
            pending: {
              type: ['object', 'null'],
              properties: {
                id: { type: 'string' },
                kind: { type: 'string', enum: ['confirm_travel', 'clarify_target', 'clarify_explore'] },
                question: { type: 'string' },
                options: { type: ['array', 'null'], items: PROMPT_OPTION_SCHEMA },
                data: { type: ['object', 'null'], additionalProperties: true },
                createdTurn: { type: 'number' },
              },
              additionalProperties: false,
            },
            clear: { type: ['boolean', 'null'] },
          },
          additionalProperties: false,
        },
      },
      required: ['summary'],
      additionalProperties: false,
    },
    strict: true,
  },
];
