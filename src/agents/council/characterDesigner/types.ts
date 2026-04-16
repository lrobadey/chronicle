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
