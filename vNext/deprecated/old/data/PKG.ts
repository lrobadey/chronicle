// PKG.ts - Player-Knowledge Graph Data Store
// ============================================
//
// SYSTEMS ARCHITECTURE OVERVIEW:
// The PKG (Player Knowledge Graph) models what the player/character KNOWS about the world,
// as opposed to GTWG which models what actually EXISTS in the world.
//
// KEY PHILOSOPHICAL DISTINCTION:
// - GTWG = Objective Reality ("God's view" of the world)
// - PKG = Subjective Knowledge ("Player's view" of the world)
// - This separation enables realistic information asymmetry and discovery mechanics
//
// CORE ARCHITECTURAL INSIGHTS:
// 1. EPISTEMIC MODELING: Treats knowledge as data with uncertainty
//    - Facts = things player knows with certainty (confidence = 1.0)
//    - Rumors = things player thinks they know (confidence = 0.0-1.0)
//    - Same entity can have multiple rumors with different confidence levels
//
// 2. INFORMATION PROVENANCE: Tracks how knowledge was acquired
//    - Source tracking enables questioning reliability
//    - Timestamp enables knowledge aging and update logic
//    - Different sources can provide conflicting information
//
// 3. GRADUAL REVELATION: Knowledge builds incrementally
//    - Start with rumors, upgrade to facts through investigation
//    - Confidence can increase/decrease as new information arrives
//    - Creates natural gameplay loop: hear → investigate → confirm
//
// 4. PERSONALITY INTEGRATION: Different characters discover differently
//    - Curious characters generate more rumors
//    - Analytical characters have higher fact confidence
//    - Insecure characters doubt their discoveries
//    - Same world generates different knowledge patterns for different personalities
//
// Pure functional implementation with immutable operations

/**
 * DISCOVERED FACT: Represents confirmed knowledge about the world
 * 
 * SYSTEMS PURPOSE: Models "things the player knows for certain"
 * - Player has investigated and confirmed this information
 * - Represents upgrade from rumor to verified knowledge
 * - Used for UI display, decision making, quest progression
 * 
 * KNOWLEDGE GRANULARITY: Can represent entity or relationship knowledge
 * - entityId only: "I know this tavern exists"
 * - entityId + relationId: "I know this tavern is north of the market"
 * - Flexible model supports both simple and complex knowledge
 * 
 * TEMPORAL TRACKING: discoveredAt enables knowledge timeline
 * - When did player learn this fact?
 * - Supports knowledge aging, recency effects
 * - Debugging: trace knowledge acquisition patterns
 * 
 * SOURCE PROVENANCE: How was this knowledge acquired?
 * - "direct observation", "NPC conversation", "document reading"
 * - Enables reliability assessment (seeing vs. hearing)
 * - Could affect confidence in future related discoveries
 */
export interface PKGDiscoveredFact {
  entityId: string;      // What entity this fact is about
  relationId?: string;   // Optional: what relationship this fact describes
  discoveredAt: string;  // ISO timestamp: when was this discovered?
  source?: string;       // How was this discovered? (observation, conversation, etc.)
}

/**
 * RUMOR: Represents uncertain knowledge about the world
 * 
 * SYSTEMS PURPOSE: Models "things the player thinks they know"
 * - Partial, uncertain, or unverified information
 * - Creates investigation opportunities ("I should check this out")
 * - Enables realistic information discovery patterns
 * 
 * CONFIDENCE MODELING: 0-1 scale represents certainty level
 * - 0.1 = "barely credible hearsay"
 * - 0.5 = "plausible but unconfirmed"
 * - 0.9 = "very likely true but not yet verified"
 * - Enables probabilistic reasoning and risk assessment
 * 
 * CONTENT VS. STRUCTURE: What player thinks vs. system structure
 * - entityId/relationId: what the rumor is actually about (system)
 * - content: what the player believes the rumor says (narrative)
 * - This separation enables unreliable narrators and misunderstandings
 * 
 * RUMOR DYNAMICS: Can evolve over time
 * - New information can increase/decrease confidence
 * - Multiple sources can reinforce or contradict
 * - Eventually confirmed rumors become facts
 * - False rumors can be disproven and removed
 */
