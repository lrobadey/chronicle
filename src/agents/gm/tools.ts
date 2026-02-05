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

const EVENT_SCHEMAS = [
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['MoveActor'] },
      actorId: { type: 'string' },
      to: GRID_POS_SCHEMA,
      toLocationId: { type: ['string', 'null'] },
      mode: { type: ['string', 'null'], enum: ['walk', 'run', null] },
      note: { type: ['string', 'null'] },
    },
    required: ['type', 'actorId', 'to', 'toLocationId', 'mode', 'note'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['PickUpItem'] },
      actorId: { type: 'string' },
      itemId: { type: 'string' },
      note: { type: ['string', 'null'] },
    },
    required: ['type', 'actorId', 'itemId', 'note'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['DropItem'] },
      actorId: { type: 'string' },
      itemId: { type: 'string' },
      at: {
        oneOf: [GRID_POS_SCHEMA, { type: 'null' }],
      },
      note: { type: ['string', 'null'] },
    },
    required: ['type', 'actorId', 'itemId', 'at', 'note'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['Speak'] },
      actorId: { type: 'string' },
      text: { type: 'string' },
      toActorId: { type: ['string', 'null'] },
      note: { type: ['string', 'null'] },
    },
    required: ['type', 'actorId', 'text', 'toActorId', 'note'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['AdvanceTime'] },
      minutes: { type: 'number' },
      note: { type: ['string', 'null'] },
    },
    required: ['type', 'minutes', 'note'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['CreateEntity'] },
      entity: {
        oneOf: [
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['item'] },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: ['string', 'null'] },
                  location: {
                    type: 'object',
                    properties: {
                      kind: { type: 'string', enum: ['ground'] },
                      pos: GRID_POS_SCHEMA,
                    },
                    required: ['kind', 'pos'],
                    additionalProperties: false,
                  },
                },
                required: ['id', 'name', 'description', 'location'],
                additionalProperties: false,
              },
            },
            required: ['kind', 'data'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['npc'] },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  pos: GRID_POS_SCHEMA,
                },
                required: ['id', 'name', 'pos'],
                additionalProperties: false,
              },
            },
            required: ['kind', 'data'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['location'] },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  anchor: GRID_POS_SCHEMA,
                },
                required: ['id', 'name', 'description', 'anchor'],
                additionalProperties: false,
              },
            },
            required: ['kind', 'data'],
            additionalProperties: false,
          },
        ],
      },
      note: { type: ['string', 'null'] },
    },
    required: ['type', 'entity', 'note'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['SetFlag'] },
      key: { type: 'string' },
      value: {
        oneOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
        ],
      },
      note: { type: ['string', 'null'] },
    },
    required: ['type', 'key', 'value', 'note'],
    additionalProperties: false,
  },
] as const;

export const GM_TOOL_DEFS: ResponseToolDefinition[] = [
  {
    type: 'function',
    name: 'observe_world',
    description: 'Get current world observation (player or GM view). Call this first.',
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
        events: { type: 'array', items: { oneOf: EVENT_SCHEMAS } },
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
      },
      required: ['summary'],
      additionalProperties: false,
    },
    strict: true,
  },
];
