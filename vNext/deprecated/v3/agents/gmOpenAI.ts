import OpenAI from 'openai';
import type { SimpleWorld } from '../state/world';
import type { ToolRuntime } from '../tools/index';
import type { GMEvent, GMResult, RunGMAgentTurnParams, RunGMAgentTurnResult } from './gm';
import { GM_SYSTEM_PROMPT, GM_REACT_INSTRUCTIONS, GM_MOVE_REFUSAL_RULES } from './prompts';
import { buildTurnTelemetry } from '../state/telemetry';
import { projectPKGFromGraph } from '../state/pkg';
import { buildTurnConstraints, formatTurnConstraints, validatePatchesAgainstConstraints } from '../state/constraints';
import { buildFilteredContext, formatFilteredContext } from './context/filter';
import { PatchSchema, type Patch } from '../tools/types';
import { DEFAULT_GM_MODEL, DEFAULT_GM_TEMPERATURE } from '../config';
import crypto from 'crypto';
import { z } from 'zod';
import { formatConversationHistory } from './gmConversation';

// Reuse GM_RESULT_SCHEMA via Zod so this module stays aligned with gm.ts
const GM_RESULT_SCHEMA = z.object({
  patches: z.array(PatchSchema).default([]),
  stateSummary: z.any().default({}),
});

type OpenAIGMResult = z.infer<typeof GM_RESULT_SCHEMA>;

function getOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
  });
}

function generateTurnSeed(worldSeed: string | undefined, turn: number): string {
  const base = worldSeed || 'default-seed';
  return crypto.createHash('sha256').update(`${base}-turn-${turn}`).digest('hex').slice(0, 16);
}

function escapeForPrompt(value: string): string {
  return value.replace(/\{/g, '{{').replace(/\}/g, '}}');
}

