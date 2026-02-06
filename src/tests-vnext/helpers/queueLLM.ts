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
      const result = {
        id: next.id || `resp-${++this.idCounter}`,
        status: next.status || 'completed',
        output: next.output,
        output_text: next.output_text,
        error: next.error,
        incomplete_details: next.incomplete_details,
        usage: next.usage,
      };
      if (params.stream) {
        params.onStreamEvent?.({ type: 'response.created' });
        if (result.output_text) {
          params.onOutputTextDelta?.(result.output_text);
          params.onStreamEvent?.({ type: 'response.output_text.delta', delta: result.output_text });
        }
        params.onStreamEvent?.({ type: 'response.completed', response: result });
      }
      return result;
    }

    const result = { id: `resp-${++this.idCounter}`, status: 'completed', output: [], output_text: '' };
    if (params.stream) {
      params.onStreamEvent?.({ type: 'response.created' });
      params.onStreamEvent?.({ type: 'response.completed', response: result });
    }
    return result;
  }
}
