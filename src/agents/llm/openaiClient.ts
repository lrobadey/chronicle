import OpenAI from 'openai';
import type { LLMClient, ResponseCreateParams, ResponseCreateResult } from './types';

export class OpenAIClient implements LLMClient {
  async responsesCreate(params: ResponseCreateParams): Promise<ResponseCreateResult> {
    if (!params.apiKey) {
      return { id: 'local-no-api-key', output: [], output_text: '', status: 'completed' };
    }

    const client = new OpenAI({ apiKey: params.apiKey });
    const payload = {
      model: params.model,
      input: params.input as any,
      previous_response_id: params.previous_response_id,
      conversation: params.conversation as any,
      store: params.store,
      truncation: params.truncation,
      max_output_tokens: params.max_output_tokens,
      text: params.text as any,
      metadata: params.metadata,
      instructions: params.instructions,
      reasoning: params.reasoning ?? { effort: 'medium' },
      tools: params.tools as any,
      tool_choice: (params.tool_choice ?? (params.tools?.length ? 'auto' : undefined)) as any,
    };

    if (params.stream) {
      const stream = await client.responses.create({
        ...payload,
        stream: true,
      } as any);
      let completedResponse: any;
      let streamedText = '';
      for await (const event of stream as any) {
        params.onStreamEvent?.(event);
        if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          streamedText += event.delta;
          params.onOutputTextDelta?.(event.delta);
        }
        if (event?.type === 'response.completed' && event.response) {
          completedResponse = event.response;
        }
      }

      if (!completedResponse) {
        throw new Error('response_stream_incomplete');
      }
      if (!completedResponse.output_text && streamedText) {
        completedResponse.output_text = streamedText;
      }
      return toResult(completedResponse);
    }

    const response = await client.responses.create(payload as any);
    return toResult(response);
  }
}

function toResult(response: any): ResponseCreateResult {
  return {
      id: response.id,
      status: response.status ?? undefined,
      error: response.error ?? undefined,
      incomplete_details: response.incomplete_details ?? undefined,
      usage: response.usage as unknown as ResponseCreateResult['usage'],
      output: (response.output ?? []) as unknown as ResponseCreateResult['output'],
      output_text: response.output_text ?? '',
  };
}