export async function runOpenAIGMAgentTurn(params: RunGMAgentTurnParams): Promise<RunGMAgentTurnResult> {
  const { apiKey, model, runtime, playerText, world, latent, conversationHistory, maxIterations, temperature, onEvent } = params;

  if (!apiKey) {
    throw new Error('OpenAI API key is required to run GM via OpenAI tools.');
  }

  const turnSeed = generateTurnSeed(world.meta?.seed, (world.meta?.turn || 0) + 1);
  const telemetry = buildTurnTelemetry(world);
  const pkg = projectPKGFromGraph(world);
  const constraints = buildTurnConstraints(world, telemetry);

  let worldContext = buildWorldContext(world);
  try {
    const filtered = buildFilteredContext({
      telemetry,
      pkg,
      options: { mode: 'gm', maxChars: 2600 },
    });
    worldContext = formatFilteredContext(filtered);
  } catch (err) {
    console.warn('Context filter failed for GM (OpenAI), using fallback world context:', err);
  }

  const constraintSummary = formatTurnConstraints(constraints);
  const rawContext = `${worldContext}\n\nTurn Constraints:\n${constraintSummary}\nTurn: ${(world.meta?.turn || 0) + 1} | Seed: ${turnSeed}`;
  const worldContextWithSeed = escapeForPrompt(rawContext);
  const latentContext = buildLatentContext(latent);
  const conversationContext = formatConversationHistory(conversationHistory);
  const escapedConversationContext = conversationContext ? escapeForPrompt(conversationContext) : '';

  const systemPrompt = [
    GM_SYSTEM_PROMPT,
    'Use available tools to inspect/update world. Do not narrate.',
    'Final output: STRICT JSON ONLY (no prose, no code fences): {"actions": string[], "patches": Patch[], "stateSummary": any}.',
    GM_REACT_INSTRUCTIONS,
    GM_MOVE_REFUSAL_RULES,
    `World Context:\n${worldContextWithSeed}`,
    latentContext ? latentContext : '',
    escapedConversationContext ? escapedConversationContext : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const tools = getOpenAIToolsSpec();
  const seedInt = parseInt(turnSeed.slice(0, 8), 16);
  const selectedModel = model ?? DEFAULT_GM_MODEL;
  const isGpt5Family = selectedModel.startsWith('gpt-5');
  const selectedTemperature = isGpt5Family ? undefined : temperature ?? DEFAULT_GM_TEMPERATURE;

  const client = getOpenAIClient(apiKey);
  const intermediateSteps: any[] = [];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: playerText },
  ];

  const maxIters = maxIterations ?? 10;

  for (let iter = 0; iter < maxIters; iter++) {
    onEvent?.({ type: 'llm_start', prompts: [systemPrompt, playerText] });

    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: selectedModel,
      messages,
      tools,
      tool_choice: 'auto',
      seed: seedInt,
      stream: true, // Enable streaming
    };

    if (selectedTemperature !== undefined) {
      requestParams.temperature = selectedTemperature;
    }

    // Enable low reasoning effort for GPT-5.1 by default to reduce latency/cost
    // Note: reasoning_effort works with streaming - reasoning tokens (if any) come through
    // as content tokens in the stream, which we handle below.
    if (selectedModel === 'gpt-5.1') {
      (requestParams as any).reasoning_effort = 'medium';
    }

    // Stream the response
    // GPT-5.1 streaming works identically to other models - content and tool calls
    // are streamed incrementally. Reasoning tokens (if any) appear as content.
    const stream = await client.chat.completions.create(requestParams);

    // Accumulators for streaming
    let accumulatedContent = '';
    const toolCallsAccumulator: Record<number, {
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }> = {};
    let finishReason: string | null = null;

    // Process streaming chunks
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const chunkFinishReason = chunk.choices[0]?.finish_reason;

      // Handle content tokens - emit immediately for streaming
      if (delta?.content) {
        accumulatedContent += delta.content;
        onEvent?.({ type: 'llm_token', token: delta.content });
      }

      // Handle tool calls - accumulate incrementally
      if (delta?.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const idx = toolCallDelta.index;
          if (idx === undefined || idx === null) continue;

          // Initialize accumulator for this tool call index if needed
          if (!toolCallsAccumulator[idx]) {
            toolCallsAccumulator[idx] = { function: {} };
          }

          const acc = toolCallsAccumulator[idx];

          // Update fields as they arrive
          if (toolCallDelta.id) {
            acc.id = toolCallDelta.id;
          }
          if (toolCallDelta.type) {
            acc.type = toolCallDelta.type;
          }
          if (toolCallDelta.function?.name) {
            acc.function = acc.function || {};
            acc.function.name = toolCallDelta.function.name;
          }
          if (toolCallDelta.function?.arguments) {
            acc.function = acc.function || {};
            acc.function.arguments = (acc.function.arguments || '') + toolCallDelta.function.arguments;
          }
        }
      }

      // Capture finish reason when stream completes
      if (chunkFinishReason) {
        finishReason = chunkFinishReason;
      }
    }

    // Stream complete - emit llm_end
    onEvent?.({ type: 'llm_end' });

    // Reconstruct the message from accumulated data
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = Object.values(toolCallsAccumulator)
      .filter((tc) => tc.id && tc.function?.name) // Only include complete tool calls
      .map((tc) => {
        // Ensure arguments is a valid JSON string (default to empty object if missing/invalid)
        let argsStr = tc.function!.arguments || '{}';
        // If arguments string is empty or doesn't start with '{', default to empty object
        if (!argsStr.trim() || !argsStr.trim().startsWith('{')) {
          argsStr = '{}';
        }
        return {
          id: tc.id!,
          type: (tc.type || 'function') as 'function',
          function: {
            name: tc.function!.name!,
            arguments: argsStr,
          },
        };
      });

    const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
      role: 'assistant',
      content: accumulatedContent || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    // Reconstruct a response-like object for the raw field (used for debugging/logging)
    const response = {
      choices: [{
        message,
        finish_reason: finishReason,
        index: 0,
      }],
      model: selectedModel,
      stream: true,
    } as any;

    // Add assistant message to conversation
    messages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        const name = call.function.name;
        let args: any;
        const rawArgs = call.function.arguments || '{}';
        try {
          args = JSON.parse(rawArgs);
        } catch (parseErr) {
          // Log parsing errors to help debug streaming accumulation issues
          console.warn(`Failed to parse tool arguments for ${name}:`, {
            toolCallId: call.id,
            rawArguments: rawArgs,
            error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
          args = {};
        }

        if (!args || typeof args !== 'object') {
          args = {};
        }

        if (name === 'apply_patches' && !Array.isArray((args as any).patches)) {
          console.warn('apply_patches tool called without a valid patches array; coercing to empty.', {
            toolCallId: call.id,
            argsSnapshot: args,
            rawArguments: rawArgs, // Include raw args to help debug streaming issues
            note: 'The GM agent should provide a patches array. If only defaultNote is provided, this suggests the model output was incomplete or malformed.',
          });
          (args as any).patches = [];
        }

        onEvent?.({ type: 'tool_start', tool: name, input: args });
        let result: any;
        try {
          result = await dispatchToolToRuntime(name, args, runtime);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          onEvent?.({ type: 'error', message: `Tool ${name} failed: ${errorMsg}` });
          result = { error: errorMsg };
        }
        onEvent?.({ type: 'tool_end', tool: name, output: result });

        intermediateSteps.push({
          action: { tool: name, toolInput: args },
          observation: JSON.stringify(result),
        });

        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: call.id,
        });
      }
      continue;
    }

    // No tool calls - check if we have final content
    const finalContent = message.content;
    if (typeof finalContent === 'string' && finalContent.trim()) {
      let parsed: OpenAIGMResult;
      try {
        parsed = parseGMJson(finalContent);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn('⚠️  Failed to parse GM JSON:', errorMsg);
        onEvent?.({ type: 'error', message: `JSON parsing failed: ${errorMsg}` });
        throw err;
      }

      // Ensure stateSummary structure
      const ensureStateSummary = () => {
        if (!parsed.stateSummary || typeof parsed.stateSummary !== 'object') parsed.stateSummary = {} as any;
        if (!(parsed.stateSummary as any).systems) (parsed.stateSummary as any).systems = {};
      };

      // Backfill travel metrics from intermediate steps if missing
      try {
        const travel = extractTravelFromSteps(world, intermediateSteps);
        if (travel) {
          ensureStateSummary();
          (parsed.stateSummary as any).travel = travel;
        }
      } catch {}

      ensureStateSummary();
      (parsed.stateSummary as any).constraints = constraints;

      // Validate turn contract
      const validation = validateTurnContract(intermediateSteps, parsed);
      if (!validation.valid) {
        console.warn('⚠️  Turn contract violations (OpenAI GM):', validation.errors);
        onEvent?.({ type: 'error', message: `Contract violations: ${validation.errors.join(', ')}` });
      }

      const constraintViolations = validatePatchesAgainstConstraints(parsed.patches, constraints, world);
      if (constraintViolations.length) {
        const violationMessage = constraintViolations.join('; ');
        console.warn('🚫 Turn constraint violations (OpenAI GM):', violationMessage);
        onEvent?.({ type: 'error', message: `Constraint violations: ${violationMessage}` });
        // Fall back to deterministic fallback on constraint violations
        const fallbackResult = await runGMAgentTurnFallback(playerText, world);
        fallbackResult.stateSummary = {
          ...(fallbackResult.stateSummary || {}),
          constraints,
          constraintViolations,
        };
        return { result: fallbackResult, intermediateSteps, raw: response, usedFallback: true };
      }

      const turn = (world.meta?.turn || 0) + 1;
      const patchesWithProvenance = parsed.patches.map((p: any) => ({
        ...p,
        by: 'GM',
        turn,
        seed: turnSeed,
      }));

      const result: GMResult = {
        patches: patchesWithProvenance,
        stateSummary: parsed.stateSummary,
      };

      return {
        result,
        intermediateSteps,
        raw: response,
        usedFallback: false,
      };
    }
  }

  // Max iterations reached - fall back
  console.warn('⚠️  GM agent reached max iterations, using fallback');
  const fallbackResult = await runGMAgentTurnFallback(playerText, world);
  return { result: fallbackResult, intermediateSteps, raw: null, usedFallback: true };
}

