// Lazy imports for LangChain - only load when needed
let ChatOpenAI: any;
let createToolCallingAgent: any;
let AgentExecutor: any;
let ChatPromptTemplate: any;
let MessagesPlaceholder: any;

async function ensureLangChainImports() {
  if (!ChatOpenAI) {
    const langchainOpenAI = await import('@langchain/openai');
    const langchainAgents = await import('langchain/agents');
    const langchainPrompts = await import('@langchain/core/prompts');
    ChatOpenAI = langchainOpenAI.ChatOpenAI;
    createToolCallingAgent = langchainAgents.createToolCallingAgent;
    AgentExecutor = langchainAgents.AgentExecutor;
    ChatPromptTemplate = langchainPrompts.ChatPromptTemplate;
    MessagesPlaceholder = langchainPrompts.MessagesPlaceholder;
  }
}
import { z } from 'zod';
import type { SimpleWorld } from '../state/world';
import { DEFAULT_GM_MODEL, DEFAULT_GM_TEMPERATURE } from '../config';
import { GM_SYSTEM_PROMPT, GM_REACT_INSTRUCTIONS, GM_MOVE_REFUSAL_RULES } from './prompts';
import { createLangChainTools, type ToolRuntime } from '../tools/index';
import { PatchSchema, type Patch } from '../tools/types';
import crypto from 'crypto';
import { buildTurnTelemetry } from '../state/telemetry';
import { projectPKGFromGraph } from '../state/pkg';
import { buildTurnConstraints, formatTurnConstraints, validatePatchesAgainstConstraints } from '../state/constraints';
import { buildFilteredContext, formatFilteredContext } from './context/filter';
import { runOpenAIGMAgentTurn, runGMAgentTurnFallback as runDeterministicFallback } from './gmOpenAI';
import { formatConversationHistory, type GMConversationTurn } from './gmConversation';

const GM_RESULT_SCHEMA = z.object({
  patches: z.array(PatchSchema).default([]),
  stateSummary: z.any().default({}),
});

export type GMResult = z.infer<typeof GM_RESULT_SCHEMA>;

export interface CreateGMAgentExecutorParams {
  apiKey: string;
  model?: string;
  runtime: ToolRuntime;
  maxIterations?: number;
  temperature?: number;
}

export interface RunGMAgentTurnParams {
  apiKey?: string;
  model?: string;
  runtime: ToolRuntime;
  playerText: string;
  world: SimpleWorld;
  latent?: { label: string; dir?: string }[];
  conversationHistory?: GMConversationTurn[];
  maxIterations?: number;
  temperature?: number;
  onEvent?: (event: GMEvent) => void;
}

export interface RunGMAgentTurnResult {
  result: GMResult;
  intermediateSteps: any[];
  raw: unknown;
  usedFallback: boolean;
}

export type GMEvent =
  | { type: 'llm_start'; prompts: string[] }
  | { type: 'llm_token'; token: string }
  | { type: 'llm_end' }
  | { type: 'tool_start'; tool: string; input: unknown }
  | { type: 'tool_end'; tool: string; output: unknown }
  | { type: 'agent_action'; action: unknown }
  | { type: 'error'; message: string };

