import type { ConversationTranscriptEntry } from '../../../engine/contextBuilders';
import type { RecentTurnDigest } from '../../../engine/session/types';
import type { WorldEvent } from '../../../sim/events';
import type { PendingPrompt } from '../../../sim/state';

export interface CharacterSceneNpc {
  npcId: string;
  name: string;
  distanceMeters: number;
  tags: string[];
  persona: {
    tagline: string;
    background: string;
    voice: string;
    goals: string[];
  } | null;
  relationships: Array<{
    actorId: string;
    actorName: string;
    trust: number;
    fear: number;
    affinity: number;
  }>;
  factionMemberships: Array<{
    factionId: string;
    factionName: string;
    playerStanding: number | null;
  }>;
}

export interface CharacterDesignerTaskContext {
  playerText: string;
  pendingPrompt: PendingPrompt | null;
  sceneObservation: unknown;
  recentTurns: RecentTurnDigest[];
  nearbyNpcs: CharacterSceneNpc[];
  conversationHistory: ConversationTranscriptEntry[];
  factionContext: {
    relevantFactionIds: string[];
    playerStandings: Record<string, number>;
  };
}

/**
 * Lean seed for the Character Designer agent prompt.
 *
 * Design rule: NPC IDs + one-line taglines; no full personas, no full relationship
 * matrices, no full conversation transcripts. The agent pulls full detail via
 * inspect_character_scene / inspect_conversation_history / inspect_relationship_state
 * / inspect_faction_context on demand.
 */
export interface CharacterDesignerTaskBrief {
  taskId: string;
  playerText: string;
  pendingPrompt: { id: string; kind: string; question: string } | null;
  sceneNpcs: Array<{
    npcId: string;
    name: string;
    distanceMeters: number;
    tagline: string | null;
    tags: string[];
  }>;
  conversationTail: Array<{ speakerId: string | null; text: string }>;
  factionHints: {
    relevantFactionIds: string[];
    nonNeutralStandingIds: string[];
  };
  recentTurnHeadlines: Array<{ turn: number; headline: string }>;
  totals: {
    nearbyNpcs: number;
    conversationHistory: number;
    recentTurns: number;
  };
}

const CD_MAX_TEXT = 140;

function cdClip(value: string | undefined | null, max = CD_MAX_TEXT): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function buildCharacterDesignerBrief(
  taskId: string,
  context: CharacterDesignerTaskContext,
): CharacterDesignerTaskBrief {
  const nonNeutralStandingIds = Object.entries(context.factionContext.playerStandings)
    .filter(([, standing]) => Math.abs(standing) > 0.1)
    .map(([factionId]) => factionId);
  return {
    taskId,
    playerText: cdClip(context.playerText, 400),
    pendingPrompt: context.pendingPrompt
      ? {
          id: context.pendingPrompt.id,
          kind: context.pendingPrompt.kind,
          question: cdClip(context.pendingPrompt.question),
        }
      : null,
    sceneNpcs: context.nearbyNpcs.slice(0, 6).map(npc => ({
      npcId: npc.npcId,
      name: npc.name,
      distanceMeters: npc.distanceMeters,
      tagline: npc.persona ? cdClip(npc.persona.tagline, 100) : null,
      tags: (npc.tags || []).slice(0, 4),
    })),
    conversationTail: context.conversationHistory.slice(-3).map(entry => ({
      speakerId: entry.speakerId ?? null,
      text: cdClip(entry.text, 120),
    })),
    factionHints: {
      relevantFactionIds: context.factionContext.relevantFactionIds.slice(0, 4),
      nonNeutralStandingIds: nonNeutralStandingIds.slice(0, 4),
    },
    recentTurnHeadlines: context.recentTurns.slice(-3).map(turn => ({
      turn: turn.turn,
      headline: cdClip(turn.playerText || turn.narration || '', 120),
    })),
    totals: {
      nearbyNpcs: context.nearbyNpcs.length,
      conversationHistory: context.conversationHistory.length,
      recentTurns: context.recentTurns.length,
    },
  };
}

export interface CharacterSelectionResult {
  npcIds: string[];
  confidence: number;
  rationale: string;
}

export interface CharacterReplyDraft {
  publicUtterance: string;
  emotionalTone: string | null;
}

export interface CharacterIntentDraft {
  privateIntent: string;
}

export interface CharacterDesignerResultDetail {
  selectedNpcIds: string[];
  privateIntentNotes: Array<{ npcId: string; note: string }>;
  relationshipNotes: Array<{ npcId: string; note: string }>;
  artifacts: Array<{
    npcId: string;
    publicUtterance: string;
    emotionalTone?: string;
    privateIntent: string;
  }>;
}

export interface CharacterDesignerArtifact {
  domain: 'character';
  summary: string;
  selectedNpcIds: string[];
  privateIntentNotes: Array<{ npcId: string; note: string }>;
  publicUtterances: Array<{ npcId: string; text: string; emotionalTone?: string }>;
}

export interface CharacterCouncilToolRuntime {
  inspect_character_scene(input: { question?: string | null; focusNpcId?: string | null }): Promise<unknown>;
  inspect_conversation_history(input: { limit?: number | null }): Promise<unknown>;
  inspect_relationship_state(input: { npcId?: string | null }): Promise<unknown>;
  inspect_faction_context(input: { npcId?: string | null }): Promise<unknown>;
  worker_select_npc(input: { playerText?: string | null; maxCandidates?: number | null }): Promise<CharacterSelectionResult>;
  worker_draft_npc_reply(input: { npcId: string }): Promise<CharacterReplyDraft>;
  worker_draft_private_intent(input: { npcId: string }): Promise<CharacterIntentDraft>;
  emit_character_result(input: {
    summary: string;
    candidateEvents: WorldEvent[];
    selectedNpcIds: string[];
    privateIntentNotes: Array<{ npcId: string; note: string }>;
    relationshipNotes?: Array<{ npcId: string; note: string }> | null;
    artifacts: Array<{
      npcId: string;
      publicUtterance: string;
      emotionalTone?: string | null;
      privateIntent: string;
    }>;
    warnings?: string[] | null;
  }): Promise<unknown>;
}
