import type { LLMClient, ResponseOutputItem, ResponseToolDefinition } from '../llm/types';
import { DEFAULT_MODEL } from '../llm/defaults';
import { classifyLLMError } from '../llm/errorUtils';
import { isFunctionCallItem, pushLLMTrace } from '../llm/trace';
import { NPC_SYSTEM_PROMPT } from './prompts';
import type { DebugSink } from '../../engine/debug';
import { emitDebugEvent } from '../../engine/debug';
import type { SpecialistType } from '../specialists';
import type { ConversationTranscriptEntry } from '../../engine/contextBuilders';

const NPC_OUTPUT_TOOL_NAME = 'emit_npc_turn';
const NPC_CONTEXT_CHAR_BUDGET = 14_000;
const NPC_OLDER_TURN_SUMMARY_MAX_CHARS = 2_400;

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
  conversationHistory: ConversationTranscriptEntry[];
  olderTurnsSummary?: string;
  currentTurn?: {
    turn: number;
    playerId: string;
  };
  llm: LLMClient;
  debug?: DebugSink;
  trace?: {
    llmCalls?: Array<{
      agent: 'gm' | 'npc' | 'narrator' | 'specialist' | 'mechanics' | 'schedule';
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

export async function runNpcAgent(params: NpcAgentParams): Promise<NpcAgentOutput> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    npcId,
    persona,
    observation,
    conversationHistory,
    olderTurnsSummary,
    currentTurn,
    llm,
    debug,
    trace,
  } = params;
  emitDebugEvent(debug, { type: 'npc.started', npcId });

  if (!apiKey) {
    const fallback = {
      npcId,
      publicUtterance: `${persona.name} nods, saying little.`,
      privateIntent: 'stay_guarded',
    };
    emitDebugEvent(debug, { type: 'npc.completed', npcId, output: fallback });
    return fallback;
  }

  const npcInput = fitNPCConversationPayload({
    persona,
    observation,
    conversationHistory,
    olderTurnsSummary,
    currentTurn,
  });

  let response;
  try {
    response = await llm.responsesCreate({
      apiKey,
      model,
      instructions: NPC_SYSTEM_PROMPT,
      input: JSON.stringify(npcInput),
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
    const fallback = {
      npcId,
      publicUtterance: `${persona.name} says nothing.`,
      privateIntent: 'wait',
    };
    emitDebugEvent(debug, { type: 'npc.completed', npcId, output: fallback });
    return fallback;
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
    const fallback = {
      npcId,
      publicUtterance: `${persona.name} says nothing.`,
      privateIntent: 'wait',
    };
    emitDebugEvent(debug, { type: 'npc.completed', npcId, output: fallback });
    return fallback;
  }

  const parsed = parseNpcOutput(resultCall.arguments);
  if (!parsed) {
    const fallback = {
      npcId,
      publicUtterance: `${persona.name} says nothing.`,
      privateIntent: 'wait',
    };
    emitDebugEvent(debug, { type: 'npc.completed', npcId, output: fallback });
    return fallback;
  }

  const output = {
    npcId,
    publicUtterance: parsed.publicUtterance || `${persona.name} says nothing.`,
    privateIntent: parsed.privateIntent || 'wait',
    emotionalTone: parsed.emotionalTone || undefined,
  };
  emitDebugEvent(debug, { type: 'npc.completed', npcId, output });
  return output;
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


function fitNPCConversationPayload(params: {
  persona: NpcAgentParams['persona'];
  observation: unknown;
  conversationHistory: ConversationTranscriptEntry[];
  olderTurnsSummary?: string;
  currentTurn?: NpcAgentParams['currentTurn'];
}) {
  const { persona, observation, conversationHistory, currentTurn } = params;
  const openingEntries = conversationHistory.filter(entry => entry.role === 'opening');
  const turnGroups = groupConversationByTurn(conversationHistory.filter(entry => entry.role !== 'opening'));
  let keepFromIndex = 0;
  let olderSummary = params.olderTurnsSummary;
  let payload = buildNPCPayload({
    persona,
    observation,
    openingEntries,
    turnGroups,
    keepFromIndex,
    olderTurnsSummary: olderSummary,
    currentTurn,
  });

  while (serializedLength(payload) > NPC_CONTEXT_CHAR_BUDGET && keepFromIndex < Math.max(turnGroups.length - 1, 0)) {
    keepFromIndex += 1;
    olderSummary = summarizeOlderTurnGroups(turnGroups.slice(0, keepFromIndex));
    payload = buildNPCPayload({
      persona,
      observation,
      openingEntries,
      turnGroups,
      keepFromIndex,
      olderTurnsSummary: olderSummary,
      currentTurn,
    });
  }

  return payload;
}

function buildNPCPayload(params: {
  persona: NpcAgentParams['persona'];
  observation: unknown;
  openingEntries: ConversationTranscriptEntry[];
  turnGroups: Array<{ turn: number; entries: ConversationTranscriptEntry[] }>;
  keepFromIndex: number;
  olderTurnsSummary?: string;
  currentTurn?: NpcAgentParams['currentTurn'];
}) {
  const conversationHistory = [
    ...params.openingEntries,
    ...params.turnGroups.slice(params.keepFromIndex).flatMap(group => group.entries),
  ];

  return {
    persona: params.persona,
    observation: params.observation,
    conversationHistory,
    olderTurnsSummary: params.olderTurnsSummary || undefined,
    currentTurn: params.currentTurn,
  };
}

function groupConversationByTurn(conversationHistory: ConversationTranscriptEntry[]) {
  const groups: Array<{ turn: number; entries: ConversationTranscriptEntry[] }> = [];
  for (const entry of conversationHistory) {
    const current = groups[groups.length - 1];
    if (!current || current.turn !== entry.turn) {
      groups.push({ turn: entry.turn, entries: [entry] });
      continue;
    }
    current.entries.push(entry);
  }
  return groups;
}

function summarizeOlderTurnGroups(turnGroups: Array<{ turn: number; entries: ConversationTranscriptEntry[] }>): string | undefined {
  if (!turnGroups.length) return undefined;
  const lines = turnGroups.map(group => `Turn ${group.turn}: ${summarizeTurnEntries(group.entries)}`);
  const firstTurn = turnGroups[0]?.turn;
  const lastTurn = turnGroups[turnGroups.length - 1]?.turn;
  const header = firstTurn === lastTurn ? `Earlier conversation from turn ${firstTurn}:` : `Earlier conversation from turns ${firstTurn}-${lastTurn}:`;
  return clipText([header, ...lines].join('\n'), NPC_OLDER_TURN_SUMMARY_MAX_CHARS);
}

function summarizeTurnEntries(entries: ConversationTranscriptEntry[]): string {
  return entries.map(entry => {
    const speaker = entry.speakerName || defaultSpeakerLabel(entry);
    return `${speaker}: ${clipText(entry.text, 120)}`;
  }).join(' | ');
}

function defaultSpeakerLabel(entry: ConversationTranscriptEntry): string {
  switch (entry.role) {
    case 'player':
      return 'Player';
    case 'npc':
      return 'NPC';
    case 'opening':
    case 'narrator':
      return 'Narrator';
    default:
      return 'Speaker';
  }
}

function serializedLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function clipText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`;
}
