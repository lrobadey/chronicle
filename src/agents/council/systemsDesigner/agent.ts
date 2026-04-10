import { attachResolutionMetadata, runMechanicsAgent } from '../../mechanics';
import type { LLMClient } from '../../llm/types';
import type { CouncilResult, CouncilTask } from '../../hierarchy/types';
import type { SystemsDesignerResultDetail, SystemsDesignerTaskContext } from './types';

export interface SystemsDesignerAgentParams {
  apiKey?: string;
  llm: LLMClient;
  turnNumber: number;
}

export async function runSystemsDesignerTask(
  task: CouncilTask<'systems'>,
  params: SystemsDesignerAgentParams,
): Promise<CouncilResult<'systems'>> {
  const context = task.context as SystemsDesignerTaskContext;

  if (context.intent === 'observation') {
    const detail: SystemsDesignerResultDetail = {
      handled: true,
      narratorPacket: {
        version: 'systems_v1',
        intent: 'observation',
        playerText: context.playerText,
        summary: 'Read-only observation of the player surroundings.',
        telemetry: context.telemetry,
        observation: context.observation,
        warnings: [],
      },
      mechanicsResolution: null,
    };
    return {
      taskId: task.taskId,
      domain: 'systems',
      summary: 'Observed the local state without mutating the world.',
      proposedEvents: [],
      detail,
      confidence: 1,
      warnings: [],
    };
  }

  if (context.intent === 'cardinal_movement' && context.mechanicsRequest) {
    const draft = await runMechanicsAgent({
      apiKey: params.apiKey,
      request: context.mechanicsRequest,
      llm: params.llm,
    });
    const resolution = attachResolutionMetadata(
      draft,
      `systems-${params.turnNumber}-${task.taskId}`,
      context.mechanicsRequest.pendingPrompt,
      params.turnNumber,
    );

    const movementOnly =
      resolution.status === 'ok' &&
      resolution.pendingPrompt === null &&
      resolution.confidence >= 0.6 &&
      resolution.candidateEvents.length > 0 &&
      resolution.candidateEvents.every(event => event.type === 'MoveActor');

    const detail: SystemsDesignerResultDetail = movementOnly
      ? {
          handled: true,
          narratorPacket: {
            version: 'systems_v1',
            intent: 'cardinal_movement',
            playerText: context.playerText,
            summary: resolution.summary,
            telemetry: context.telemetry,
            observation: context.observation,
            warnings: resolution.warnings,
          },
          mechanicsResolution: resolution,
        }
      : {
          handled: false,
          fallbackReason:
            resolution.status !== 'ok'
              ? `systems_mechanics_${resolution.status}`
              : resolution.pendingPrompt
                ? 'systems_mechanics_prompt_not_supported'
                : 'systems_mechanics_unsafe_events',
          narratorPacket: null,
          mechanicsResolution: resolution,
        };

    return {
      taskId: task.taskId,
      domain: 'systems',
      summary: movementOnly ? resolution.summary : 'Systems council could not safely own this movement turn.',
      proposedEvents: movementOnly ? resolution.candidateEvents : [],
      detail,
      confidence: resolution.confidence,
      warnings: resolution.warnings,
    };
  }

  const detail: SystemsDesignerResultDetail = {
    handled: false,
    fallbackReason: 'systems_task_not_supported',
    narratorPacket: null,
    mechanicsResolution: null,
  };

  return {
    taskId: task.taskId,
    domain: 'systems',
    summary: 'Systems council could not classify the task context.',
    proposedEvents: [],
    detail,
    confidence: 0,
    warnings: ['systems_task_not_supported'],
  };
}
