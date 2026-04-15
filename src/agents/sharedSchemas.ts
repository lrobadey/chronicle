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
    lifecycle: strictObjectSchema(
      {
        state: { type: ['string', 'null'], enum: ['intact', 'opened', 'broken', 'empty', 'consumed', 'ruined', 'unusable', null] },
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

const NON_EMPTY_STRING_SCHEMA = { type: 'string', minLength: 1 } as const;

/**
 * Schemas for event types that may appear as a payload inside ScheduleProcess
 * or SetNpcSchedule (i.e. all schedulable WorldEvent variants).
 * Exported so the schedule agent and GM tools can reference them.
 */
export const SCHEDULABLE_PAYLOAD_SCHEMA = {
  anyOf: [
    strictObjectSchema({
      type: { type: 'string', enum: ['MoveActor'] },
      actorId: { type: 'string' },
      to: GRID_POS_SCHEMA,
      toLocationId: { type: ['string', 'null'] },
      mode: { type: ['string', 'null'], enum: ['walk', 'run', null] },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['TravelToLocation'] },
      actorId: { type: 'string' },
      locationId: NON_EMPTY_STRING_SCHEMA,
      pace: { type: ['string', 'null'], enum: ['walk', 'run', null] },
      confirmId: { type: ['string', 'null'] },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['PickUpItem'] },
      actorId: { type: 'string' },
      itemId: { type: 'string' },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['DropItem'] },
      actorId: { type: 'string' },
      itemId: { type: 'string' },
      at: NULLABLE_GRID_POS_SCHEMA,
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['AffectItem'] },
      actorId: { type: 'string' },
      itemId: { type: 'string' },
      effect: { type: 'string', enum: ['pick_up', 'drop', 'transfer', 'open', 'close', 'break', 'consume', 'empty', 'fill', 'ruin'] },
      at: NULLABLE_GRID_POS_SCHEMA,
      targetActorId: { type: ['string', 'null'] },
      targetContainerId: { type: ['string', 'null'] },
      instrumentItemId: { type: ['string', 'null'] },
      nextLifecycle: { type: ['string', 'null'], enum: ['intact', 'opened', 'broken', 'empty', 'consumed', 'ruined', null] },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['TransferItem'] },
      itemId: { type: ['string', 'null'] },
      item: { ...TRANSFER_ITEM_DATA_SCHEMA, type: ['object', 'null'] },
      fromActorId: { type: ['string', 'null'] },
      toActorId: { type: ['string', 'null'] },
      at: NULLABLE_GRID_POS_SCHEMA,
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['Speak'] },
      actorId: { type: 'string' },
      text: NON_EMPTY_STRING_SCHEMA,
      toActorId: { type: ['string', 'null'] },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['CreateEntity'] },
      entity: CREATE_ENTITY_SCHEMA,
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['SetFlag'] },
      key: NON_EMPTY_STRING_SCHEMA,
      value: { type: ['string', 'number', 'boolean', 'null'] },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['ModifyReputation'] },
      actorId: { type: 'string' },
      factionId: { type: 'string' },
      delta: { type: 'number' },
      reason: { type: ['string', 'null'] },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['SpreadRumor'] },
      fromActorId: { type: ['string', 'null'] },
      toActorId: { type: 'string' },
      rumor: NON_EMPTY_STRING_SCHEMA,
      subject: { type: ['string', 'null'] },
      note: { type: ['string', 'null'] },
    }),
  ],
} as const;

/** Schema for a single NPC schedule entry (used in SetNpcSchedule and the schedule agent). */
export const NPC_SCHEDULE_ENTRY_SCHEMA = strictObjectSchema({
  id: { type: 'string' },
  label: { type: 'string' },
  atHour: { type: 'number' },
  payload: SCHEDULABLE_PAYLOAD_SCHEMA,
});

export const EVENT_ITEM_SCHEMA = {
  anyOf: [
    ...SCHEDULABLE_PAYLOAD_SCHEMA.anyOf,
    strictObjectSchema({
      type: { type: 'string', enum: ['AdvanceTime'] },
      minutes: { type: 'number' },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['Explore'] },
      actorId: { type: 'string' },
      area: NON_EMPTY_STRING_SCHEMA,
      direction: { type: ['string', 'null'], enum: ['east', 'west', 'north', 'south', null] },
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['Inspect'] },
      actorId: { type: 'string' },
      subject: NON_EMPTY_STRING_SCHEMA,
      note: { type: ['string', 'null'] },
    }),
    strictObjectSchema({
      type: { type: 'string', enum: ['RecordClue'] },
      actorId: { type: 'string' },
      text: NON_EMPTY_STRING_SCHEMA,
      subject: { type: ['string', 'null'] },
      note: { type: ['string', 'null'] },
    }),
    // ScheduleProcess: register a future world event by elapsed-minutes threshold
    strictObjectSchema({
      type: { type: 'string', enum: ['ScheduleProcess'] },
      process: strictObjectSchema({
        id: { type: 'string' },
        label: { type: 'string' },
        dueAtMinutes: { type: 'number' },
        cadenceMinutes: { type: ['number', 'null'] },
        payload: SCHEDULABLE_PAYLOAD_SCHEMA,
      }),
      note: { type: ['string', 'null'] },
    }),
    // SetNpcSchedule: set or replace an NPC's daily recurring schedule
    strictObjectSchema({
      type: { type: 'string', enum: ['SetNpcSchedule'] },
      actorId: { type: 'string' },
      entries: { type: 'array', items: NPC_SCHEDULE_ENTRY_SCHEMA },
      note: { type: ['string', 'null'] },
    }),
  ],
} as const;

export { strictObjectSchema };
