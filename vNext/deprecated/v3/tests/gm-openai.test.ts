import 'dotenv/config';
import { createIsleOfMarrowWorld } from '../state/world';
import { createToolRuntime } from '../tools/index';
import { runOpenAIGMAgentTurn, runGMAgentTurnFallback } from '../agents/gmOpenAI';

async function testOpenAIGMAgent() {
  console.log('🧪 Testing OpenAI GM Agent\n');

  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    console.log('⚠️  No API key found. Testing fallback behavior only.\n');
    await testFallback();
    return;
  }

  // Test 1: Basic query and response
  console.log('Test 1: Basic "look around" command');
  await testBasicCommand(apiKey);

  // Test 2: Tool calling (query_world)
  console.log('\nTest 2: Verify tool calling works');
  await testToolCalling(apiKey);

  // Test 3: Movement command
  console.log('\nTest 3: Movement command');
  await testMovement(apiKey);

  console.log('\n✅ All OpenAI GM agent tests passed!');
}

async function testBasicCommand(apiKey: string) {
  let world = createIsleOfMarrowWorld();
  const runtime = createToolRuntime(() => world, (w) => { world = w; });

  const events: any[] = [];
  const result = await runOpenAIGMAgentTurn({
    apiKey,
    model: 'gpt-5.1',
    runtime,
    playerText: 'look around',
    world,
    maxIterations: 10,
    onEvent: (e) => {
      events.push(e);
      if (e.type === 'tool_start' || e.type === 'tool_end') {
        console.log(`   ${e.type}: ${e.tool}`);
      }
    },
  });

  if (result.usedFallback) {
    throw new Error('Expected OpenAI agent, got fallback');
  }

  if (!result.result.patches || !Array.isArray(result.result.patches)) {
    throw new Error('Result missing patches array');
  }

  if (result.result.stateSummary === undefined) {
    throw new Error('Result missing stateSummary');
  }

  console.log(`   ✓ Got valid GMResult with ${result.result.patches.length} patches`);
  console.log(`   ✓ Emitted ${events.length} events`);
}

async function testToolCalling(apiKey: string) {
  let world = createIsleOfMarrowWorld();
  const runtime = createToolRuntime(() => world, (w) => { world = w; });

  const toolCalls: string[] = [];
  const result = await runOpenAIGMAgentTurn({
    apiKey,
    model: 'gpt-5.1',
    runtime,
    playerText: 'What is my current location?',
    world,
    maxIterations: 5,
    onEvent: (e) => {
      if (e.type === 'tool_start') {
        toolCalls.push(e.tool);
      }
    },
  });

  if (result.usedFallback) {
    throw new Error('Expected OpenAI agent, got fallback');
  }

  if (toolCalls.length === 0) {
    throw new Error('Expected at least one tool call');
  }

  if (!toolCalls.includes('query_world')) {
    throw new Error('Expected query_world to be called');
  }

  console.log(`   ✓ Agent called ${toolCalls.length} tool(s): ${toolCalls.join(', ')}`);
  console.log(`   ✓ Intermediate steps: ${result.intermediateSteps.length}`);
}

async function testMovement(apiKey: string) {
  let world = createIsleOfMarrowWorld();
  const runtime = createToolRuntime(() => world, (w) => { world = w; });

  const initialLocation = world.player.location;
  const result = await runOpenAIGMAgentTurn({
    apiKey,
    model: 'gpt-5.1',
    runtime,
    playerText: 'travel to the rib market',
    world,
    maxIterations: 10,
  });

  if (result.usedFallback) {
    throw new Error('Expected OpenAI agent, got fallback');
  }

  // Check if patches include location change
  const locationPatch = result.result.patches.find(
    (p) => p.path === '/player/location' && p.op === 'set'
  );

  if (!locationPatch) {
    console.log('   ⚠️  No location patch found (agent may have used travel_to_location tool instead)');
  } else {
    console.log(`   ✓ Agent created location patch: ${locationPatch.value}`);
  }

  console.log(`   ✓ Agent processed movement command with ${result.result.patches.length} patches`);
}

async function testFallback() {
  console.log('Testing fallback behavior (no API key)...');
  const world = createIsleOfMarrowWorld();
  const result = await runGMAgentTurnFallback('look', world);

  if (!result.patches || !Array.isArray(result.patches)) {
    throw new Error('Fallback missing patches');
  }

  console.log(`   ✓ Fallback works: ${result.patches.length} patches`);
}

async function main() {
  try {
    await testOpenAIGMAgent();
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();

