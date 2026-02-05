// runAgentTurn.ts - Injectable single-turn driver (what), orchestrating how via DI
// =================================================================================

import type { AgentExecutor } from 'langchain/agents';
import type { AgentInputs, AgentOutputs } from './types';
import { runAgentTurn as run } from './AgentOrchestrator';

export async function runAgentTurn(executor: AgentExecutor, inputs: AgentInputs): Promise<AgentOutputs> {
  return run(executor, inputs);
}