export interface PKGRumor {
  entityId: string;      // What entity this rumor is about
  relationId?: string;   // Optional: what relationship this rumor describes
  confidence: number;    // 0-1 scale: how confident is the player in this rumor?
  source: string;        // Who told them or how they heard it
  discoveredAt: string;  // ISO timestamp: when did they hear this rumor?
  content: string;       // What the rumor actually says (player's understanding)
}

/**
 * PLAYER KNOWLEDGE GRAPH: Complete model of what one character knows
 * 
 * SYSTEMS PURPOSE: Encapsulates entire epistemic state of a character
 * - All confirmed knowledge (facts)
 * - All uncertain knowledge (rumors)
 * - Metadata for versioning, timestamps, character info
 * 
 * KNOWLEDGE SEPARATION: Facts vs. Rumors enable different behaviors
 * - Facts used for confident decision making
 * - Rumors used for investigation planning
 * - UI can display differently ("You know" vs "You heard")
 * - Game logic can treat with different confidence levels
 * 
 * ARCHITECTURAL SCALING: One PKG per character/player
 * - Multiplayer: each player has separate PKG
 * - NPCs could have their own PKGs for AI decision making
 * - Enables realistic information asymmetry between characters
 * - Different characters can know different things about same world
 */
export interface PKG {
  discoveredFacts: PKGDiscoveredFact[];  // Things this character knows for certain
  rumors: PKGRumor[];                    // Things this character thinks they know
  metadata?: Record<string, any>;        // Version, timestamps, character info
}

// ============================================================================
// CORE PKG OPERATIONS
// ============================================================================
// These functions manage the lifecycle of player knowledge:
// Creation → Fact/Rumor Addition → Confidence Updates → Knowledge Evolution

/**
 * Creates a new empty PKG
 * 
 * SYSTEMS PURPOSE: Initialize knowledge state for new character/player
 * - Starting point for all knowledge acquisition
 * - Clean slate: no preconceptions or inherited knowledge
 * - Establishes consistent baseline for knowledge tracking
 * 
 * TABULA RASA PRINCIPLE: Characters start knowing nothing
 * - Realistic for new players entering unknown world
 * - Forces discovery through gameplay rather than exposition
 * - Creates natural learning curve and exploration incentives
 * 
 * METADATA INITIALIZATION: Version and timestamp tracking
 * - Version enables PKG schema evolution over time
 * - createdAt: when this character first entered the world
 * - lastModified: when they last learned something new
 * - Could be extended: characterId, personality traits, learning preferences
 * 
 * IMMUTABILITY FOUNDATION: Returns complete, valid object
 * - Empty arrays rather than null (prevents null pointer errors)
 * - All PKG operations expect this structure to exist
 * - Functional programming: always return valid, complete state
 */
export function createEmptyPKG(): PKG {
  return {
    discoveredFacts: [],
    rumors: [],
    metadata: {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString()
    }
  };
}

/**
 * Creates a new PKG with the given facts and rumors
 * 
 * SYSTEMS PURPOSE: Bulk knowledge initialization
 * - Loading saved character knowledge from storage
 * - Creating NPCs with pre-existing knowledge
 * - Testing scenarios with specific knowledge states
 * - Importing knowledge from external sources
 * 
 * COMPOSITION PATTERN: Built from atomic operations
 * - Leverages addFacts() and addRumors() for all validation
 * - Inherits duplicate detection and error handling
 * - Maintains consistency with single-addition functions
 * - Each operation maintains PKG invariants
 * 
 * KNOWLEDGE ORDERING: Facts first, then rumors
 * - Facts represent confirmed knowledge (higher priority)
 * - Rumors represent uncertain knowledge (lower priority)
 * - This ordering could affect confidence calculations
 * - Consistent ordering enables predictable behavior
 * 
 * ERROR HANDLING: Partial success model
 * - Invalid facts/rumors get filtered with warnings
 * - Valid knowledge still gets added successfully
 * - Result is best-effort knowledge state
 * - Better than all-or-nothing: some knowledge is better than none
 */
