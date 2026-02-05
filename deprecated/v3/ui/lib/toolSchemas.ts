import { ToolDefinition } from './openai';

export const OPENAI_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'query_world_state',
      description: 'Query for specific information about the current state of the world, including locations, items, and player status. Use this to understand the situation before acting.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A focused, natural language query about the world state. E.g., "Where is the player?", "What is in the tavern?", "What are the exits from the current location?", "What is in my inventory?"',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_world_state',
      description: 'Applies a patch to update the world state. Use this to move the player, add/remove items from inventory, or change entity properties. This is the ONLY way to change the game state.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The JSON Pointer (RFC 6901) path to the value to update, starting from gtwg or pkg. E.g., "/gtwg/player/location", "/pkg/inventory/0".',
          },
          value: {
            type: 'string',
            description: 'The new value, formatted as a valid JSON string (e.g., `"tavern"`, `123`, `true`, `{"id":"key", "name":"a rusty key", "isTaken": false}`).',
          },
          description: {
            type: 'string',
            description: 'A brief, past-tense description of the change being made for the game ledger. E.g., "Player moved to the tavern.", "Player took the rusty key."'
          }
        },
        required: ['path', 'value', 'description'],
        additionalProperties: false,
      },
    },
  },
];
