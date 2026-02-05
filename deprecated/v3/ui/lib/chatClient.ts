import type {
  SessionInitPayload,
  TurnResultPayload,
  GMEventPayload,
  TurnPhase,
} from '../types';

type SessionOptions = {
  sessionId?: string;
  reset?: boolean;
};

type StreamHandlers = {
  onSession?: (info: { sessionId: string; created?: boolean }) => void;
  onPhase?: (phase: TurnPhase) => void;
  onGMEvent?: (event: GMEventPayload) => void;
  onToken?: (token: string) => void;
  onResult?: (result: TurnResultPayload) => void;
  onError?: (message: string) => void;
};

type StreamParams = {
  sessionId?: string;
  playerText: string;
  signal?: AbortSignal;
} & StreamHandlers;

const DEFAULT_BASE = 'http://localhost:3001';
const rawBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const API_BASE = rawBase && rawBase.length ? rawBase.replace(/\/$/, '') : DEFAULT_BASE;

function buildUrl(path: string) {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${API_BASE}${path}`;
}

async function parseJSON<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new Error('Empty response from server');
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(text || (err as Error).message);
  }
}

export async function initializeSession(options?: SessionOptions): Promise<SessionInitPayload> {
  const response = await fetch(buildUrl('/api/session'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: options?.sessionId,
      reset: options?.reset,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as SessionInitPayload;
}

export async function streamChatTurn(params: StreamParams): Promise<void> {
  const { sessionId, playerText, signal, onSession, onPhase, onGMEvent, onToken, onResult, onError } = params;
  const response = await fetch(buildUrl('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerText }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (!response.body) {
    throw new Error('Server did not provide a response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (event: string, payload: any) => {
    switch (event) {
      case 'session':
        if (payload?.sessionId) {
          onSession?.(payload);
        }
        break;
      case 'phase':
        onPhase?.((payload?.phase as TurnPhase) ?? 'idle');
        break;
      case 'gm_token':
        if (typeof payload?.token === 'string') {
          onToken?.(payload.token);
        }
        break;
      case 'gm_event':
        if (payload?.type) {
          onGMEvent?.(payload as GMEventPayload);
        }
        break;
      case 'result':
        onResult?.(payload as TurnResultPayload);
        break;
      case 'error':
        if (payload?.message) {
          onError?.(payload.message);
        }
        break;
      default:
        break;
    }
  };

  const processBuffer = () => {
    let clean = buffer.replace(/\r/g, '');
    let boundary = clean.indexOf('\n\n');
    while (boundary >= 0) {
      const rawEvent = clean.slice(0, boundary);
      const remainder = clean.slice(boundary + 2);
      buffer = remainder;
      clean = remainder.replace(/\r/g, '');

      if (rawEvent.trim().length) {
        const lines = rawEvent.split('\n');
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith('event:')) {
            const value = line.slice(6).trim();
            if (value) {
              eventName = value;
            }
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        const dataText = dataLines.join('\n');
        let payload: any = undefined;
        if (dataText) {
          try {
            payload = JSON.parse(dataText);
          } catch {
            payload = dataText;
          }
        }
        dispatch(eventName, payload);
      }

      boundary = clean.indexOf('\n\n');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      processBuffer();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    processBuffer();
  }
}