export function createPKG(facts: PKGDiscoveredFact[], rumors: PKGRumor[]): PKG {
  const pkg = createEmptyPKG();
  return addRumors(addFacts(pkg, facts), rumors);
}

// ============================================================================
// FACT OPERATIONS
// ============================================================================
// FACTS = Confirmed knowledge with 100% confidence
// These operations manage the "things I know for certain" part of player knowledge

/**
 * Adds a single discovered fact to the PKG
 * 
 * SYSTEMS PURPOSE: Core knowledge acquisition operation
 * - Player investigates rumor and confirms it as fact
 * - Direct observation provides immediate factual knowledge
 * - NPC explicitly tells player something they can trust
 * - Document reading provides authoritative information
 * 
 * KNOWLEDGE ELEVATION: Rumor → Investigation → Fact
 * - Represents successful completion of discovery process
 * - Player moves from "I think" to "I know"
 * - Creates satisfaction of confirmed hypothesis
 * - Enables confident decision making based on verified info
 * 
 * DUPLICATE PREVENTION: Facts are unique per entity/relation pair
 * - Same fact can't be "discovered" multiple times
 * - Prevents knowledge inflation and storage bloat
 * - isFactDiscovered() check maintains knowledge integrity
 * - Warning logged for debugging but system continues gracefully
 * 
 * IMMUTABILITY: Creates new PKG with added fact
 * - [...pkg.discoveredFacts, fact] creates new facts array
 * - updateMetadata updates lastModified timestamp
 * - Original PKG remains unchanged (enables undo/time-travel)
 * - Safe for concurrent access and functional programming
 * 
 * TEMPORAL TRACKING: Maintains knowledge timeline
 * - discoveredAt timestamp enables "when did I learn this?"
 * - lastModified enables "when was any knowledge updated?"
 * - Could support knowledge aging, recency effects
 * - Debugging aid: trace knowledge acquisition patterns
 */
export function addDiscoveredFact(pkg: PKG, fact: PKGDiscoveredFact): PKG {
  // Check if fact already exists
  if (isFactDiscovered(pkg, fact.entityId, fact.relationId)) {
    console.warn(`Fact for entity ${fact.entityId} already exists. Skipping addition.`);
    return pkg;
  }

  return {
    ...pkg,
    discoveredFacts: [...pkg.discoveredFacts, fact],
    metadata: {
      ...pkg.metadata,
      lastModified: new Date().toISOString()
    }
  };
}

/**
 * Adds multiple discovered facts to the PKG
 * 
 * SYSTEMS PURPOSE: Bulk knowledge acquisition
 * - Loading saved character knowledge from storage
 * - Processing multiple discoveries from single investigation
 * - Importing knowledge from external sources or other characters
 * - Quest completion revealing multiple related facts
 * 
 * FUNCTIONAL COMPOSITION: Built from single-fact operation
 * - reduce() pattern accumulates state changes through pure functions
 * - Each addDiscoveredFact() maintains all validation and integrity checks
 * - Inherits duplicate detection and error handling
 * - Consistent behavior with single-addition operations
 * 
 * PARTIAL SUCCESS MODEL: Some facts succeed even if others fail
 * - Invalid/duplicate facts get skipped with warnings
 * - Valid facts still get added successfully
 * - Result represents maximum possible knowledge acquisition
 * - Better than all-or-nothing: partial knowledge is useful
 * 
 * PERFORMANCE: O(n*m) where n=new facts, m=existing facts
 * - Each addition checks for duplicates against all existing facts
 * - Acceptable for game-scale knowledge (hundreds to thousands of facts)
 * - Could be optimized with Set<entityId-relationId> for large knowledge bases
 * - Prioritizes correctness over raw performance
 */
