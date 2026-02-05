export type MessageRole = 'player' | 'gm' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  status?: 'pending' | 'thinking' | 'done' | 'error';
  meta?: {
    fallback?: boolean;
  };
}

export interface Tool {
  id: string;
  name: string;
  description: string;
}

export interface WorldStateData {
  gtwg: { [key: string]: any };
  pkg: { [key: string]: any };
  ledger: string[];
  telemetry?: Record<string, any>;
}

export interface EventLogEntry {
  id: string;
  type: 'phase' | 'tool' | 'status' | 'error';
  label: string;
  detail?: string;
  timestamp: number;
}

export interface PatchLike {
  note?: string;
  path?: string;
  [key: string]: any;
}

export interface TurnResultPayload {
  narration: string;
  world: {
    location: string;
    locationName: string;
    position: { x: number; y: number; z?: number };
    inventory: { id: string; name: string }[];
  };
  patches: PatchLike[];
  stateSummary: any;
  telemetry: Record<string, any>;
  pkg: Record<string, any>;
  usedFallback: boolean;
}

export interface SessionInitPayload {
  sessionId: string;
  created: boolean;
  initialNarration: string;
  world: TurnResultPayload['world'];
  telemetry: Record<string, any>;
  pkg: Record<string, any>;
}

export type TurnPhase = 'idle' | 'gm_start' | 'gm_complete' | 'narrator_start' | 'narrator_complete';

export type GMEventPayload =
  | { type: 'llm_start'; prompts: string[] }
  | { type: 'llm_token'; token: string }
  | { type: 'llm_end' }
  | { type: 'tool_start'; tool: string; input: unknown }
  | { type: 'tool_end'; tool: string; output: unknown }
  | { type: 'agent_action'; action: unknown }
  | { type: 'error'; message: string };
