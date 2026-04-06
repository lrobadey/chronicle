function strictObjectSchema<T extends Record<string, unknown>>(properties: T, options?: { nullable?: boolean }) {
  return {
    type: options?.nullable ? ['object', 'null'] : 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  } as const;
}

export const GRID_POS_SCHEMA = strictObjectSchema({
  x: { type: 'number' },
  y: { type: 'number' },
  z: { type: ['number', 'null'] },
});

export const NULLABLE_GRID_POS_SCHEMA = strictObjectSchema(
  {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: ['number', 'null'] },
  },
  { nullable: true },
);

export const PROMPT_OPTION_SCHEMA = strictObjectSchema({
  key: { type: 'string' },
  label: { type: 'string' },
});

export const RELATIONSHIP_SCHEMA = strictObjectSchema({
  trust: { type: 'number' },
  fear: { type: 'number' },
  affinity: { type: 'number' },
});

const STAT_ENTRY_SCHEMA = strictObjectSchema({
  key: { type: 'string' },
  value: { type: 'number' },
});

const RELATIONSHIP_ENTRY_SCHEMA = strictObjectSchema({
  actorId: { type: 'string' },
  trust: { type: 'number' },
  fear: { type: 'number' },
  affinity: { type: 'number' },
});

export const PERSONA_SCHEMA = strictObjectSchema(
  {
    tagline: { type: 'string' },
    background: { type: 'string' },
    voice: { type: 'string' },
    goals: { type: 'array', items: { type: 'string' } },
  },
  { nullable: true },
);

export const ITEM_LOCATION_SCHEMA = strictObjectSchema({
  kind: { type: 'string', enum: ['ground', 'inventory', 'container'] },
  pos: NULLABLE_GRID_POS_SCHEMA,
  actorId: { type: ['string', 'null'] },
  containerId: { type: ['string', 'null'] },
});

const ITEM_COMPONENTS_SCHEMA = strictObjectSchema(
  {
    physical: strictObjectSchema(
      {
        massKg: { type: ['number', 'null'] },
        lengthCm: { type: ['number', 'null'] },
        widthCm: { type: ['number', 'null'] },
        heightCm: { type: ['number', 'null'] },
        volumeL: { type: ['number', 'null'] },
        anchored: { type: ['boolean', 'null'] },
        portable: { type: ['boolean', 'null'] },
      },
      { nullable: true },
    ),
    material: strictObjectSchema(
      {
        primary: { type: ['string', 'null'] },
        secondary: { type: ['array', 'null'], items: { type: 'string' } },
        rustable: { type: ['boolean', 'null'] },
        flammable: { type: ['boolean', 'null'] },
        rotProfile: { type: ['string', 'null'] },
      },
      { nullable: true },
    ),
    condition: strictObjectSchema(
      {
        durability: { type: ['number', 'null'] },
        wear: { type: ['number', 'null'] },
        rust: { type: ['number', 'null'] },
        rot: { type: ['number', 'null'] },
        broken: { type: ['boolean', 'null'] },
        notes: { type: ['array', 'null'], items: { type: 'string' } },
      },
      { nullable: true },
    ),
    ownership: strictObjectSchema(
      {
        legalOwnerId: { type: ['string', 'null'] },
        creatorId: { type: ['string', 'null'] },
        lastPossessorId: { type: ['string', 'null'] },
      },
      { nullable: true },
    ),
    container: strictObjectSchema(
      {
        capacityL: { type: ['number', 'null'] },
        acceptsTags: { type: ['array', 'null'], items: { type: 'string' } },
        sealed: { type: ['boolean', 'null'] },
      },
      { nullable: true },
    ),
  },
  { nullable: true },
);

export const CREATE_ENTITY_DATA_SCHEMA = strictObjectSchema({
  id: { type: 'string' },
  name: { type: 'string' },
  description: { type: ['string', 'null'] },
  location: { ...ITEM_LOCATION_SCHEMA, type: ['object', 'null'] },
  pos: NULLABLE_GRID_POS_SCHEMA,
  anchor: NULLABLE_GRID_POS_SCHEMA,
  facing: { type: ['string', 'null'], enum: ['north', 'south', 'east', 'west', null] },
  inventory: { type: ['array', 'null'], items: { type: 'string' } },
  stats: strictObjectSchema(
    {
      entries: { type: 'array', items: STAT_ENTRY_SCHEMA },
    },
    { nullable: true },
  ),
  tags: { type: ['array', 'null'], items: { type: 'string' } },
  archetype: { type: ['string', 'null'] },
  components: ITEM_COMPONENTS_SCHEMA,
  persona: PERSONA_SCHEMA,
  relationships: strictObjectSchema(
    {
      entries: { type: 'array', items: RELATIONSHIP_ENTRY_SCHEMA },
    },
    { nullable: true },
  ),
  radiusCells: { type: ['number', 'null'] },
  tideAccess: { type: ['string', 'null'], enum: ['always', 'low', 'high', null] },
  terrain: {
    type: ['string', 'null'],
    enum: ['road', 'path', 'beach', 'forest', 'mountain', 'water', 'interior', 'cavern', 'unknown', null],
  },
});

export const CREATE_ENTITY_SCHEMA = strictObjectSchema({
  kind: { type: 'string', enum: ['item', 'npc', 'location'] },
  data: CREATE_ENTITY_DATA_SCHEMA,
});

export const TRANSFER_ITEM_DATA_SCHEMA = strictObjectSchema(
  {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    tags: { type: ['array', 'null'], items: { type: 'string' } },
    archetype: { type: ['string', 'null'] },
    components: ITEM_COMPONENTS_SCHEMA,
  },
  { nullable: true },
);

export const PENDING_PROMPT_DATA_SCHEMA = strictObjectSchema(
  {
    locationId: { type: ['string', 'null'] },
    estimatedMinutes: { type: ['number', 'null'] },
    subject: { type: ['string', 'null'] },
    area: { type: ['string', 'null'] },
    direction: { type: ['string', 'null'], enum: ['east', 'west', 'north', 'south', null] },
  },
  { nullable: true },
);

export const EVENT_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: [
        'MoveActor',
        'PickUpItem',
        'DropItem',
        'TransferItem',
        'Speak',
        'AdvanceTime',
        'CreateEntity',
        'SetFlag',
        'TravelToLocation',
        'Explore',
        'Inspect',
        'RecordClue',
      ],
    },
    actorId: { type: ['string', 'null'] },
    to: NULLABLE_GRID_POS_SCHEMA,
    toLocationId: { type: ['string', 'null'] },
    mode: { type: ['string', 'null'], enum: ['walk', 'run', null] },
    itemId: { type: ['string', 'null'] },
    item: { ...TRANSFER_ITEM_DATA_SCHEMA, type: ['object', 'null'] },
    fromActorId: { type: ['string', 'null'] },
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
    area: { type: ['string', 'null'] },
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
    'item',
    'fromActorId',
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

export { strictObjectSchema };