export function addFacts(pkg: PKG, facts: PKGDiscoveredFact[]): PKG {
  return facts.reduce((currentPKG, fact) => addDiscoveredFact(currentPKG, fact), pkg);
}

/**
 * Checks if a fact is already discovered
 * 
 * SYSTEMS PURPOSE: Knowledge existence queries and duplicate prevention
 * - Prevents duplicate fact storage (database uniqueness constraint)
 * - Enables UI logic: "show explore option" vs "show known info"
 * - Decision making: "do I need to investigate this?"
 * - Quest logic: "has player already learned this?"
 * 
 * KNOWLEDGE GRANULARITY: Supports both entity and relationship facts
 * - entityId only: "Do I know this tavern exists?"
 * - entityId + relationId: "Do I know this tavern is north of market?"
 * - Flexible model supports varying levels of knowledge detail
 * - Optional relationId enables both simple and complex fact checking
 * 
 * COMPOUND KEY MATCHING: Uses entity AND relation for uniqueness
 * - Same entity can have multiple facts about different relationships
 * - Example: know tavern exists + know tavern location + know tavern owner
 * - Each entity-relation pair represents distinct piece of knowledge
 * - Enables fine-grained knowledge tracking without conflicts
 * 
 * PERFORMANCE: O(n) linear search through facts
 * - some() stops at first match (efficient for positive cases)
 * - Acceptable for game-scale fact counts
 * - Could be optimized with Map<key, boolean> for large knowledge bases
 * - Simple implementation prioritizes code clarity
 */
export function isFactDiscovered(pkg: PKG, entityId: string, relationId?: string): boolean {
  return pkg.discoveredFacts.some(fact => 
    fact.entityId === entityId && fact.relationId === relationId
  );
}

/**
 * Gets all discovered facts for an entity
 * 
 * SYSTEMS PURPOSE: Entity-centric knowledge queries
 * - UI: "Show everything I know about this tavern"
 * - Decision making: "What do I know about this location before entering?"
 * - Quest logic: "Has player learned enough about this character?"
 * - Knowledge summarization: compile all known info about entity
 * 
 * RELATIONSHIP AGGREGATION: Returns all facts regardless of relationship type
 * - Might know: entity exists + location + owner + reputation + history
 * - Each fact represents different aspect of entity knowledge
 * - Enables comprehensive entity understanding
 * - Could be further filtered by relationship type if needed
 * 
 * TEMPORAL ORDERING: Facts returned in discovery order
 * - filter() preserves original array order
 * - discoveredAt timestamps enable chronological sorting
 * - Could show knowledge acquisition timeline
 * - "I learned X first, then Y, then Z about this place"
 * 
 * PERFORMANCE: O(n) where n = total facts in PKG
 * - filter() must check every fact for entityId match
 * - Returns new array (safe for iteration/modification)
 * - Could be optimized with Map<entityId, facts[]> index
 * - Acceptable performance for typical game knowledge scales
 */
export function getFactsForEntity(pkg: PKG, entityId: string): PKGDiscoveredFact[] {
  return pkg.discoveredFacts.filter(fact => fact.entityId === entityId);
}

/**
 * Gets all discovered facts for a relation
 */
export function getFactsForRelation(pkg: PKG, relationId: string): PKGDiscoveredFact[] {
  return pkg.discoveredFacts.filter(fact => fact.relationId === relationId);
}

/**
 * Removes a discovered fact from the PKG
 * Returns a new PKG with the fact removed
 */
export function removeDiscoveredFact(pkg: PKG, entityId: string, relationId?: string): PKG {
  const filteredFacts = pkg.discoveredFacts.filter(fact => 
    !(fact.entityId === entityId && fact.relationId === relationId)
  );

  return {
    ...pkg,
    discoveredFacts: filteredFacts,
    metadata: {
      ...pkg.metadata,
      lastModified: new Date().toISOString()
    }
  };
}

