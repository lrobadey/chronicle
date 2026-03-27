import type { ResponseToolDefinition } from '../llm/types';

function strictObjectSchema<T extends Record<string, unknown>>(properties: T, options?: { nullable?: boolean }) {
  return {
    type: options?.nullable ? ['object', 'null'] : 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  } as const;
}

const GRID_POS_SCHEMA = strictObjectSchema({
  x: { type: 'number' },
  y: { type: 'number' },
  z: { type: ['number', 'null'] },
});

const NULLABLE_GRID_POS_SCHEMA = strictObjectSchema(
  {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: ['number', 'null'] },
  },
  { nullable: true },
);

const PROMPT_OPTION_SCHEMA = strictObjectSchema({
  key: { type: 'string' },
  label: { type: 'string' },
});

const GROUND_LOCATION_SCHEMA = strictObjectSchema({
  kind: { type: 'string', enum: ['ground'] },
  pos: GRID_POS_SCHEMA,
});

const CREATE_ENTITY_DATA_SCHEMA = strictObjectSchema({
  id: { type: 'string' },
  name: { type: 'string' },
  description: { type: ['string', 'null'] },
  location: { ...GROUND_LOCATION_SCHEMA, type: ['object', 'null'] },
  pos: NULLABLE_GRID_POS_SCHEMA,
  anchor: NULLABLE_GRID_POS_SCHEMA,
});

const CREATE_ENTITY_SCHEMA = strictObjectSchema({
  kind: { type: 'string', enum: ['item', 'npc', 'location'] },
  data: CREATE_ENTITY_DATA_SCHEMA,
});

const PENDING_PROMPT_DATA_SCHEMA = strictObjectSchema(
  {
    locationId: { type: ['string', 'null'] },
    estimatedMinutes: { type: ['number', 'null'] },
    subject: { type: ['string', 'null'] },
    area: { type: ['string', 'null'], enum: ['shoreline', 'docks', 'under_ribs', 'around_here', null] },
    direction: { type: ['string', 'null'], enum: ['east', 'west', 'north', 'south', null] },
  },
  { nullable: true },
);

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
    actorId: { type: ['string', 'null'] },
    to: NULLABLE_GRID_POS_SCHEMA,
    toLocationId: { type: ['string', 'null'] },
    mode: { type: ['string', 'null'], enum: ['walk', 'run', null] },
    itemId: { type: ['string', 'null'] },
    at: NULLABLE_GRID_POS_SCHEMA,
    text: { type: ['string', 'null'] },
    toActorId: { type: ['string', 'null'] },
    minutes: { type: ['number', 'null'] },
    entity: { ...CREATE_ENTITY_SCHEMA, type: ['object', 'null'] },
    key: { type: ['string', 'null'] },
    value: { type: ['string', 'number', 'boolean', 'null'] },
    locationId: { type: ['string', 'null'] },
    pace: { type: ['string', 'null'], enum: ['walk', 'run', null] },
    confirmId: { type: ['string', 'null'] },
    area: { type: ['string', 'null'], enum: ['shoreline', 'docks', 'under_ribs', 'around_here', null] },
    direction: { type: ['string', 'null'], enum: ['east', 'west', 'north', 'south', null] },
    subject: { type: ['string', 'null'] },
    note: { type: ['string', 'null'] },
  },
  required: [
    'type',
    'actorId',
    'to',
    'toLocationId',
    'mode',
    'itemId',
    'at',
    'text',
    'toActorId',
    'minutes',
    'entity',
    'key',
    'value',
    'locationId',
    'pace',
    'confirmId',
    'area',
    'direction',
    'subject',
    'note',
  ],
  additionalProperties: false,
} as const;

export const GM_TOOL_DEFS: ResponseToolDefinition[] = [
  {
    type: 'function',
    name: 'observe_world',
    description: 'Get current world observation (player or GM view).',
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
      }),
    },
    strict: true,
  },
];
