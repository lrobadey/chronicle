export const DEFAULT_GM_MODEL = 'gpt-5.1';
export const DEFAULT_GM_TEMPERATURE = 0.2;

// Optional override to flip GM model without code changes
export const GM_MODEL = process.env.GM_MODEL || DEFAULT_GM_MODEL;

// Narrator intentionally stays on a GPT-4.x model by default for latency/cost
export const NARRATOR_MODEL =
  process.env.VITE_NARRATOR_MODEL || process.env.NARRATOR_MODEL || 'gpt-5.1';
export const NARRATOR_TEMPERATURE = Number(process.env.VITE_NARRATOR_TEMPERATURE || process.env.NARRATOR_TEMPERATURE || '0.9');
export const NARRATOR_DEFAULT_STYLE = (
  process.env.VITE_NARRATOR_STYLE || process.env.NARRATOR_STYLE || 'michener'
) as 'lyric' | 'cinematic' | 'michener';

export function getDefaultOpenAIApiKey(): string | undefined {
  return typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_OPENAI_API_KEY : undefined;
}


