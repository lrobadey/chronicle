import OpenAI from 'openai';
import type { LLMClient, ResponseCreateParams, ResponseCreateResult } from './types';

export class OpenAIClient implements LLMClient {
  async responsesCreate(params: ResponseCreateParams): Promise<ResponseCreateResult> {
    if (!params.apiKey) {
      return { output: [], output_text: '' };
    }

    const client = new OpenAI({ apiKey: params.apiKey });
    const response = await client.responses.create({
      model: params.model,
      input: params.input as any,
      instructions: params.instructions,
      tools: params.tools as any,
      tool_choice: (params.tool_choice ?? (params.tools?.length ? 'auto' : undefined)) as any,
    } as any);

    return {
      output: (response.output ?? []) as unknown as ResponseCreateResult['output'],
      output_text: response.output_text ?? '',
    };
  }
}
