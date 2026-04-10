/**
 * Character Designer (Council) — domain-specific task and result types.
 *
 * Owns: NPC personas, relationships, private intentions, dialogue posture,
 * moods, social dynamics.
 *
 * Should produce per NPC per scene: a public utterance and a private intent.
 * The public utterance surfaces through narration or direct speech.
 * The private intent is retained for governance without leaking to the player.
 *
 * Evolves from the current NPC agent in src/agents/npc/.
 */

// ---------------------------------------------------------------------------
// Task context — what the Steward sends
// ---------------------------------------------------------------------------

/** Domain-scoped context for a Character Designer task. */
export interface CharacterDesignerTaskContext {
  /** NPC IDs the Steward wants consulted for this turn. */
  targetNpcIds: string[];
  /** Relationship queries to resolve (e.g. faction dynamics, social tension). */
  relationshipQueries: string[];
  /** Dialogue direction from the Steward (topic, tone, urgency). */
  dialogueDirection: {
    topic?: string;
    desiredTone?: string;
    urgency?: 'low' | 'medium' | 'high';
  } | null;
  /** Scene-scoped observation for NPC awareness. */
  sceneObservation: unknown;
  /** Conversation history relevant to this turn. */
  conversationHistory: unknown;
  /**
   * Faction context the Steward provides so the Character Designer can
   * reason about inter-faction dynamics and the player's standing with
   * each faction present in the scene.
   */
  factionContext?: {
    /** Faction IDs relevant to this scene (members present or topic of conversation). */
    relevantFactionIds: string[];
    /** The player's current standing with each relevant faction. */
    playerStandings: Record<string, number>;
  };
}

// ---------------------------------------------------------------------------
// Result detail — what the Character Designer returns
// ---------------------------------------------------------------------------

/** A single NPC's output from the Character Designer. */
export interface NpcCharacterOutput {
  npcId: string;
  /** What can surface through narration or direct speech. */
  publicUtterance: string;
  /** What governance and future reasoning can retain (never shown to player). */
  privateIntent: string;
  emotionalTone: string;
}

/** Domain-specific detail in the Character Designer's council result. */
export interface CharacterDesignerResultDetail {
  npcOutputs: NpcCharacterOutput[];
  /**
   * Relationship changes observed or recommended.
   * When factionId is present the change is to the actor's faction standing
   * (proposed as a ModifyReputation event); otherwise it is a bilateral NPC
   * relationship update (trust / fear / affinity).
   */
  relationshipUpdates: Array<{
    fromActorId: string;
    toActorId: string;
    change: string;
    /** Present when the change should be recorded as a ModifyReputation event. */
    factionId?: string;
    /** Numeric delta for faction standing changes. Positive = improve, negative = worsen. */
    standingDelta?: number;
  }>;
}
