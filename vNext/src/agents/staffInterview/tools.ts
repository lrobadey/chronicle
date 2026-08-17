import type { ResponseToolDefinition } from '../llm/types';
import { strictObjectSchema } from '../sharedSchemas';

export const FINISH_STAFF_INTERVIEW_TOOL_NAME = 'finish_staff_interview';

export const STAFF_INTERVIEW_TOOL: ResponseToolDefinition = {
  type: 'function',
  name: FINISH_STAFF_INTERVIEW_TOOL_NAME,
  description: 'Return the employee-style reply and structured diagnostics for the operator.',
  strict: true,
  parameters: strictObjectSchema({
    employeeReply: { type: 'string' },
    diagnostics: strictObjectSchema({
      currentUnderstanding: { type: 'string' },
      knownGoals: { type: 'array', items: { type: 'string' } },
      missingContext: { type: 'array', items: { type: 'string' } },
      frictionPoints: { type: 'array', items: { type: 'string' } },
      improvementIdeas: { type: 'array', items: { type: 'string' } },
      suggestedQuestions: { type: 'array', items: { type: 'string' } },
      confidenceNotes: { type: 'array', items: { type: 'string' } },
    }),
  }),
};
