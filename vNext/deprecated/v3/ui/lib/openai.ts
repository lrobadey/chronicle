export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIResponseChoice {
  message?: {
    role?: 'assistant';
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
}

export interface ChatCompletionsResponse {
  choices?: OpenAIResponseChoice[];
}

export async function callOpenAI({ apiKey, model, messages, tools, temperature = 0.7 }: {
  apiKey: string;
  model: string;
  messages: Array<ChatMessage>;
  tools?: Array<ToolDefinition>;
  temperature?: number;
}): Promise<ChatCompletionsResponse> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, tools, temperature }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `OpenAI error ${res.status}`);
  }
  return (await res.json()) as ChatCompletionsResponse;
}


