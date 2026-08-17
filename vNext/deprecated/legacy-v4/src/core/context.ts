/**
 * Chronicle v4 - Context Manager
 * 
 * Intelligent context selection to reduce prompt bloat.
 * Selects relevance based on player query and world state.
 */

import type { World } from './world';

export interface ContextOptions {
  includeWorld?: boolean;
  includeInventory?: boolean;
  includeNearby?: boolean;
  includeHistory?: boolean;
  maxLedgerItems?: number;
}

export class ContextManager {
  static build(world: World, query: string, options: ContextOptions = {}): string {
    const lines: string[] = [];
    const turn = (world.meta?.turn || 0) + 1;
    const q = query.toLowerCase();

    // 1. Core State (Always included)
    lines.push(`Turn ${turn}`);
    lines.push(`Location: ${world.locations[world.player.location]?.name || world.player.location}`);
    
    // 2. Position (Always included for spatial awareness)
    const pos = world.player.pos;
    lines.push(`Position: (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`);

    // 3. Time (Always included)
    if (world.systems?.time) {
      const t = world.systems.time;
      lines.push(`Time: Day ${Math.floor(t.elapsedMinutes / 1440) + 1}, Hour ${Math.floor((t.elapsedMinutes % 1440) / 60)}`);
    }

    // 4. Inventory (Attention-based)
    // Include if query mentions "inventory", "bag", "item", "take", "drop", or usage of specific items
    if (options.includeInventory || q.match(/inventory|bag|holding|carry|take|drop|use|equip/)) {
      const inv = world.player.inventory.map(i => i.name).join(', ') || '(empty)';
      lines.push(`Inventory: ${inv}`);
    }

    // 5. Weather/Environment (Attention-based)
    // Include if query mentions "look", "weather", "sky", "rain", "storm", "see"
    if (q.match(/look|see|weather|sky|rain|storm|fog|time/)) {
      if (world.systems?.weather) {
        const w = world.systems.weather;
        lines.push(`Weather: ${w.type} (${w.intensity}/5), ${w.temperatureC}C`);
      }
      const desc = world.locations[world.player.location]?.description;
      if (desc) lines.push(`Description: ${desc}`);
    }

    // 6. Recent History (Always included, but configurable length)
    const limit = options.maxLedgerItems ?? 5;
    const ledger = world.ledger.slice(-limit);
    if (ledger.length) {
      lines.push('Recent events:');
      lines.push(...ledger.map(e => `- ${e}`));
    }

    return lines.join('\n');
  }
}
