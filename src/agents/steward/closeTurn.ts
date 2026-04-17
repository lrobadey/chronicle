import type { CouncilArtifactRecord } from '../../engine/session/types';
import type {
  CharacterDesignerResultDetail,
  SystemsDesignerResultDetail,
  WorldDesignerResultDetail,
} from '../council';
import type { StewardCloseInput, StewardCloseResult } from './types';

function emptyAgendaUpdates() {
  return {};
}

export function closeStewardTurn(input: StewardCloseInput): StewardCloseResult {
  const domains = input.councilResults.map(packet => packet.result.domain);
  const systemsPacket = input.councilResults.find(packet => packet.result.domain === 'systems');
  const systemsDetail = (systemsPacket?.result.detail || null) as SystemsDesignerResultDetail | null;
  const characterPacket = input.councilResults.find(packet => packet.result.domain === 'character');
  const characterDetail = (characterPacket?.result.detail || null) as CharacterDesignerResultDetail | null;
  const worldPacket = input.councilResults.find(packet => packet.result.domain === 'world');
  const worldDetail = (worldPacket?.result.detail || null) as WorldDesignerResultDetail | null;

  const proposedEvents = input.councilResults.flatMap(packet => packet.result.proposedEvents);
  const councilArtifacts: CouncilArtifactRecord[] = [];

  if (characterPacket && characterDetail) {
    councilArtifacts.push({
      domain: 'character',
      summary: characterPacket.result.summary,
      selectedNpcIds: characterDetail.selectedNpcIds,
      privateIntentNotes: characterDetail.privateIntentNotes,
      publicUtterances: characterDetail.artifacts.map(artifact => ({
        npcId: artifact.npcId,
        text: artifact.publicUtterance,
        emotionalTone: artifact.emotionalTone,
      })),
    });
  }

  if (worldPacket && worldDetail) {
    councilArtifacts.push({
      domain: 'world',
      summary: worldPacket.result.summary,
      sceneMotionNotes: worldDetail.sceneMotionNotes,
      worldMotionNotes: worldDetail.worldMotionNotes,
      surfacedThreadIds: worldDetail.surfacedThreadIds,
      surfacedPendingEventIds: worldDetail.surfacedPendingEventIds,
    });
  }

  if (systemsPacket && systemsDetail) {
    councilArtifacts.push({
      domain: 'systems',
      summary: systemsPacket.result.summary,
      narratorPacket: systemsDetail.narratorPacket || null,
      pendingPromptRecommendation: systemsDetail.pendingPromptRecommendation || null,
    });
  }

  const handled =
    proposedEvents.length > 0 ||
    Boolean(systemsDetail?.handled && (
      systemsDetail.narratorPacket != null ||
      systemsDetail.pendingPromptRecommendation !== undefined
    ));

  if (!handled) {
    const fallbackReason =
      systemsDetail?.fallbackReason ||
      (domains.length ? 'no_council_result_handled' : 'no_council_results');
    return {
      handled: false,
      fallbackReason,
      summary: 'No council domain produced a committed result.',
      proposedEvents: [],
      acceptedEvents: [],
      rejectedEvents: [],
      agendaUpdates: emptyAgendaUpdates(),
      directorUpdates: null,
      councilArtifacts,
      narratorHandoff: { kind: 'legacy', packet: null },
      trace: {
        route: 'fallback_to_steward',
        reason: fallbackReason,
        councilDomains: domains,
      },
    };
  }

  const heldBeatsToRelease = input.turnPlan.heldBeatsToConsider;

  return {
    handled: true,
    summary: systemsPacket?.result.summary || characterPacket?.result.summary || worldPacket?.result.summary || 'Council turn handled.',
    proposedEvents,
    acceptedEvents: [],
    rejectedEvents: [],
    agendaUpdates: emptyAgendaUpdates(),
    directorUpdates: heldBeatsToRelease.length > 0
      ? { removeHeldBeats: heldBeatsToRelease }
      : null,
    councilArtifacts,
    narratorHandoff: systemsDetail?.handled && systemsDetail.narratorPacket
      ? { kind: 'systems_v1', packet: systemsDetail.narratorPacket }
      : { kind: 'legacy', packet: null },
    trace: {
      route: 'council',
      councilDomains: domains,
    },
  };
}
