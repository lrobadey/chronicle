import type { ResponseToolDefinition } from '../llm/types';

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
    strict: false,
  },
  {
    type: 'function',
    name: 'consult_npc',
    description: 'Ask a specific NPC for dialogue + intent.',
    parameters: {
      type: 'object',
      properties: {
        npcId: { type: 'string' },
        topic: { type: 'string' },
      },
      required: ['npcId'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'propose_events',
    description: 'Propose one or more domain events. The engine validates and applies them.',
    parameters: {
      type: 'object',
      properties: {
        events: { type: 'array', items: { type: 'object' } },
      },
      required: ['events'],
      additionalProperties: false,
    },
    strict: false,
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
    strict: false,
  },
];
