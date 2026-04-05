import type { LLMClient, ResponseOutputItem, ResponseToolDefinition } from '../llm/types';
import { DEFAULT_MODEL } from '../llm/defaults';
import { classifyLLMError } from '../llm/errorUtils';
import { emitDebugEvent, type DebugSink } from '../../engine/debug';
import { EVENT_ITEM_SCHEMA, strictObjectSchema } from '../sharedSchemas';
import { normalizeWorldEvent, type WorldEvent } from '../../sim/events';
import { SPECIALIST_SYSTEM_PROMPTS } from './prompts';
import type {
  SpecialistAgentOutput,
  SpecialistContext,
  SpecialistType,
  SpecialistConsultation,
} from './types';

const SPECIALIST_OUTPUT_TOOL_NAME = 'emit_specialist_advice';

const SPECIALIST_OUTPUT_TOOL: ResponseToolDefinition = {
  type: 'function',
  name: SPECIALIST_OUTPUT_TOOL_NAME,
  description: 'Return structured specialist advice for the GM.',
  strict: true,
  parameters: strictObjectSchema({
    summary: { type: 'string' },
    recommendations: { type: 'array', items: { type: 'string' } },
    candidateEvents: { type: 'array', items: EVENT_ITEM_SCHEMA },
    creationIntent: strictObjectSchema(
      {
        kind: { type: 'string', enum: ['npc', 'item', 'location'] },
        purpose: { type: 'string' },
      },
      { nullable: true },
    ),
    risks: { type: 'array', items: { type: 'string' } },
  }),
};

export interface SpecialistAgentParams {
  apiKey?: string;
  model?: string;
  specialistType: SpecialistType;
  question: string;
  focus?: string;
  context: SpecialistContext;
  llm: LLMClient;
  debug?: DebugSink;
  trace?: {
    llmCalls?: Array<{
      agent: 'gm' | 'npc' | 'narrator' | 'specialist';
      responseId?: string;
      previousResponseId?: string;
      inputItems?: number;
      outputItems?: number;
      toolCalls?: number;
      usage?: unknown;
      status?: string;
      error?: unknown;
      specialistType?: SpecialistType;
    }>;
  };
}

export async function runSpecialistAgent(params: SpecialistAgentParams): Promise<SpecialistAgentOutput> {
  const { apiKey, model = DEFAULT_MODEL, specialistType, question, focus, context, llm, debug, trace } = params;
  emitDebugEvent(debug, { type: 'specialist.started', specialistType, question, focus });

  if (!apiKey) {
    const fallback = fallbackSpecialistOutput(specialistType, question, focus);
    emitDebugEvent(debug, { type: 'specialist.completed', specialistType, output: fallback });
    return fallback;
  }

  let response;
  try {
    response = await llm.responsesCreate({
      apiKey,
      model,
      instructions: SPECIALIST_SYSTEM_PROMPTS[specialistType],
      input: JSON.stringify({ specialistType, question, focus: focus || null, context }),
      tools: [SPECIALIST_OUTPUT_TOOL],
      tool_choice: { type: 'function', name: SPECIALIST_OUTPUT_TOOL_NAME },
      truncation: 'auto',
      store: true,
    });
  } catch (error) {
    pushLLMTrace(trace, {
      agent: 'specialist',
      specialistType,
      inputItems: 1,
      status: 'failed',
      error: classifyLLMError(error),
    });
    const fallback = fallbackSpecialistOutput(specialistType, question, focus);
    emitDebugEvent(debug, { type: 'specialist.completed', specialistType, output: fallback });
    return fallback;
  }

  const functionCalls = response.output.filter(isFunctionCallItem);
  const resultCall = functionCalls.find(call => call.name === SPECIALIST_OUTPUT_TOOL_NAME);
  pushLLMTrace(trace, {
    agent: 'specialist',
    specialistType,
    responseId: response.id,
    inputItems: 1,
    outputItems: response.output.length,
    toolCalls: functionCalls.length,
    usage: response.usage,
    status: response.status,
    error: response.error ?? response.incomplete_details,
  });

  if (!resultCall) {
    const fallback = fallbackSpecialistOutput(specialistType, question, focus);
    emitDebugEvent(debug, { type: 'specialist.completed', specialistType, output: fallback });
    return fallback;
  }

  const parsed = parseSpecialistOutput(specialistType, resultCall.arguments);
  if (!parsed) {
    const fallback = fallbackSpecialistOutput(specialistType, question, focus);
    emitDebugEvent(debug, { type: 'specialist.completed', specialistType, output: fallback });
    return fallback;
  }

  const output = {
    ...parsed,
    candidateEvents: parsed.candidateEvents.filter(isUsableCandidateEvent),
  };
  emitDebugEvent(debug, { type: 'specialist.completed', specialistType, output });
  return output;
}

