import type { LLMClient, ResponseOutputItem, ResponseToolDefinition } from '../llm/types';
import { classifyLLMError } from '../llm/errorUtils';
import { NPC_SYSTEM_PROMPT } from './prompts';

const NPC_OUTPUT_TOOL_NAME = 'emit_npc_turn';

const NPC_OUTPUT_TOOL: ResponseToolDefinition = {
  type: 'function',
  name: NPC_OUTPUT_TOOL_NAME,
  description: 'Return the NPC reaction in a strict structured payload.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      publicUtterance: { type: 'string' },
      privateIntent: { type: 'string' },
      emotionalTone: { type: ['string', 'null'] },
    },
    required: ['publicUtterance', 'privateIntent', 'emotionalTone'],
    additionalProperties: false,
  },
};

export interface NpcAgentOutput {
  npcId: string;
  publicUtterance: string;
  privateIntent: string;
  emotionalTone?: string;
}

export interface NpcAgentParams {
  apiKey?: string;
  model?: string;
  npcId: string;
  persona: { name: string; tagline?: string; background?: string; voice?: string; goals?: string[] };
  observation: unknown;
  playerText: string;
  llm: LLMClient;
  trace?: {
    llmCalls?: Array<{
      agent: 'gm' | 'npc' | 'narrator';
      responseId?: string;
      previousResponseId?: string;
      inputItems?: number;
      outputItems?: number;
      toolCalls?: number;
      usage?: unknown;
      status?: string;
      error?: unknown;
    }>;
  };
}

export async function runNpcAgent(params: NpcAgentParams): Promise<NpcAgentOutput> {
  const { apiKey, model = 'gpt-5.2', npcId, persona, observation, playerText, llm, trace } = params;

  if (!apiKey) {
    return {
      npcId,
      publicUtterance: `${persona.name} nods, saying little.`,
      privateIntent: 'stay_guarded',
    };
  }

  let response;
  try {
    response = await llm.responsesCreate({
      apiKey,
      model,
      instructions: NPC_SYSTEM_PROMPT,
      input: JSON.stringify({ persona, observation, playerText }),
      tools: [NPC_OUTPUT_TOOL],
      tool_choice: { type: 'function', name: NPC_OUTPUT_TOOL_NAME },
      truncation: 'auto',
      store: true,
    });
  } catch (error) {
    pushLLMTrace(trace, {
      agent: 'npc',
      inputItems: 1,
      status: 'failed',
      error: classifyLLMError(error),
    });
    return {
      npcId,
      publicUtterance: `${persona.name} says nothing.`,
      privateIntent: 'wait',
    };
  }

  const functionCalls = response.output.filter(isFunctionCallItem);
  const resultCall = functionCalls.find(call => call.name === NPC_OUTPUT_TOOL_NAME);
  pushLLMTrace(trace, {
    agent: 'npc',
    responseId: response.id,
    inputItems: 1,
    outputItems: response.output.length,
    toolCalls: functionCalls.length,
    usage: response.usage,
    status: response.status,
    error: response.error ?? response.incomplete_details,
  });

  if (!resultCall) {
    return {
      npcId,
      publicUtterance: `${persona.name} says nothing.`,
      privateIntent: 'wait',
    };
  }

  const parsed = parseNpcOutput(resultCall.arguments);
  if (!parsed) {
    return {
      npcId,
      publicUtterance: `${persona.name} says nothing.`,
      privateIntent: 'wait',
    };
  }

  return {
    npcId,
    publicUtterance: parsed.publicUtterance || `${persona.name} says nothing.`,
    privateIntent: parsed.privateIntent || 'wait',
    emotionalTone: parsed.emotionalTone || undefined,
  };
}

function parseNpcOutput(argumentsJSON: string): { publicUtterance: string; privateIntent: string; emotionalTone: string | null } | null {
  try {
    const parsed = JSON.parse(argumentsJSON) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.publicUtterance !== 'string') return null;
    if (typeof record.privateIntent !== 'string') return null;
    if (!(record.emotionalTone === null || typeof record.emotionalTone === 'string')) return null;
    return {
      publicUtterance: String(record.publicUtterance),
      privateIntent: String(record.privateIntent),
      emotionalTone: record.emotionalTone as string | null,
    };
  } catch {
    return null;
  }
}

function isFunctionCallItem(item: ResponseOutputItem): item is {
  type: 'function_call';
  name: string;
  arguments: string;
} {
  return item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string';
}

function pushLLMTrace(
  trace: NpcAgentParams['trace'] | undefined,
  entry: {
    agent: 'gm' | 'npc' | 'narrator';
    responseId?: string;
    previousResponseId?: string;
    inputItems?: number;
    outputItems?: number;
    toolCalls?: number;
    usage?: unknown;
    status?: string;
    error?: unknown;
  },
) {
  if (!trace) return;
  trace.llmCalls = trace.llmCalls || [];
  trace.llmCalls.push(entry);
}
