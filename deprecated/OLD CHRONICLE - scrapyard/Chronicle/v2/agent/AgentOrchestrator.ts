// AgentOrchestrator.ts - Constructs a ReAct agent and exposes a single-turn API
// =================================================================================

import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createReactAgent } from 'langchain/agents';
import { PromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { SYSTEM_PROMPT, REACT_INSTRUCTIONS, PLANNER_PROMPT, CRITIC_PROMPT } from './prompt.js';
import {
  asDynamicStructuredTool,
  createQueryGTWGTool,
  createQueryPKGTool,
  createRunTravelSystemTool,
  createCalcTravelTool,
  createApplyPatchesTool,
  createProjectPKGTool,
  createDiscoverEntityTool,
  createAdvanceTimeTool,
  createConversationHistoryTool,
  RunSystemSchema,
  ApplyPatchesSchema,
  ProjectPKGSchema,
  QuerySchema,
  ConversationHistorySchema,
} from './tools.js';
import type { AgentInputs, AgentOutputs, AgentConfig, AgentMemory } from './types.js';
import { asLangChainTools } from './registry.js';

// ----------------------------------------------------------------------------
// Construction helpers (how): build LLM, prompt, and bound tools
// ----------------------------------------------------------------------------

function buildLLM() {
  const model = process.env.OPENAI_MODEL || 'gpt-4.1';
  const apiKey = process.env.OPENAI_API_KEY || '';
  // Enable token streaming so callbacks can surface live progress via SSE
  return new ChatOpenAI({ model, apiKey, streaming: true });
}

function buildPrompt() {
  // Compose a ReAct-style prompt compatible with createReactAgent
  return PromptTemplate.fromTemplate(
    `${SYSTEM_PROMPT}\n\n${REACT_INSTRUCTIONS}\n\n` +
      `Available tools:\n{tools}\n\n` +
      `You can call: {tool_names}\n\n` +
      `Player Input:\n{input}\n\n` +
      `{agent_scratchpad}`
  );
}

export interface AgentRuntimeDeps {
  // world/ledger accessors
  getGTWG: () => any;
  setGTWG: (g: any) => void;
  getLedger: () => any;
  setLedger: (l: any) => void;
  getTick: () => number;
  // query/project/conversation
  projectPKG: (input: { playerId: string; gtwg: any }) => Promise<{ pkg: any }>;
  queryGTWG: (q: Record<string, any>) => Promise<any>;
  queryPKG: (q: Record<string, any>) => Promise<any>;
  getConversation: (n: number) => Promise<string[]>;
  getPlayerId?: () => string;
}

export async function createAgentExecutor(runtime: AgentRuntimeDeps, config: AgentConfig = {}): Promise<AgentExecutor> {
  const baseTools = [
    asDynamicStructuredTool(createQueryGTWGTool(runtime as any), QuerySchema),
    asDynamicStructuredTool(createQueryPKGTool(runtime as any), QuerySchema),
    asDynamicStructuredTool(createCalcTravelTool(runtime as any), z.union([
      z.string(),
      z.object({
        fromLocationId: z.string(),
        toLocationId: z.string(),
        walkingMetersPerMinute: z.number().positive().optional()
      })
    ])),
    asDynamicStructuredTool(createRunTravelSystemTool(runtime as any), z.union([
      z.string(),
      z.object({
        fromLocationId: z.string(),
        toLocationId: z.string(),
        action: z.string().optional(),
        playerId: z.string().min(1).optional()
      })
    ])),
    asDynamicStructuredTool(createAdvanceTimeTool(runtime as any), z.union([
      z.string(),
      z.object({
        minutes: z.number().positive().optional(),
        duration: z.union([
          z.string(),
          z.object({
            days: z.number().int().nonnegative().optional(),
            hours: z.number().int().nonnegative().optional(),
            minutes: z.number().int().nonnegative().optional(),
          })
        ]).optional(),
        reason: z.string().optional()
      })
    ])),
    asDynamicStructuredTool(createApplyPatchesTool(runtime as any), z.union([
      z.string(),
      ApplyPatchesSchema
    ])),
    asDynamicStructuredTool(createProjectPKGTool(runtime as any), z.union([
      z.string(),
      ProjectPKGSchema
    ])),
    asDynamicStructuredTool(createDiscoverEntityTool(runtime as any), z.union([
      z.string(),
      z.object({ entityId: z.string().optional(), name: z.string().optional() })
    ])),
    asDynamicStructuredTool(createConversationHistoryTool(runtime as any), ConversationHistorySchema),
  ];
  const dynamic = config.enableDynamicTools === false ? [] : asLangChainTools();
  const tools = [...baseTools, ...dynamic]; // Full tool set for demo

  const llm = buildLLM();
  const prompt = buildPrompt();
  const agent = await createReactAgent({ llm, tools, prompt });
  const executor = new AgentExecutor({
    agent,
    tools,
    verbose: true,
    maxIterations: config.maxIterations ?? 12,
    returnIntermediateSteps: true,
  });
  return executor;
}

// ----------------------------------------------------------------------------
// Public API (what): run a single agent turn with provided inputs
// ----------------------------------------------------------------------------

export async function runAgentTurn(executor: AgentExecutor, inputs: AgentInputs, options?: { memory?: AgentMemory; config?: AgentConfig }): Promise<AgentOutputs> {
  const inputPayload = {
    input: inputs.playerInput,
    context: inputs.context,
  } as any;
  const res = await executor.invoke(inputPayload);
  // Optional memory append of final output (high-level trace)
  if (options?.memory) {
    const finalText = typeof res?.output === 'string' ? res.output : JSON.stringify(res);
    await options.memory.append({ tick: inputs.context.tick, playerId: inputs.context.playerId, finalNarrative: finalText });
  }

  const narrative =
    typeof res?.output === 'string'
      ? res.output
      : typeof res === 'string'
        ? res
        : JSON.stringify(res);

  return {
    narrative,
    intermediateSteps: res?.intermediateSteps,
    raw: res,
  };
}
