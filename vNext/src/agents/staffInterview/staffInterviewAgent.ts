import type { LLMClient, ResponseOutputItem } from '../llm/types';
import { DEFAULT_MODEL } from '../llm/defaults';
import { classifyLLMError } from '../llm/errorUtils';
import { STAFF_INTERVIEW_SYSTEM_PROMPT } from './prompts';
import { FINISH_STAFF_INTERVIEW_TOOL_NAME, STAFF_INTERVIEW_TOOL } from './tools';
import type {
  StaffInterviewDiagnostics,
  StaffInterviewInput,
  StaffInterviewMessage,
  StaffInterviewResult,
} from './types';

export interface StaffInterviewAgentParams extends StaffInterviewInput {
  apiKey?: string;
  model?: string;
  llm: LLMClient;
}

export async function runStaffInterview(params: StaffInterviewAgentParams): Promise<StaffInterviewResult> {
  const { apiKey, model = DEFAULT_MODEL, question, context, conversation, llm } = params;

  if (!apiKey) {
    return buildFallbackInterview(question, context, conversation);
  }

  let response;
  try {
    response = await llm.responsesCreate({
      apiKey,
      model,
      instructions: STAFF_INTERVIEW_SYSTEM_PROMPT,
      input: JSON.stringify({
        question,
        conversation: conversation || [],
        context,
      }),
      tools: [STAFF_INTERVIEW_TOOL],
      tool_choice: { type: 'function', name: FINISH_STAFF_INTERVIEW_TOOL_NAME },
      truncation: 'auto',
    });
  } catch (error) {
    const classified = classifyLLMError(error);
    return buildFallbackInterview(question, context, conversation, classified.message);
  }

  const functionCalls = response.output.filter(isFunctionCallItem);
  const resultCall = functionCalls.find(call => call.name === FINISH_STAFF_INTERVIEW_TOOL_NAME);
  const parsed = resultCall ? parseStaffInterviewResult(resultCall.arguments) : null;
  if (!parsed) {
    return buildFallbackInterview(question, context, conversation);
  }

  return { ...parsed, source: 'live' };
}

function parseStaffInterviewResult(argumentsJSON: string): Omit<StaffInterviewResult, 'source'> | null {
  try {
    const parsed = JSON.parse(argumentsJSON) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.employeeReply !== 'string') return null;
    const diagnostics = parseDiagnostics(record.diagnostics);
    if (!diagnostics) return null;
    return {
      employeeReply: record.employeeReply,
      diagnostics,
    };
  } catch {
    return null;
  }
}

function parseDiagnostics(value: unknown): StaffInterviewDiagnostics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.currentUnderstanding !== 'string') return null;
  const knownGoals = asStringArray(record.knownGoals);
  const missingContext = asStringArray(record.missingContext);
  const frictionPoints = asStringArray(record.frictionPoints);
  const improvementIdeas = asStringArray(record.improvementIdeas);
  const suggestedQuestions = asStringArray(record.suggestedQuestions);
  const confidenceNotes = asStringArray(record.confidenceNotes);
  if (!knownGoals || !missingContext || !frictionPoints || !improvementIdeas || !suggestedQuestions || !confidenceNotes) {
    return null;
  }
  return {
    currentUnderstanding: record.currentUnderstanding,
    knownGoals,
    missingContext,
    frictionPoints,
    improvementIdeas,
    suggestedQuestions,
    confidenceNotes,
  };
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean) as string[];
}

function buildFallbackInterview(
  question: string,
  context: StaffInterviewInput['context'],
  conversation?: StaffInterviewMessage[],
  errorMessage?: string,
): StaffInterviewResult {
  const currentUnderstanding = [
    `I am tracking session ${context.sessionId} at turn ${context.telemetry.turn}.`,
    `The player is currently at ${context.telemetry.location.name}.`,
    context.agendas.scene.currentFocus ? `The immediate scene focus is ${context.agendas.scene.currentFocus}.` : 'There is no explicit scene focus set right now.',
  ].join(' ');

  const knownGoals = [
    ...context.agendas.scene.pressures,
    ...context.agendas.scene.unresolvedBeats,
    ...context.agendas.world.activeThreads,
  ].filter(Boolean).slice(0, 6);

  const missingContext = [
    context.playerTranscriptTail.length ? '' : 'I do not have any recent player transcript yet.',
    context.heuristics.repeatedClarificationCount > 0 ? 'The transcript shows clarification loops, but not why the player was confused.' : '',
    context.recentTurnDetails.some(turn => turn.specialistOutputs.length > 0) ? 'I can see specialist advice outcomes, but not whether the operator agreed with the steward\'s final reasoning.' : '',
  ].filter(Boolean);

  const frictionPoints = [
    context.heuristics.pendingPromptActive ? 'A pending prompt is still open, which means intent is not fully resolved.' : '',
    context.heuristics.rejectedEventCount > 0 ? `Some proposed world changes were rejected (${context.heuristics.rejectedEventCount} total).` : '',
    context.heuristics.noAcceptedTurnCount > 0 ? `Several turns resolved without accepted events (${context.heuristics.noAcceptedTurnCount} total).` : '',
    context.heuristics.specialistConsultCount > 0 ? `The steward has leaned on specialists ${context.heuristics.specialistConsultCount} time(s), which may indicate uncertain pacing or world follow-through.` : '',
    errorMessage ? `Live reflection failed and I am answering from fallback heuristics (${errorMessage}).` : '',
  ].filter(Boolean);

  const improvementIdeas = [
    'Give me a compact operator-facing brief about the intended experience for the next 2-3 turns.',
    'Expose why rejected events failed so I can explain the friction more precisely.',
    'Capture whether a pending prompt was satisfying or annoying from the player perspective.',
  ];

  const suggestedQuestions = [
    `What outcome are you hoping for with this question: "${question}"?`,
    'Which parts of the current session felt slower or more confusing than intended?',
    'Do you want me to optimize for scene clarity, world coherence, or player agency first?',
  ];

  const confidenceNotes = [
    'I am highly confident about location, agendas, and pending prompts because those come from current state.',
    context.recentTurnDetails.length
      ? 'I am moderately confident about recent friction because I can inspect recent turn history and specialist consultations.'
      : 'I am low confidence on longer-term patterns because there is little or no turn history yet.',
    conversation && conversation.length
      ? 'I can use this interview conversation for local continuity, but it is not persisted anywhere.'
      : 'There is no prior interview history in memory yet.',
  ];

  const replyParts = [
    `From where I sit, I understand the session as ${context.telemetry.location.name} on turn ${context.telemetry.turn}, with ${knownGoals.length ? 'active goals and pressures already in play.' : 'very little explicit goal scaffolding.'}`,
    frictionPoints.length
      ? `The main friction I can see is ${frictionPoints[0]!.charAt(0).toLowerCase() + frictionPoints[0]!.slice(1)}`
      : 'I do not see severe structural friction yet, but the context is still fairly thin.',
    improvementIdeas[0],
  ];

  return {
    employeeReply: replyParts.join(' '),
    diagnostics: {
      currentUnderstanding,
      knownGoals,
      missingContext,
      frictionPoints,
      improvementIdeas,
      suggestedQuestions,
      confidenceNotes,
    },
    source: 'fallback',
  };
}

function isFunctionCallItem(item: ResponseOutputItem): item is {
  type: 'function_call';
  name: string;
  arguments: string;
} {
  return item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string';
}
