import type { StaffInterviewContext } from '../../engine/contextBuilders';

export interface StaffInterviewDiagnostics {
  currentUnderstanding: string;
  knownGoals: string[];
  missingContext: string[];
  frictionPoints: string[];
  improvementIdeas: string[];
  suggestedQuestions: string[];
  confidenceNotes: string[];
}

export interface StaffInterviewResult {
  employeeReply: string;
  diagnostics: StaffInterviewDiagnostics;
  source: 'live' | 'fallback';
}

export interface StaffInterviewMessage {
  role: 'operator' | 'employee';
  content: string;
}

export interface StaffInterviewInput {
  question: string;
  context: StaffInterviewContext;
  conversation?: StaffInterviewMessage[];
}