function getOpenAIToolsSpec(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'query_world',
        description: 'Inspect current location, exits, items, and player state.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', nullable: true },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'apply_patches',
        description: 'Apply validated patches to world state and append ledger notes. REQUIRED: patches array with at least one patch object. Each patch must have: op ("set" or "merge"), path (JSON pointer), value, and optional note.',
        parameters: {
          type: 'object',
          properties: {
            patches: {
              type: 'array',
              items: {
                type: 'object',
        properties: {
          op: { type: 'string', enum: ['set', 'merge'] },
          path: { type: 'string' },
          value: {}, // Empty object allows any JSON value
          note: { type: 'string' },
        },
        required: ['op', 'path', 'value'],
                additionalProperties: true,
              },
              description: 'Array of patch objects to apply. Cannot be empty if you want to modify state.',
            },
            defaultNote: {
              type: 'string',
              description: 'Optional default note for patches that do not have their own note field.',
            },
          },
          required: ['patches'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'move_to_position',
        description: 'Move the player by absolute coordinates or deltas.',
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                z: { type: 'number', nullable: true },
              },
              nullable: true,
            },
            delta: {
              type: 'object',
              properties: {
                dx: { type: 'number', nullable: true },
                dy: { type: 'number', nullable: true },
                dz: { type: 'number', nullable: true },
              },
              nullable: true,
            },
            speedMetersPerSecond: { type: 'number', nullable: true },
            note: { type: 'string', nullable: true },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'travel_to_location',
        description: 'Travel to a known location and advance time.',
        parameters: {
          type: 'object',
          properties: {
            locationId: { type: 'string' },
            baseSpeedMetersPerSecond: { type: 'number', nullable: true },
            note: { type: 'string', nullable: true },
          },
          required: ['locationId'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'project_pkg',
        description: 'Project the ground truth world into what the player knows.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_entity',
        description: 'Create a new entity in the world graph.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            props: { type: 'object', nullable: true },
            tags: { type: 'array', items: { type: 'string' }, nullable: true },
            id: { type: 'string', nullable: true },
          },
          required: ['type'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_relation',
        description: 'Create a relationship between two entities.',
        parameters: {
          type: 'object',
          properties: {
            subj: { type: 'string' },
            pred: { type: 'string' },
            obj: { type: 'string' },
            props: { type: 'object', nullable: true },
          },
          required: ['subj', 'pred', 'obj'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'estimate_travel',
        description: 'Estimate distance and ETA to a destination without moving state.',
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                z: { type: 'number', nullable: true },
              },
              nullable: true,
            },
            locationId: { type: 'string', nullable: true },
            baseSpeedMetersPerSecond: { type: 'number', nullable: true },
          },
          additionalProperties: false,
        },
      },
    },
  ];
}

