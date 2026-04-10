import { classifyTurn } from '../hierarchy';
import type { MechanicsTravelCandidate } from '../mechanics';
import type { StewardOpenInput, StewardOpenResult } from './types';
import type { SystemsDesignerTaskContext } from '../council';

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

  const systemsIntent = inferSystemsIntent(input.playerText);
  const worldContext = input.worldContext as {
    telemetry: SystemsDesignerTaskContext['telemetry'];
    observation: SystemsDesignerTaskContext['observation'];
    travelCandidates?: MechanicsTravelCandidate[];
    nearby?: { actors: unknown[]; itemsOnGround: unknown[] };
    landmarks?: unknown[];
  };

  return {
    turnPlan,
    councilTasks:
      turnPlan.classification === 'simple_council' &&
      turnPlan.requiredDomains.length === 1 &&
      turnPlan.requiredDomains[0] === 'systems' &&
      systemsIntent
        ? [{
            task: {
              taskId: `systems-${input.turnNumber}`,
              domain: 'systems',
              directive:
                systemsIntent === 'observation'
                  ? 'Return a bounded read-only observation packet for narration.'
                  : 'Resolve a safe cardinal movement through the mechanics path or request fallback.',
              context: {
                intent: systemsIntent,
                playerText: input.playerText,
                telemetry: worldContext.telemetry,
                observation: worldContext.observation,
                mechanicsRequest: systemsIntent === 'cardinal_movement'
                  ? {
                      playerText: input.playerText,
                      pendingPrompt: input.pendingPrompt,
                      telemetry: worldContext.telemetry,
                      travelCandidates: worldContext.travelCandidates || [],
                      nearby: worldContext.nearby || { actors: [], itemsOnGround: [] },
                      landmarks: worldContext.landmarks || [],
                      observation: worldContext.observation,
                      localAffordances: {
                        carriedItems: [],
                        nearbyItems: [],
                        nearbyActors: [],
                        obviousOffers: [],
                      },
                    }
                  : null,
              } satisfies SystemsDesignerTaskContext,
              priority: 'required',
            },
            directorState: input.directorState,
            turnNumber: input.turnNumber,
            playerText: input.playerText,
          }]
        : [],
  };
}