export function finalizeSpecialistConsultations(
  consultations: Array<Omit<SpecialistConsultation, 'usedSuggestion' | 'usedCandidateEvents'>>,
  acceptedEvents: SpecialistAgentOutput['candidateEvents'],
): SpecialistConsultation[] {
  return consultations.map(consultation => {
    const usedCandidateEvents = consultation.output.candidateEvents.filter(candidate =>
      acceptedEvents.some(accepted => eventsMatch(candidate, accepted)),
    );
    return {
      ...consultation,
      usedCandidateEvents,
      usedSuggestion: usedCandidateEvents.length > 0,
    };
  });
}

function fallbackSpecialistOutput(specialistType: SpecialistType, question: string, focus?: string): SpecialistAgentOutput {
  const scopedFocus = focus?.trim() || question.trim() || 'the current turn';
  return {
    specialistType,
    summary:
      specialistType === 'scene'
        ? `Keep the next beat grounded in ${scopedFocus} and make the local stakes clearer.`
        : `Use ${scopedFocus} to deepen the wider world and introduce a concrete consequence or opportunity.`,
    recommendations:
      specialistType === 'scene'
        ? ['Clarify the immediate pressure.', 'Prefer one concrete complication over diffuse atmosphere.']
        : ['Tie the moment to an existing world thread.', 'Introduce only one new durable element if it will matter later.'],
    candidateEvents: [],
    creationIntent: null,
    risks: ['Fallback specialist output may be conservative.'],
  };
}

function parseSpecialistOutput(specialistType: SpecialistType, argumentsJSON: string): SpecialistAgentOutput | null {
  try {
    const parsed = JSON.parse(argumentsJSON) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.summary !== 'string') return null;
    if (!Array.isArray(record.recommendations) || !record.recommendations.every(item => typeof item === 'string')) return null;
    if (!Array.isArray(record.candidateEvents)) return null;
    if (!Array.isArray(record.risks) || !record.risks.every(item => typeof item === 'string')) return null;

    const creationIntent =
      record.creationIntent &&
      typeof record.creationIntent === 'object' &&
      !Array.isArray(record.creationIntent) &&
      typeof (record.creationIntent as Record<string, unknown>).kind === 'string' &&
      typeof (record.creationIntent as Record<string, unknown>).purpose === 'string'
        ? {
            kind: (record.creationIntent as Record<string, unknown>).kind as 'npc' | 'item' | 'location',
            purpose: String((record.creationIntent as Record<string, unknown>).purpose),
          }
        : null;

    return {
      specialistType,
      summary: record.summary,
      recommendations: record.recommendations as string[],
      candidateEvents: (record.candidateEvents as SpecialistAgentOutput['candidateEvents']).map(event => normalizeWorldEvent(event)),
      creationIntent,
      risks: record.risks as string[],
    };
  } catch {
    return null;
  }
}

function isUsableCandidateEvent(event: WorldEvent): boolean {
  if (event.type === 'Speak') {
    return typeof event.actorId === 'string' && event.actorId.trim().length > 0;
  }
  return true;
}

function isFunctionCallItem(item: ResponseOutputItem): item is {
  type: 'function_call';
  name: string;
  arguments: string;
} {
  return item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string';
}

function pushLLMTrace(
  trace: SpecialistAgentParams['trace'] | undefined,
  entry: {
    agent: 'gm' | 'npc' | 'narrator' | 'specialist';
    responseId?: string;
    previousResponseId?: string;
    inputItems?: number;
    outputItems?: number;
    toolCalls?: number;
    usage?: unknown;
    status?: string;
    error?: unknown;
    specialistType?: SpecialistType;
  },
) {
  if (!trace) return;
  trace.llmCalls = trace.llmCalls || [];
  trace.llmCalls.push(entry);
}

function eventsMatch(left: SpecialistAgentOutput['candidateEvents'][number], right: SpecialistAgentOutput['candidateEvents'][number]) {
  return JSON.stringify(stripMeta(left)) === JSON.stringify(stripMeta(right));
}

function stripMeta(event: SpecialistAgentOutput['candidateEvents'][number]) {
  const { meta: _meta, ...rest } = event;
  return rest;
}
