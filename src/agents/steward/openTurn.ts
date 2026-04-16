import { classifyTurn } from '../hierarchy';
import type { StewardOpenInput, StewardOpenResult } from './types';
import type {
  CharacterDesignerTaskContext,
  SystemsDesignerTaskContext,
  WorldDesignerTaskContext,
} from '../council';

function inferSystemsIntent(playerText: string): SystemsDesignerTaskContext['intent'] | null {
  const text = playerText.trim().toLowerCase();
  if (
    /^(look\b|look around|observe|examine surroundings|where am i|inventory|check inventory|what do i (have|see|carry))/.test(text)
  ) {
    return 'observation';
  }
  if (/^(?:i\s+)?(?:go|walk|move|run|head|travel)\s+(?:north|south|east|west)\b/.test(text)) {
    return 'cardinal_movement';
  }
  return null;
}

export function openStewardTurn(input: StewardOpenInput): StewardOpenResult {
  const turnPlan = classifyTurn({
    playerText: input.playerText,
    directorState: input.directorState,
    telemetry: input.telemetry,
    pendingPrompt: input.pendingPrompt,
    turnNumber: input.turnNumber,
  });

  const worldContext = input.worldContext as {
    routingSummary?: unknown;
    characterContext?: CharacterDesignerTaskContext;
    worldDesignerContext?: WorldDesignerTaskContext;
    systemsContext?: SystemsDesignerTaskContext;
  };
  const councilTasks = [];
  const systemsIntent = inferSystemsIntent(input.playerText);

  if (turnPlan.classification !== 'steward_judgment') {
    if (
      (turnPlan.requiredDomains.includes('systems') || turnPlan.classification === 'deterministic') &&
      worldContext.systemsContext
    ) {
      councilTasks.push({
        task: {
          taskId: `systems-${input.turnNumber}`,
          domain: 'systems',
          directive:
            turnPlan.classification === 'deterministic'
              ? 'Resolve the mechanically owned action through the systems domain.'
              : systemsIntent === 'observation'
                ? 'Return a bounded read-only observation packet for narration.'
                : systemsIntent === 'cardinal_movement'
                  ? 'Resolve a safe cardinal movement through the mechanics path or request fallback.'
                  : 'Resolve the systems-owned portion of this turn.',
          context: {
            ...worldContext.systemsContext,
            executionMode:
              turnPlan.classification === 'deterministic' || systemsIntent === 'cardinal_movement'
                ? 'direct_mechanics'
                : worldContext.systemsContext.executionMode,
            intent:
              systemsIntent ||
              (turnPlan.classification === 'deterministic' ? 'general_systems' : worldContext.systemsContext.intent),
          } satisfies SystemsDesignerTaskContext,
          priority: 'required',
        },
        directorState: input.directorState,
        turnNumber: input.turnNumber,
        playerText: input.playerText,
      });
    }

    if (turnPlan.requiredDomains.includes('character') && worldContext.characterContext) {
      councilTasks.push({
        task: {
          taskId: `character-${input.turnNumber}`,
          domain: 'character',
          directive: `Determine the relevant NPC response to: "${input.playerText}"`,
          context: worldContext.characterContext,
          priority: 'required',
        },
        directorState: input.directorState,
        turnNumber: input.turnNumber,
        playerText: input.playerText,
      });
    }

    if (
      (turnPlan.requiredDomains.includes('world') || turnPlan.optionalDomains.includes('world')) &&
      worldContext.worldDesignerContext
    ) {
      councilTasks.push({
        task: {
          taskId: `world-${input.turnNumber}`,
          domain: 'world',
          directive: `Surface the most relevant scene and world motion for: "${input.playerText}"`,
          context: worldContext.worldDesignerContext,
          priority: turnPlan.requiredDomains.includes('world') ? 'required' : 'optional',
        },
        directorState: input.directorState,
        turnNumber: input.turnNumber,
        playerText: input.playerText,
      });
    }
  }

  return { turnPlan, councilTasks };
}
