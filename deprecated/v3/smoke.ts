import { createSimpleWorld, type SimpleWorld } from './state/world';
import { createToolRuntime } from './tools/index';
import type { Patch } from './tools/types';
import { applyPatches } from './state/arbiter';
import { runGMAgentTurn } from './agents/gm';
import { narrateSimple } from './agents/narrator';

function cloneWorld(world: SimpleWorld): SimpleWorld {
  return JSON.parse(JSON.stringify(world));
}

async function turn(world: SimpleWorld, input: string): Promise<SimpleWorld> {
  let shadow = cloneWorld(world);
  const runtime = createToolRuntime(() => shadow, (w) => { shadow = w; });
  const gm = await runGMAgentTurn({ apiKey: undefined, runtime, playerText: input, world });

  const next = gm.usedFallback
    ? (gm.result.patches.length ? applyPatches(world, gm.result.patches as Patch[], 'fallback patch') : world)
    : shadow;

  const narration = narrateSimple(input, next, gm.result.patches as Patch[], gm.result.stateSummary);
  const loc = next.locations[next.player.location];
  const inv = next.player.inventory.map(i => i.name).join(', ') || '(empty)';
  console.log(`> ${input}`);
  console.log(narration);
  console.log(`- Location: ${loc?.name || next.player.location}`);
  console.log(`- Inventory: ${inv}`);
  console.log();
  return next;
}

async function main() {
  let world = createSimpleWorld();
  console.log('Running v3 smoke (fallback mode)...');
  console.log();
  world = await turn(world, 'look');
  world = await turn(world, 'go tavern');
  world = await turn(world, 'take key');
}

main().catch((e) => {
  console.error('Smoke failed:', e);
  process.exit(1);
});


