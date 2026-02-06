export type ResponseInputItem =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | Record<string, unknown>;

export interface ResponseToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponseCreateParams {
  apiKey?: string;
  model: string;
  input: string | ResponseInputItem[];
  stream?: boolean;
  onOutputTextDelta?: (delta: string) => void;
  onStreamEvent?: (event: unknown) => void;
  previous_response_id?: string;
  conversation?: string;
  store?: boolean;
  truncation?: 'auto' | 'disabled';
  max_output_tokens?: number;
  text?: { format?: unknown };
  metadata?: Record<string, string>;
  instructions?: string;
  reasoning?: {
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  };
  tools?: ResponseToolDefinition[];
  tool_choice?: 'auto' | 'required' | { type: 'function'; name: string } | { type: 'allowed_tools'; mode: 'auto' | 'required'; tools: Array<{ type: 'function'; name: string }> };
}

export interface ResponseOutputItem {
  type: string;
  [key: string]: unknown;
}

export interface ResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
  [key: string]: unknown;
}

export interface ResponseCreateResult {
  id: string;
  status?: string;
  error?: unknown;
  incomplete_details?: unknown;
  usage?: ResponseUsage;
  output: ResponseOutputItem[];
  output_text: string;
}

export interface LLMClient {
  responsesCreate(params: ResponseCreateParams): Promise<ResponseCreateResult>;
}
