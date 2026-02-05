export interface LLMErrorDetails {
  kind: 'context_window' | 'rate_limit' | 'invalid_request' | 'authentication' | 'api' | 'unknown';
  message: string;
  status?: number;
  code?: string;
  type?: string;
}

export function classifyLLMError(error: unknown): LLMErrorDetails {
  const message = error instanceof Error ? error.message : 'unknown_error';
  const candidate = asObject(error);

  const status = typeof candidate?.status === 'number' ? candidate.status : undefined;
  const code = typeof candidate?.code === 'string' ? candidate.code : undefined;
  const type = typeof candidate?.type === 'string' ? candidate.type : undefined;
  const normalized = [message, code || '', type || ''].join(' ').toLowerCase();

  if (status === 401 || normalized.includes('unauthorized') || normalized.includes('invalid api key')) {
    return { kind: 'authentication', message, status, code, type };
  }
  if (status === 429 || normalized.includes('rate limit') || normalized.includes('quota')) {
    return { kind: 'rate_limit', message, status, code, type };
  }
  if (
    normalized.includes('context window')
    || normalized.includes('too many tokens')
    || normalized.includes('maximum context')
  ) {
    return { kind: 'context_window', message, status, code, type };
  }
  if (status === 400 || normalized.includes('invalid') || normalized.includes('bad request')) {
    return { kind: 'invalid_request', message, status, code, type };
  }
  if (typeof status === 'number' && status >= 500) {
    return { kind: 'api', message, status, code, type };
  }

  return { kind: 'unknown', message, status, code, type };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