export async function createGMAgentExecutor({
  apiKey,
  model,
  runtime,
  maxIterations,
  temperature,
}: CreateGMAgentExecutorParams): Promise<any> {
  if (!apiKey) {
    throw new Error('OpenAI API key is required to create the GM agent executor.');
  }

  await ensureLangChainImports();
  const tools = createLangChainTools(runtime);
  const selectedModel = model ?? DEFAULT_GM_MODEL;
  const isGpt5Family = selectedModel.startsWith('gpt-5');

  // GPT-5.x models handle sampling differently; avoid sending temperature.
  const selectedTemperature = isGpt5Family ? undefined : temperature ?? DEFAULT_GM_TEMPERATURE;

  const llmConfig: any = {
    apiKey,
    model: selectedModel,
    streaming: true,
  };
  if (selectedTemperature !== undefined) {
    llmConfig.temperature = selectedTemperature;
  }

  // Enable low reasoning effort for GPT-5.1 by default to reduce latency/cost.
  if (selectedModel === 'gpt-5.1') {
    llmConfig.reasoning_effort = 'medium';
  }

  let llm = new ChatOpenAI(llmConfig);

  // For legacy gpt-5, bind the LLM to remove stop sequences from all invocations.
  if (selectedModel === 'gpt-5') {
    llm = (llm as any).bind({ stop: undefined }) as any;
  }

  // Escape braces in system prompt to prevent template parsing errors
  const escapedSystemPrompt = GM_SYSTEM_PROMPT.replace(/\{/g, '{{').replace(/\}/g, '}}');
  // Escape braces in ReAct instructions to prevent LangChain from treating JSON braces as template vars
  const escapedReactInstructions = GM_REACT_INSTRUCTIONS.replace(/\{/g, '{{').replace(/\}/g, '}}');
  
  const prompt = (ChatPromptTemplate as any).fromMessages([
    [
      'system',
      [
        escapedSystemPrompt,
        'Use available tools to inspect/update world. Do not narrate.',
        'Final output: STRICT JSON ONLY (no prose, no code fences): {{"actions": string[], "patches": Patch[], "stateSummary": any}}.',
      ].join('\n'),
    ],
    ['system', escapedReactInstructions],
    ['system', GM_MOVE_REFUSAL_RULES.replace(/\{/g, '{{').replace(/\}/g, '}}')],
    ['system', 'World Context:\n{world_context}'],
    ['system', '{latent_context}'],
    ['system', '{conversation_context}'],
    ['human', '{input}'],
    new (MessagesPlaceholder as any)('agent_scratchpad'),
  ]);

  const agent = await createToolCallingAgent({ llm: llm as any, tools, prompt });
  return new (AgentExecutor as any)({
    agent,
    tools,
    verbose: false,
    maxIterations: maxIterations ?? 10,
    returnIntermediateSteps: true,
  });
}

interface TurnContract {
  queriedWorld: boolean;
  performedActions: boolean;
  returnedValidJson: boolean;
}

function validateTurnContract(intermediateSteps: any[], result: GMResult): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const contract: TurnContract = {
    queriedWorld: false,
    performedActions: false,
    returnedValidJson: true,
  };

  // Check if query_world was called
  const toolCalls = intermediateSteps.flatMap((step: any) => {
    const action = step[0];
    return action?.tool ? [action.tool] : [];
  });
  
  contract.queriedWorld = toolCalls.includes('query_world');
  if (!contract.queriedWorld) {
    errors.push('GM must call query_world at the start of each turn');
  }

  // Check if result has valid structure
  if (!result.patches || !Array.isArray(result.patches)) {
    contract.returnedValidJson = false;
    errors.push('GM result missing "patches" array');
  }
  if (result.stateSummary === undefined) {
    contract.returnedValidJson = false;
    errors.push('GM result missing "stateSummary"');
  }

  return { valid: errors.length === 0, errors };
}

