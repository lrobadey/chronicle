import { callOpenAI, ChatMessage } from '../lib/openai';

export interface RunNarratorTurnParams {
  apiKey: string;
  model: string;
  playerText: string;
  world: unknown;
  lastPatchDescription?: string | null;
  steps?: string[];
}

export async function runNarratorTurn({ apiKey, model, playerText, world, lastPatchDescription, steps = [] }: RunNarratorTurnParams): Promise<{ narration: string }> {
  const system: ChatMessage = {
    role: 'system',
    content: [
      'You are the Narrator for a text adventure. Your job is to narrate only.',
      ' Do not decide actions or modify state. Describe outcomes from the provided changes.',
      ' Keep it concise, vivid, grounded in the given state and patch description.',
    ].join(''),
  };

  const context: ChatMessage = {
    role: 'system',
    content: JSON.stringify({
      playerInput: playerText,
      lastPatchDescription: lastPatchDescription ?? null,
      steps,
      worldSnapshot: world,
    }),
  };

  const user: ChatMessage = {
    role: 'user',
    content: 'Narrate what just happened for the player. Focus on immediate, sensory details and next obvious affordances. Avoid meta talk.',
  };

  const resp = await callOpenAI({ apiKey, model, messages: [system, context, user], temperature: 0.7 });
  const msg = resp.choices?.[0]?.message;
  return { narration: (msg?.content ?? '').toString() };
}


