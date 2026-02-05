import type { LLMClient, ResponseCreateParams, ResponseCreateResult } from '../../agents/llm/types';

export class QueueLLM implements LLMClient {
  readonly calls: ResponseCreateParams[] = [];
  private queue: ResponseCreateResult[];

  constructor(queue: ResponseCreateResult[]) {
    this.queue = [...queue];
  }

  async responsesCreate(params: ResponseCreateParams): Promise<ResponseCreateResult> {
    this.calls.push(params);
    return this.queue.shift() ?? { output: [], output_text: '' };
  }
}