// ============================================================================
// RUMOR OPERATIONS
// ============================================================================

/**
 * Adds a single rumor to the PKG
 * 
 * SYSTEMS PURPOSE: Core uncertain knowledge acquisition
 * - Player hears something but can't verify it immediately
 * - NPC mentions something unreliable or secondhand
 * - Personality system generates speculation from partial observation
 * - Creates investigation opportunities and narrative hooks
 * 
 * UNCERTAINTY MODELING: Rumors represent "might be true" knowledge
 * - Bridge between ignorance and confirmed knowledge
 * - Confidence level (0-1) represents how believable the rumor is
 * - Content field captures player's understanding of what was heard
 * - Source tracking enables reliability assessment
 * 
 * KNOWLEDGE PIPELINE: Rumor → Investigation → Fact
 * - Rumors create motivation for exploration and investigation
 * - Successful investigation upgrades rumor to confirmed fact
 * - Failed investigation might decrease confidence or remove rumor
 * - Natural gameplay loop: hear → wonder → investigate → know
 * 
 * DUPLICATE PREVENTION: One rumor per entity-relation pair
 * - Same rumor can't be "heard" multiple times
 * - Multiple sources reinforcing rumor should update confidence instead
 * - Maintains clean knowledge state without redundancy
 * - Warning logged for debugging but system continues gracefully
 * 
 * CONFIDENCE DYNAMICS: Rumors can evolve over time
 * - New information can increase/decrease confidence
 * - Multiple sources can provide conflicting information
 * - High-confidence rumors (0.9+) become investigation priorities
 * - Low-confidence rumors (0.1-) might be ignored or disproven
 */
export function addRumor(pkg: PKG, rumor: PKGRumor): PKG {
  // Check if rumor already exists for this entity/relation
  if (getRumorsForEntity(pkg, rumor.entityId).some(r => r.relationId === rumor.relationId)) {
    console.warn(`Rumor for entity ${rumor.entityId} already exists. Skipping addition.`);
    return pkg;
  }

  return {
    ...pkg,
    rumors: [...pkg.rumors, rumor],
    metadata: {
      ...pkg.metadata,
      lastModified: new Date().toISOString()
    }
  };
}

/**
 * Adds multiple rumors to the PKG
 * Returns a new PKG with all rumors added
 */
export function addRumors(pkg: PKG, rumors: PKGRumor[]): PKG {
  return rumors.reduce((currentPKG, rumor) => addRumor(currentPKG, rumor), pkg);
}

/**
 * Gets all rumors for an entity
 */
export function getRumorsForEntity(pkg: PKG, entityId: string): PKGRumor[] {
  return pkg.rumors.filter(rumor => rumor.entityId === entityId);
}

/**
 * Gets all rumors for a relation
 */
export function getRumorsForRelation(pkg: PKG, relationId: string): PKGRumor[] {
  return pkg.rumors.filter(rumor => rumor.relationId === relationId);
}

/**
 * Updates rumor confidence based on new information
 * 
 * SYSTEMS PURPOSE: Dynamic knowledge evolution
 * - Multiple sources reinforce or contradict existing rumors
 * - Partial investigation provides more confidence without full confirmation
 * - Personality traits affect how new information changes confidence
 * - Enables realistic knowledge building through incremental evidence
 * 
 * CONFIDENCE MECHANICS: 0-1 scale with clamping
 * - 0.0 = "completely disbelieve this rumor"
 * - 0.5 = "unsure, could go either way"
 * - 1.0 = "very confident this rumor is true"
 * - Math.max(0, Math.min(1, value)) ensures valid range
 * - Could trigger automatic fact promotion at high confidence (0.95+)
 * 
 * KNOWLEDGE REINFORCEMENT: Multiple sources affect confidence
 * - Same rumor from trusted source: increase confidence
 * - Contradictory information: decrease confidence
 * - Partial evidence: moderate confidence adjustment
 * - Could implement source reliability weighting
 * 
 * RUMOR LIFECYCLE: Confidence changes drive state transitions
 * - Very high confidence (0.9+) suggests ready for fact promotion
 * - Very low confidence (0.1-) suggests rumor should be discarded
 * - Medium confidence maintains rumor state pending more evidence
 * - Natural progression from speculation to knowledge
 * 
 * IMMUTABILITY: Creates new rumor objects with updated confidence
 * - map() creates new rumors array with modified rumor
 * - Original rumor object replaced with updated version
 * - Other rumors remain unchanged (surgical update)
 * - Preserves referential integrity and functional programming principles
 */
