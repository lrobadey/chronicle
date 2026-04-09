import { classifyTurn } from '../hierarchy';
import type { StewardOpenInput, StewardOpenResult } from './types';

export function openStewardTurn(input: StewardOpenInput): StewardOpenResult {
  const turnPlan = classifyTurn({
    playerText: input.playerText,
    directorState: input.directorState,
    telemetry: input.telemetry,
    pendingPrompt: input.pendingPrompt,
    turnNumber: input.turnNumber,
  });

  return {
    turnPlan,
    councilTasks: [],
  };
}
