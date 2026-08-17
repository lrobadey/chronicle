// AgentOrchestratorWiring.test.ts - ensure agent wiring exposes required tools
// ==========================================================================

import { z } from 'zod';
import { createAgentExecutor } from '../agent/AgentOrchestrator.js';
import { registerDynamicTool, clearDynamicTools } from '../agent/registry.js';
import { createPagusClanisGTWG } from '../data/PagusClanis.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

async function run() {
  console.log('Starting AgentOrchestrator wiring test...');
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  const gtwg = createPagusClanisGTWG();
  let ledger = { entries: [] };
  let tick = 0;
  const history: string[] = ['Player: Hello', 'Agent: Salve, traveler.'];
  const pkg = {
    discoveredFacts: [],
    rumors: [],
    metadata: { version: '1.0.0', createdAt: new Date().toISOString(), lastModified: new Date().toISOString(), playerId: 'player-1' },
  };

  clearDynamicTools();
  registerDynamicTool(
    {
      name: 'dynamic_ping',
      description: 'Return a friendly pong',
      call: async () => ({ ok: true, message: 'pong' }),
    },
    z.object({})
  );

  const runtime = {
    getGTWG: () => gtwg,
    setGTWG: () => {},
    getLedger: () => ledger,
    setLedger: (l: any) => {
      ledger = l;
    },
    getTick: () => tick,
    projectPKG: async () => ({ pkg }),
    queryGTWG: async () => ({ entities: gtwg.entities }),
    queryPKG: async () => ({ entities: [] }),
    getConversation: async (n: number) => history.slice(-n),
    getPlayerId: () => 'player-1',
  };

  const executor = await createAgentExecutor(runtime as any, { enableDynamicTools: true, maxIterations: 2 });
  const toolNames = executor.tools.map((t: any) => t.name).sort();
  console.log('Registered tools:', toolNames);

  assert(toolNames.includes('get_conversation_history'), 'Conversation tool should be registered');
  assert(toolNames.includes('dynamic_ping'), 'Dynamic tool should be registered');

  const conversationTool = executor.tools.find((t: any) => t.name === 'get_conversation_history');
  assert(conversationTool, 'Conversation tool missing');
  const rawConversation = await conversationTool.invoke({ n: 2 });
  const parsedConversation = JSON.parse(rawConversation as string);
  console.log('Conversation tool response:', parsedConversation);
  assert(Array.isArray(parsedConversation.messages), 'Conversation response should contain messages array');
  assert(parsedConversation.messages.length === 2, 'Conversation tool should return requested number of messages');

  const dynamicTool = executor.tools.find((t: any) => t.name === 'dynamic_ping');
  assert(dynamicTool, 'Dynamic tool missing after registration');
  const rawDynamic = await dynamicTool.invoke({});
  const parsedDynamic = JSON.parse(rawDynamic as string);
  console.log('Dynamic tool response:', parsedDynamic);
  assert(parsedDynamic.ok === true && parsedDynamic.message === 'pong', 'Dynamic tool should return pong payload');

  console.log('✅ AgentOrchestrator wiring test passed!');
}

run().catch((error) => {
  console.error('❌ AgentOrchestrator wiring test failed:', error);
  process.exit(1);
});