export function updateRumorConfidence(
  pkg: PKG, 
  entityId: string, 
  relationId: string | undefined,
  newConfidence: number
): PKG {
  const updatedRumors = pkg.rumors.map(rumor => {
    if (rumor.entityId === entityId && rumor.relationId === relationId) {
      return {
        ...rumor,
        confidence: Math.max(0, Math.min(1, newConfidence))
      };
    }
    return rumor;
  });

  return {
    ...pkg,
    rumors: updatedRumors,
    metadata: {
      ...pkg.metadata,
      lastModified: new Date().toISOString()
    }
  };
}

/**
 * Removes a rumor from the PKG
 * Returns a new PKG with the rumor removed
 */
export function removeRumor(pkg: PKG, entityId: string, relationId?: string): PKG {
  const filteredRumors = pkg.rumors.filter(rumor => 
    !(rumor.entityId === entityId && rumor.relationId === relationId)
  );

  return {
    ...pkg,
    rumors: filteredRumors,
    metadata: {
      ...pkg.metadata,
      lastModified: new Date().toISOString()
    }
  };
}

// ============================================================================
// QUERY OPERATIONS
// ============================================================================

/**
 * Checks if an entity is discovered (has facts or rumors)
 */
export function isEntityDiscovered(pkg: PKG, entityId: string): boolean {
  return isFactDiscovered(pkg, entityId) || getRumorsForEntity(pkg, entityId).length > 0;
}

/**
 * Checks if a relation is discovered (has facts or rumors)
 */
export function isRelationDiscovered(pkg: PKG, relationId: string): boolean {
  return getFactsForRelation(pkg, relationId).length > 0 || getRumorsForRelation(pkg, relationId).length > 0;
}

/**
 * Gets all discovered entities (entities with facts or rumors)
 */
export function getDiscoveredEntities(pkg: PKG): string[] {
  const factEntities = pkg.discoveredFacts.map(fact => fact.entityId);
  const rumorEntities = pkg.rumors.map(rumor => rumor.entityId);
  return [...new Set([...factEntities, ...rumorEntities])];
}

/**
 * Gets all discovered relations (relations with facts or rumors)
 */
export function getDiscoveredRelations(pkg: PKG): string[] {
  const factRelations = pkg.discoveredFacts
    .map(fact => fact.relationId)
    .filter((id): id is string => id !== undefined);
  const rumorRelations = pkg.rumors
    .map(rumor => rumor.relationId)
    .filter((id): id is string => id !== undefined);
  return [...new Set([...factRelations, ...rumorRelations])];
}

/**
 * Gets knowledge level for an entity (0 = unknown, 1 = fully known)
 */
export function getEntityKnowledgeLevel(pkg: PKG, entityId: string): number {
  const facts = getFactsForEntity(pkg, entityId);
  const rumors = getRumorsForEntity(pkg, entityId);
  
  if (facts.length > 0) {
    return 1.0; // Has facts = fully known
  } else if (rumors.length > 0) {
    // Average confidence of rumors
    const avgConfidence = rumors.reduce((sum, rumor) => sum + rumor.confidence, 0) / rumors.length;
    return avgConfidence;
  }
  
  return 0.0; // Unknown
}

// ============================================================================
// VALIDATION OPERATIONS
// ============================================================================

