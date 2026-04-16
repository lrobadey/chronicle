import type { ResponseToolDefinition } from '../../llm/types';
import {
  EVENT_ITEM_SCHEMA,
  PENDING_PROMPT_DATA_SCHEMA,
  PROMPT_OPTION_SCHEMA,
  strictObjectSchema,
} from '../../sharedSchemas';

export const SYSTEMS_RESULT_TOOL_NAME = 'emit_systems_result';

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

export const SYSTEMS_TOOL_DEFS: ResponseToolDefinition[] = [
  {
    type: 'function',
    name: 'inspect_systems_scene',
    description: 'Inspect the current systems-scoped scene packet.',
    parameters: strictObjectSchema({
      question: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_local_affordances',
    description: 'Inspect local affordances for mechanics reasoning.',
    parameters: strictObjectSchema({
      focus: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_pending_prompt',
    description: 'Inspect the currently active pending prompt, if any.',
    parameters: strictObjectSchema({}),
    strict: true,
  },
  {
    type: 'function',
    name: 'resolve_mechanics',
    description: 'Draft a mechanics resolution for the current action.',
    parameters: strictObjectSchema({
      playerText: { type: ['string', 'null'] },
      objective: { type: ['string', 'null'] },
      focus: { type: ['string', 'null'] },
      pendingPrompt: MECHANICS_PENDING_PROMPT_SCHEMA,
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'review_mechanics_resolution',
    description: 'Approve, revise, or reject a mechanics resolution by id.',
    parameters: strictObjectSchema({
      resolutionId: { type: 'string' },
      action: { type: 'string', enum: ['approve', 'revise', 'reject'] },
      feedback: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'schedule_task',
    description: 'Draft schedule events for a task or NPC routine.',
    parameters: strictObjectSchema({
      task: { type: 'string' },
      actorId: { type: ['string', 'null'] },
      timeHint: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'review_schedule_resolution',
    description: 'Approve, revise, or reject a schedule resolution by id.',
    parameters: strictObjectSchema({
      scheduleResolutionId: { type: 'string' },
      action: { type: 'string', enum: ['approve', 'revise', 'reject'] },
      feedback: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: SYSTEMS_RESULT_TOOL_NAME,
    description: 'Emit the final Systems Designer result for Steward synthesis.',
    parameters: strictObjectSchema({
      summary: { type: 'string' },
      candidateEvents: { type: 'array', items: EVENT_ITEM_SCHEMA },
      narratorPacket: strictObjectSchema(
        {
          version: { type: 'string', enum: ['systems_v1'] },
          intent: { type: 'string', enum: ['observation', 'cardinal_movement', 'general_systems'] },
          playerText: { type: 'string' },
          summary: { type: 'string' },
          telemetry: { type: 'object' },
          observation: { type: 'object' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        { nullable: true },
      ),
      pendingPromptRecommendation: MECHANICS_PENDING_PROMPT_SCHEMA,
      warnings: { type: ['array', 'null'], items: { type: 'string' } },
      handled: { type: ['boolean', 'null'] },
      fallbackReason: { type: ['string', 'null'] },
      artifacts: {
        type: ['array', 'null'],
        items: strictObjectSchema({
          type: { type: 'string', enum: ['mechanics', 'schedule', 'inspection'] },
          summary: { type: 'string' },
          candidateEvents: { type: 'array', items: EVENT_ITEM_SCHEMA },
        }),
      },
    }),
    strict: true,
  },
];