async function dispatchToolToRuntime(name: string, args: any, runtime: ToolRuntime): Promise<any> {
  switch (name) {
    case 'query_world':
      return runtime.query_world(args as any);
    case 'apply_patches':
      return runtime.apply_patches(args as any);
    case 'move_to_position':
      return runtime.move_to_position(args as any);
    case 'travel_to_location':
      return runtime.travel_to_location(args as any);
    case 'project_pkg':
      return runtime.project_pkg();
    case 'create_entity':
      return runtime.create_entity(args as any);
    case 'create_relation':
      return runtime.create_relation(args as any);
    case 'estimate_travel':
      return (runtime as any).estimate_travel(args as any);
    default:
      throw new Error(`Unknown GM tool: ${name}`);
  }
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

  return escapeForPrompt(context);
}

function buildLatentContext(latent?: { label: string; dir?: string }[]): string {
  if (!latent || !latent.length) return '';
  const parts = latent.map((h) => `${h.dir ? `${h.dir}: ` : ''}${h.label}`).join(' | ');
  return `Latent hints (ephemeral, player-led): ${parts}`.replace(/\{/g, '{{').replace(/\}/g, '}}');
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

function parseGMJson(text: string): OpenAIGMResult {
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

interface TurnContract {
  queriedWorld: boolean;
  performedActions: boolean;
  returnedValidJson: boolean;
}

function validateTurnContract(intermediateSteps: any[], result: OpenAIGMResult): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const contract: TurnContract = {
    queriedWorld: false,
    performedActions: false,
    returnedValidJson: true,
  };

  // Check if query_world was called
  const toolCalls = intermediateSteps.flatMap((step: any) => {
    const action = step?.action;
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

// Extract last travel metrics from tool observations for narrator truth grounding
function extractTravelFromSteps(world: SimpleWorld, steps: any[]): any | null {
  try {
    if (!Array.isArray(steps) || steps.length === 0) return null;
    const parseMaybeJson = (v: unknown) => {
      if (typeof v === 'string') {
        try {
          return JSON.parse(v);
        } catch {
          return undefined;
        }
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

// Deterministic fallback retains basic functionality when no API key is supplied.
export async function runGMAgentTurnFallback(playerText: string, world: SimpleWorld): Promise<GMResult> {
  const text = playerText.trim().toLowerCase();
  const patches: Patch[] = [];

  const currentLocation = world.player.location;

  if (text === 'look' || text === 'l') {
    // Look action - no state change needed
  } else if (text.includes('go') && text.includes('tavern')) {
    patches.push({ op: 'set', path: '/player/location', value: 'tavern', note: 'Player moved to the tavern.' });
  } else if (text.includes('go') && text.includes('glade')) {
    patches.push({ op: 'set', path: '/player/location', value: 'glade', note: 'Player moved to the glade.' });
  } else if (text.includes('take') && text.includes('key') && currentLocation === 'tavern') {
    const alreadyHasKey = world.player.inventory.some((item) => item.id === 'key');
    if (!alreadyHasKey) {
      patches.push({ op: 'set', path: '/player/inventory', value: [...world.player.inventory, { id: 'key', name: 'rusty key' }], note: 'Player took the rusty key.' });
    }
  }

  const locId = patches.find((p) => p.path === '/player/location' && p.op === 'set')?.value ?? world.player.location;
  const loc = world.locations[locId as string];
  const inventory = patches.find((p) => p.path === '/player/inventory' && p.op === 'set')?.value ?? world.player.inventory;

  const stateSummary = {
    location: { id: locId, name: loc?.name },
    inventoryCount: Array.isArray(inventory) ? inventory.length : world.player.inventory.length,
  };

  return { patches, stateSummary };
}
