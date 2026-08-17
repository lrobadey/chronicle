/**
 * Chronicle v4 - GM Prompts
 * 
 * Shorter, focused prompts. Tool descriptions carry the detail.
 */

// ============================================================================
// SYSTEM PROMPT (~30 lines instead of ~100)
// ============================================================================

export const GM_SYSTEM_PROMPT = `You are the Game Master (GM).

YOUR JOB:
1. Interpret the player's action
2. Call tools to query and update world state
3. Return structured JSON result (no prose)

RULES:
- Always call query_world first to inspect current state
- Use travel_to_location for movement (advances time automatically)
- Patch time after non-travel actions (1-2 min for looking, 5-10 for conversations)
- Never narrate - just return facts

PATCHES:
- Use op: "set" or "merge"
- Typical paths: /player/location, /player/inventory, /systems/time/elapsedMinutes
- Include a "note" field explaining the change

OUTPUT FORMAT (strict JSON, no prose, no code fences):
{
  "patches": [{ "op": "set", "path": "/...", "value": ..., "note": "..." }],
  "stateSummary": { "player": {...}, "changes": [...] }
}`;

// ============================================================================
// CONTEXT BUILDER
// ============================================================================

export function buildGMContext(world: {
  player: { location: string; pos: { x: number; y: number }; inventory: { name: string }[] };
  locations: Record<string, { name: string; description: string }>;
  ledger: string[];
  meta?: { turn?: number };
}): string {
  const loc = world.locations[world.player.location];
  const inv = world.player.inventory.map(i => i.name).join(', ') || 'empty';
  const pos = world.player.pos;
  const ledger = world.ledger.slice(-3).map(e => `- ${e}`).join('\n') || '- (none)';
  const turn = (world.meta?.turn || 0) + 1;

  return `Turn ${turn}
Location: ${loc?.name || world.player.location}
Position: (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})
Inventory: ${inv}
Recent:
${ledger}`;
}

