import type { ResponseToolDefinition } from '../../llm/types';
import { EVENT_ITEM_SCHEMA, strictObjectSchema } from '../../sharedSchemas';

export const CHARACTER_RESULT_TOOL_NAME = 'emit_character_result';

export const CHARACTER_TOOL_DEFS: ResponseToolDefinition[] = [
  {
    type: 'function',
    name: 'inspect_character_scene',
    description: 'Inspect the local character scene packet, including nearby NPCs and their persona summaries.',
    parameters: strictObjectSchema({
      question: { type: ['string', 'null'] },
      focusNpcId: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_conversation_history',
    description: 'Read the recent player-facing conversation history for this scene.',
    parameters: strictObjectSchema({
      limit: { type: ['number', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_relationship_state',
    description: 'Inspect relationship state for one NPC or all nearby NPCs.',
    parameters: strictObjectSchema({
      npcId: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'inspect_faction_context',
    description: 'Inspect faction context relevant to the nearby NPCs and the player.',
    parameters: strictObjectSchema({
      npcId: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'worker_select_npc',
    description: 'Choose the best NPC to answer this turn from the current shortlist.',
    parameters: strictObjectSchema({
      playerText: { type: ['string', 'null'] },
      maxCandidates: { type: ['number', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'worker_draft_npc_reply',
    description: 'Draft a public NPC reply for a selected NPC.',
    parameters: strictObjectSchema({
      npcId: { type: 'string' },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'worker_draft_private_intent',
    description: 'Draft the selected NPC private intent note for this turn.',
    parameters: strictObjectSchema({
      npcId: { type: 'string' },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: CHARACTER_RESULT_TOOL_NAME,
    description: 'Emit the final Character Designer result for Steward synthesis.',
    parameters: strictObjectSchema({
      summary: { type: 'string' },
      candidateEvents: { type: 'array', items: EVENT_ITEM_SCHEMA },
      selectedNpcIds: { type: 'array', items: { type: 'string' } },
      privateIntentNotes: {
        type: 'array',
        items: strictObjectSchema({
          npcId: { type: 'string' },
          note: { type: 'string' },
        }),
      },
      relationshipNotes: {
        type: ['array', 'null'],
        items: strictObjectSchema({
          npcId: { type: 'string' },
          note: { type: 'string' },
        }),
      },
      artifacts: {
        type: 'array',
        items: strictObjectSchema({
          npcId: { type: 'string' },
          publicUtterance: { type: 'string' },
          emotionalTone: { type: ['string', 'null'] },
          privateIntent: { type: 'string' },
        }),
      },
      warnings: { type: ['array', 'null'], items: { type: 'string' } },
    }),
    strict: true,
  },
];