export async function runGMAgentTurn(params: RunGMAgentTurnParams): Promise<RunGMAgentTurnResult> {
  const {
    apiKey,
    model,
    runtime,
    playerText,
    world,
    latent,
    conversationHistory,
    maxIterations,
    temperature,
    onEvent,
  } = params;

  // Generate deterministic seed for this turn
  const turnSeed = generateTurnSeed(world.meta?.seed, (world.meta?.turn || 0) + 1);

  if (!apiKey) {
    const result = await runDeterministicFallback(playerText, world);
    return { result, intermediateSteps: [], raw: null, usedFallback: true };
  }

  const gmEngine = (process.env.GM_ENGINE || 'openai').trim().toLowerCase();
  const preferLangChain =
    process.env.FORCE_LANGCHAIN_GM === 'true' || gmEngine !== 'openai';

  if (!preferLangChain) {
    try {
      return await runOpenAIGMAgentTurn(params);
    } catch (err) {
      console.warn('⚠️  OpenAI GM path failed, using deterministic fallback:', err);
      const result = await runDeterministicFallback(playerText, world);
      return { result, intermediateSteps: [], raw: null, usedFallback: true };
    }
  }

  await ensureLangChainImports();
  const executor = await createGMAgentExecutor({ apiKey, model, runtime, maxIterations, temperature });
  const telemetry = buildTurnTelemetry(world);
  const pkg = projectPKGFromGraph(world);
  const constraints = buildTurnConstraints(world, telemetry);
  const latentContext = buildLatentContext(latent);
  const conversationContext = formatConversationHistory(conversationHistory);
  const escapedConversationContext = conversationContext ? escapeForPrompt(conversationContext) : '';

  let worldContext = buildWorldContext(world);
  try {
    const filtered = buildFilteredContext({
      telemetry,
      pkg,
      options: { mode: 'gm', maxChars: 2600 },
    });
    worldContext = formatFilteredContext(filtered);
  } catch (err) {
    console.warn('Context filter failed for GM, using fallback world context:', err);
  }

  const constraintSummary = formatTurnConstraints(constraints);
  const rawContext = `${worldContext}\n\nTurn Constraints:\n${constraintSummary}\nTurn: ${(world.meta?.turn || 0) + 1} | Seed: ${turnSeed}`;
  const worldContextWithSeed = escapeForPrompt(rawContext);
  
  const callbacks = [{
    handleLLMStart: async (_llm: any, prompts: any) => {
      onEvent?.({ type: 'llm_start', prompts: prompts as string[] });
    },
    handleLLMNewToken: async (token: string) => {
      onEvent?.({ type: 'llm_token', token });
    },
    handleLLMEnd: async () => {
      onEvent?.({ type: 'llm_end' });
    },
    handleToolStart: async (tool: any, input: any) => {
      onEvent?.({ type: 'tool_start', tool: tool?.name ?? String(tool), input });
    },
    handleToolEnd: async (output: any, tool: any) => {
      onEvent?.({ type: 'tool_end', tool: tool?.name ?? 'tool', output });
    },
    handleAgentAction: async (action: any) => {
      onEvent?.({ type: 'agent_action', action });
    },
    handleChainError: async (err: unknown) => {
      onEvent?.({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    },
  }];
  const response = await executor.invoke(
    { 
      input: playerText, 
      world_context: worldContextWithSeed, 
      latent_context: latentContext,
      conversation_context: escapedConversationContext,
    },
    { 
      callbacks,
      // Pass seed to OpenAI for deterministic sampling (when using compatible models)
      configurable: { seed: parseInt(turnSeed.slice(0, 8), 16) }
    }
  );

  const steps = (response as any)?.intermediateSteps ?? [];
  const outputText = extractOutputText(response);
  if (/Agent stopped due to max iterations/i.test(outputText)) {
    const { runGMAgentTurnFallback } = await import('./gmOpenAI');
    const result = await runGMAgentTurnFallback(playerText, world);
    return { result, intermediateSteps: steps, raw: response, usedFallback: true };
  }
  const parsed = parseGMJson(outputText);

  const ensureStateSummary = () => {
    if (!parsed.stateSummary || typeof parsed.stateSummary !== 'object') parsed.stateSummary = {} as any;
    if (!(parsed.stateSummary as any).systems) (parsed.stateSummary as any).systems = {};
  };

  // Backfill travel metrics into stateSummary from intermediate steps if missing
  try {
    const travel = extractTravelFromSteps(world, steps);
    if (travel) {
      ensureStateSummary();
      (parsed.stateSummary as any).travel = travel;
    }
  } catch {}

  ensureStateSummary();
  (parsed.stateSummary as any).constraints = constraints;
  
  // Validate turn contract
  const validation = validateTurnContract(steps, parsed);
  if (!validation.valid) {
    console.warn('⚠️  Turn contract violations:', validation.errors);
    onEvent?.({ type: 'error', message: `Contract violations: ${validation.errors.join(', ')}` });

    // Auto-retry once if query_world was not called
    const needsQueryFirst = validation.errors.some((e) => /must call query_world/i.test(e));
    if (needsQueryFirst) {
      const correctiveInput = `${playerText}\n\nNote: First, call query_world to inspect the current state (location, items, player position). Then proceed.`;
      const retryResponse = await executor.invoke(
        { input: correctiveInput, world_context: worldContextWithSeed, latent_context: latentContext, conversation_context: escapedConversationContext },
        { callbacks, configurable: { seed: parseInt(turnSeed.slice(0, 8), 16) } }
      );
      const retrySteps = (retryResponse as any)?.intermediateSteps ?? [];
      const retryOutputText = extractOutputText(retryResponse);
      const retryParsed = parseGMJson(retryOutputText);
      const retryValidation = validateTurnContract(retrySteps, retryParsed);
      if (retryValidation.valid) {
        // Attach provenance and return the retried result
        const turn = (world.meta?.turn || 0) + 1;
        const patchesWithProvenance = retryParsed.patches.map((p: any) => ({ ...p, by: 'GM', turn, seed: turnSeed }));
        return { result: { ...retryParsed, patches: patchesWithProvenance }, intermediateSteps: retrySteps, raw: retryResponse, usedFallback: false };
      } else {
        console.warn('⚠️  Retry still violated contract:', retryValidation.errors);
        onEvent?.({ type: 'error', message: `Retry contract violations: ${retryValidation.errors.join(', ')}` });
      }
    }
  }
  
  const constraintViolations = validatePatchesAgainstConstraints(parsed.patches, constraints, world);
  if (constraintViolations.length) {
    const violationMessage = constraintViolations.join('; ');
    console.warn('🚫 Turn constraint violations:', violationMessage);
    onEvent?.({ type: 'error', message: `Constraint violations: ${violationMessage}` });
    const { runGMAgentTurnFallback } = await import('./gmOpenAI');
    const fallbackResult = await runGMAgentTurnFallback(playerText, world);
    fallbackResult.stateSummary = {
      ...(fallbackResult.stateSummary || {}),
      constraints,
      constraintViolations,
    };
    return { result: fallbackResult, intermediateSteps: steps, raw: response, usedFallback: true };
  }

  // Attach provenance to patches
  const turn = (world.meta?.turn || 0) + 1;
  const patchesWithProvenance = parsed.patches.map((p: any) => ({
    ...p,
    by: 'GM',
    turn,
    seed: turnSeed,
  }));
  
  return { 
    result: { ...parsed, patches: patchesWithProvenance }, 
    intermediateSteps: steps, 
    raw: response, 
    usedFallback: false 
  };
}

function buildWorldContext(world: SimpleWorld): string {
  const locId = world.player.location;
  const location = world.locations[locId];
  const exits = Object.entries(location?.exits ?? {})
    .map(([dir, dest]) => `${dir} -> ${dest}`)
    .join(', ');
  const inventory = world.player.inventory.map((i) => i.name).join(', ');
  const ledgerTail = world.ledger.slice(-5).map((entry) => `- ${entry}`).join('\n') || '- (no recent entries)';

  const context = [
    `Player location: ${location?.name ?? locId} (${locId})`,
    `Description: ${location?.description ?? 'Unknown space.'}`,
    `Exits: ${exits || 'none'}`,
    `Inventory: ${inventory || 'empty'}`,
    `Ledger tail:\n${ledgerTail}`,
  ].join('\n');

  // Escape braces to prevent LangChain template parsing errors
  return escapeForPrompt(context);
}

function buildLatentContext(latent?: { label: string; dir?: string }[]): string {
  if (!latent || !latent.length) return '';
  const parts = latent.map((h) => `${h.dir ? `${h.dir}: ` : ''}${h.label}`).join(' | ');
  return `Latent hints (ephemeral, player-led): ${parts}`.replace(/\{/g, '{{').replace(/\}/g, '}}');
}

function extractOutputText(response: any): string {
  if (typeof response === 'string') return response;
  if (response?.output) return String(response.output);
  if (response?.text) return String(response.text);
  throw new Error('GM agent produced no textual output.');
}

function stripCodeFences(value: string): string {
  const fenceMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const stripped = fenceMatch ? fenceMatch[1] : value;
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    return stripped.slice(firstBrace, lastBrace + 1);
  }
  return stripped;
}

function parseGMJson(text: string): GMResult {
  const cleaned = stripCodeFences(text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse GM output as JSON: ${(err as Error).message}\nReceived: ${text}`);
  }
  const validation = GM_RESULT_SCHEMA.safeParse(parsed);
  if (!validation.success) {
    throw new Error(`GM output JSON validation failed: ${validation.error.message}`);
  }
  return {
    patches: validation.data.patches ?? [],
    stateSummary: validation.data.stateSummary ?? {},
  };
}

// Extract last travel metrics from tool observations for narrator truth grounding
function extractTravelFromSteps(world: SimpleWorld, steps: any[]): any | null {
  try {
    if (!Array.isArray(steps) || steps.length === 0) return null;
    const parseMaybeJson = (v: unknown) => {
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch { return undefined; }
      }
      return v;
    };
    // Scan from end for an estimate_travel or travel_to_location
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      const tool = s?.action?.tool as string | undefined;
      const input = s?.action?.toolInput;
      const obs = parseMaybeJson(s?.observation);
      if (!tool) continue;
      const t = tool.toLowerCase();
      if (t === 'estimate_travel') {
        const distanceMeters = obs?.distanceMeters ?? obs?.distance ?? null;
        const etaSeconds = obs?.etaSeconds ?? (typeof obs?.etaMinutes === 'number' ? Math.round(obs.etaMinutes * 60) : null);
        const terrainMultiplier = obs?.terrainMultiplier;
        const toId = obs?.to?.locationId ?? input?.locationId ?? null;
        const toName = toId ? (world.locations[toId]?.name || toId) : undefined;
        if (Number.isFinite(distanceMeters) || Number.isFinite(etaSeconds)) {
          const travelTimeMinutes = Number.isFinite(etaSeconds) ? Math.max(1, Math.round((etaSeconds as number) / 60)) : undefined;
          const travelTimeHours = typeof travelTimeMinutes === 'number' && travelTimeMinutes >= 60 ? +(travelTimeMinutes / 60).toFixed(1) : undefined;
          return {
            toId: toId ?? undefined,
            toName,
            distanceMeters: Number.isFinite(distanceMeters) ? Math.round(distanceMeters) : undefined,
            travelTimeMinutes,
            travelTimeHours,
            terrainMultiplier: typeof terrainMultiplier === 'number' ? terrainMultiplier : undefined,
          };
        }
      } else if (t === 'travel_to_location') {
        const distanceMeters = obs?.distance ?? obs?.distanceMeters ?? null;
        const travelTimeMinutes = obs?.travelTimeMinutes ?? null;
        const terrainMultiplier = obs?.terrainMultiplier;
        const toId = obs?.locationId ?? input?.locationId ?? null;
        const toName = toId ? (world.locations[toId]?.name || toId) : undefined;
        if (Number.isFinite(distanceMeters) || Number.isFinite(travelTimeMinutes)) {
          const ttMin = Number.isFinite(travelTimeMinutes) ? Math.round(travelTimeMinutes as number) : undefined;
          const travelTimeHours = typeof ttMin === 'number' && ttMin >= 60 ? +(ttMin / 60).toFixed(1) : undefined;
          return {
            toId: toId ?? undefined,
            toName,
            distanceMeters: Number.isFinite(distanceMeters) ? Math.round(distanceMeters) : undefined,
            travelTimeMinutes: ttMin,
            travelTimeHours,
            terrainMultiplier: typeof terrainMultiplier === 'number' ? terrainMultiplier : undefined,
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function escapeForPrompt(value: string): string {
  return value.replace(/\{/g, '{{').replace(/\}/g, '}}');
}

// Add seed generation helper
function generateTurnSeed(worldSeed: string | undefined, turn: number): string {
  const base = worldSeed || 'default-seed';
  return crypto.createHash('sha256').update(`${base}-turn-${turn}`).digest('hex').slice(0, 16);
}

// Deterministic fallback lives in gmOpenAI to keep logic centralized.
export { runDeterministicFallback as runGMAgentTurnFallback };
