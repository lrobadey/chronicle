import { callOpenAI, ChatMessage } from '../lib/openai';
import { OPENAI_TOOLS } from '../lib/toolSchemas';

export interface RunGmTurnParams {
  apiKey: string;
  model: string;
  world: unknown;
  playerText: string;
  execTool: (name: string, args: any) => Promise<any> | any;
  maxIters?: number;
  onTool?: (name: string, args: any) => void;
}

export async function runGmTurn({ apiKey, model, world, playerText, execTool, maxIters = 6, onTool }: RunGmTurnParams) {
  const system: ChatMessage = {
    role: 'system',
    content: [
      'You are the Game Master. Use tools to read/change state.',
      ' Do not invent state; always call tools. ',
      'When unsure, query before updating.',
    ].join(''),
  };
  const context: ChatMessage = { role: 'system', content: `World: ${JSON.stringify(world)}` };
  const messages: ChatMessage[] = [system, context, { role: 'user', content: playerText }];

  for (let i = 0; i < maxIters; i++) {
    const resp = await callOpenAI({ apiKey, model, messages, tools: OPENAI_TOOLS, temperature: 0.7 });
    const choice = resp.choices?.[0];
    const msg = choice?.message;
    const toolCalls = (msg as any)?.tool_calls ?? [];

    if (!toolCalls.length) {
      return { narration: (msg as any)?.content ?? '', messages };
    }

    for (const call of toolCalls) {
      const name = call.function.name;
      let args: any = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      if (onTool) onTool(name, args);
      // Execute locally
      const result = await execTool(name, args);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }
  return { narration: '(The GM hesitates, loop limit reached.)', messages };
}