/**
 * Validates the entire PKG for consistency
 * Returns validation result with any errors found
 */
export function validatePKG(pkg: PKG): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for duplicate facts
  const factKeys = pkg.discoveredFacts.map(fact => `${fact.entityId}-${fact.relationId || 'none'}`);
  const duplicateFactKeys = factKeys.filter((key, index) => factKeys.indexOf(key) !== index);
  if (duplicateFactKeys.length > 0) {
    errors.push(`Duplicate facts found: ${duplicateFactKeys.join(', ')}`);
  }

  // Check for duplicate rumors
  const rumorKeys = pkg.rumors.map(rumor => `${rumor.entityId}-${rumor.relationId || 'none'}`);
  const duplicateRumorKeys = rumorKeys.filter((key, index) => rumorKeys.indexOf(key) !== index);
  if (duplicateRumorKeys.length > 0) {
    errors.push(`Duplicate rumors found: ${duplicateRumorKeys.join(', ')}`);
  }

  // Check for invalid confidence values
  const invalidConfidence = pkg.rumors.filter(rumor => rumor.confidence < 0 || rumor.confidence > 1);
  if (invalidConfidence.length > 0) {
    errors.push(`Invalid confidence values found: ${invalidConfidence.map(r => r.confidence).join(', ')}`);
  }

  // Check for invalid timestamps
  const invalidTimestamps = [...pkg.discoveredFacts, ...pkg.rumors].filter(item => {
    const date = new Date(item.discoveredAt);
    return isNaN(date.getTime());
  });
  if (invalidTimestamps.length > 0) {
    errors.push(`Invalid timestamps found: ${invalidTimestamps.length} items`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// ============================================================================
// UTILITY OPERATIONS
// ============================================================================

/**
 * Gets statistics about the PKG
 */
export function getPKGStats(pkg: PKG): {
  factCount: number;
  rumorCount: number;
  discoveredEntityCount: number;
  discoveredRelationCount: number;
  averageRumorConfidence: number;
} {
  const discoveredEntities = getDiscoveredEntities(pkg);
  const discoveredRelations = getDiscoveredRelations(pkg);
  
  const averageRumorConfidence = pkg.rumors.length > 0 
    ? pkg.rumors.reduce((sum, rumor) => sum + rumor.confidence, 0) / pkg.rumors.length
    : 0;

  return {
    factCount: pkg.discoveredFacts.length,
    rumorCount: pkg.rumors.length,
    discoveredEntityCount: discoveredEntities.length,
    discoveredRelationCount: discoveredRelations.length,
    averageRumorConfidence
  };
}

/**
 * Creates a deep copy of the PKG
 */
export function clonePKG(pkg: PKG): PKG {
  return {
    discoveredFacts: [...pkg.discoveredFacts],
    rumors: [...pkg.rumors],
    metadata: pkg.metadata ? { ...pkg.metadata } : undefined
  };
}

/**
 * Checks if two PKGs are equal (deep comparison)
 */
export function arePKGsEqual(pkg1: PKG, pkg2: PKG): boolean {
  if (pkg1.discoveredFacts.length !== pkg2.discoveredFacts.length) return false;
  if (pkg1.rumors.length !== pkg2.rumors.length) return false;

  // Compare facts
  for (const fact1 of pkg1.discoveredFacts) {
    const fact2 = pkg2.discoveredFacts.find(f => 
      f.entityId === fact1.entityId && f.relationId === fact1.relationId
    );
    if (!fact2 || JSON.stringify(fact1) !== JSON.stringify(fact2)) {
      return false;
    }
  }

  // Compare rumors
  for (const rumor1 of pkg1.rumors) {
    const rumor2 = pkg2.rumors.find(r => 
      r.entityId === rumor1.entityId && r.relationId === rumor1.relationId
    );
    if (!rumor2 || JSON.stringify(rumor1) !== JSON.stringify(rumor2)) {
      return false;
    }
  }

  return true;
} 