import type { LLMClient } from '../llm/types';
import { NPC_SYSTEM_PROMPT } from './prompts';

export interface NpcAgentOutput {
  npcId: string;
  publicUtterance: string;
  privateIntent: string;
  emotionalTone?: string;
}

export interface NpcAgentParams {
  apiKey?: string;
  model?: string;
  npcId: string;
  persona: { name: string; tagline?: string; background?: string; voice?: string; goals?: string[] };
  observation: unknown;
  playerText: string;
  llm: LLMClient;
}

export async function runNpcAgent(params: NpcAgentParams): Promise<NpcAgentOutput> {
  const { apiKey, model = 'gpt-5.2', npcId, persona, observation, playerText, llm } = params;

  if (!apiKey) {
    return {
      npcId,
      publicUtterance: `${persona.name} nods, saying little.`,
      privateIntent: 'stay_guarded',
    };
  }

  const response = await llm.responsesCreate({
    apiKey,
    model,
    instructions: NPC_SYSTEM_PROMPT,
    input: JSON.stringify({ persona, observation, playerText }),
  });
  let parsed: Partial<NpcAgentOutput> = {};
  try {
    parsed = JSON.parse(response.output_text || '{}');
  } catch {
    parsed = {};
  }

  return {
    npcId,
    publicUtterance: parsed.publicUtterance || `${persona.name} says nothing.`,
    privateIntent: parsed.privateIntent || 'wait',
    emotionalTone: parsed.emotionalTone,
  };
}
