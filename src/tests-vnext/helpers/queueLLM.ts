import type { LLMClient, ResponseCreateParams, ResponseCreateResult } from '../../agents/llm/types';

type QueuedResponse = Omit<ResponseCreateResult, 'id'> & { id?: string };

export class QueueLLM implements LLMClient {
  readonly calls: ResponseCreateParams[] = [];
  private queue: QueuedResponse[];
  private idCounter = 0;

  constructor(queue: QueuedResponse[]) {
    this.queue = [...queue];
  }

  async responsesCreate(params: ResponseCreateParams): Promise<ResponseCreateResult> {
    this.calls.push(params);
    const next = this.queue.shift();
    if (next) {
      return {
        id: next.id || `resp-${++this.idCounter}`,
        status: next.status || 'completed',
        output: next.output,
        output_text: next.output_text,
        error: next.error,
        incomplete_details: next.incomplete_details,
        usage: next.usage,
      };
    }

    return { id: `resp-${++this.idCounter}`, status: 'completed', output: [], output_text: '' };
  }
}
