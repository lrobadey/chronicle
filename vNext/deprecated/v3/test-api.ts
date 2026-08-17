import 'dotenv/config';
import { createSimpleWorld, type SimpleWorld } from './state/world';
import { createToolRuntime } from './tools/index';
import type { Patch } from './tools/types';
import { applyPatches } from './state/arbiter';
import { runGMAgentTurn } from './agents/gm';
import { narrateSimple } from './agents/narrator';
import { DEFAULT_GM_MODEL } from './config';

function cloneWorld(world: SimpleWorld): SimpleWorld {
  return JSON.parse(JSON.stringify(world));
}

async function testTurn(world: SimpleWorld, input: string, apiKey: string): Promise<SimpleWorld> {
  console.log(`\n>>> Testing: "${input}"`);
  console.log('---');
  
  let shadow = cloneWorld(world);
  const runtime = createToolRuntime(() => shadow, (w) => { shadow = w; });
  
  const startTime = Date.now();
  const gm = await runGMAgentTurn({ 
    apiKey, 
    model: DEFAULT_GM_MODEL,
    runtime, 
    playerText: input, 
    world 
  });
  const duration = Date.now() - startTime;
  
  console.log(`Used fallback: ${gm.usedFallback ? 'YES ❌' : 'NO ✅'}`);
  console.log(`Duration: ${duration}ms`);
  // Actions array removed - state changes are tracked via patches
  console.log(`Patches: ${gm.result.patches.length}`);
  if (gm.intermediateSteps.length > 0) {
    console.log(`Tool calls: ${gm.intermediateSteps.length}`);
  }
  
  const next = gm.usedFallback
    ? (gm.result.patches.length ? applyPatches(world, gm.result.patches as Patch[], 'fallback patch') : world)
    : shadow;
  
  const narration = narrateSimple(input, next, gm.result.patches as Patch[], gm.result.stateSummary);
  const loc = next.locations[next.player.location];
  const inv = next.player.inventory.map(i => i.name).join(', ') || '(empty)';
  
  console.log(`\nNarration: ${narration}`);
  console.log(`Location: ${loc?.name || next.player.location}`);
  console.log(`Inventory: ${inv}`);
  
  return next;
}

async function main() {
  const apiKey = (process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  
  if (!apiKey) {
    console.error('❌ VITE_OPENAI_API_KEY not found in .env file. Please set it to test the LLM.');
    process.exit(1);
  }
  
  console.log('🧪 Testing v3 GM Agent with LLM');
  console.log(`Model: ${DEFAULT_GM_MODEL}`);
  console.log(`API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
  
  let world = createSimpleWorld();
  
  try {
    world = await testTurn(world, 'look around', apiKey);
    world = await testTurn(world, 'go to the tavern', apiKey);
    world = await testTurn(world, 'what items are here?', apiKey);
    
    console.log('\n✅ All tests completed successfully!');
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    if (err instanceof Error) {
      console.error('Error message:', err.message);
      if (err.stack) {
        console.error('\nStack trace:');
        console.error(err.stack);
      }
    }
    process.exit(1);
  }
}

main();

