// PKGPersonality.ts - Integrated PKG and Personality system
// Handles rumor generation, discovery logic, and GTWG projection

import { PKG, PKGDiscoveredFact, PKGRumor, addDiscoveredFact, addRumor, getRumorsForEntity, updateRumorConfidence } from './PKG';
import { Personality, calculatePersonalityEffects, calculateDiscoveryChance, generateRumorContent, calculateConfidenceChange } from './Personality';
import { GTWG, GTWGEntity, GTWGRelation } from '../types/GTWGTypes.js';

export type ProjectionLevel = 'immediate' | 'known' | 'strategic';

export interface FilteredGTWG {
  entities: GTWGEntity[];
  relations: GTWGRelation[];
  facts: PKGDiscoveredFact[];
  rumors: PKGRumor[];
  metadata?: Record<string, any>;
}

// ============================================================================
// RUMOR GENERATION
// ============================================================================

/**
 * Generates a rumor from NPC interaction based on personality
 */
export function generateRumorFromNPCInteraction(
  npcInfo: string,
  entityId: string,
  personality: Personality,
  source: string
): PKGRumor | null {
  const effects = calculatePersonalityEffects(personality);
  
  // Check if personality would generate a rumor
  if (Math.random() > effects.rumorGenerationRate) {
    return null; // No rumor generated
  }
  
  const content = generateRumorContent(npcInfo, personality);
  
  return {
    entityId,
    confidence: effects.rumorConfidence,
    source,
    discoveredAt: new Date().toISOString(),
    content
  };
}

/**
 * Generates a rumor from partial information based on personality
 */
export function generateRumorFromPartialInfo(
  partialInfo: string,
  entityId: string,
  personality: Personality,
  source: string
): PKGRumor | null {
  const effects = calculatePersonalityEffects(personality);
  
  // Check if personality would generate a rumor
  if (Math.random() > effects.rumorGenerationRate) {
    return null; // No rumor generated
  }
  
  const content = generateRumorContent(partialInfo, personality);
  
  return {
    entityId,
    confidence: effects.rumorConfidence,
    source,
    discoveredAt: new Date().toISOString(),
    content
  };
}

/**
 * Updates rumor confidence based on new information and personality
 */
export function updateRumorConfidenceWithPersonality(
  pkg: PKG,
  entityId: string,
  relationId: string | undefined,
  newInfo: string,
  personality: Personality
): PKG {
  const rumors = getRumorsForEntity(pkg, entityId);
  const targetRumor = rumors.find(r => r.relationId === relationId);
  
  if (!targetRumor) {
    return pkg; // No rumor to update
  }
  
  const confidenceChange = calculateConfidenceChange(personality, newInfo, targetRumor.confidence);
  const newConfidence = Math.max(0, Math.min(1, targetRumor.confidence + confidenceChange));
  
  return updateRumorConfidence(pkg, entityId, relationId, newConfidence);
}

// ============================================================================
// DISCOVERY LOGIC
// ============================================================================

/**
 * Determines if protagonist discovers something based on personality and context
 */
export function shouldDiscoverEntity(
  entityId: string,
  context: string,
  personality: Personality
): boolean {
  const discoveryChance = calculateDiscoveryChance(personality, context);
  return Math.random() < discoveryChance;
}

/**
 * Adds discovered fact to PKG with personality-based confidence
 */
export function addDiscoveredFactWithPersonality(
  pkg: PKG,
  entityId: string,
  relationId: string | undefined,
  source: string,
  personality: Personality
): PKG {
  const effects = calculatePersonalityEffects(personality);
  
  const fact: PKGDiscoveredFact = {
    entityId,
    relationId,
    discoveredAt: new Date().toISOString(),
    source
  };
  
  return addDiscoveredFact(pkg, fact);
}

/**
 * Processes discovery attempt with personality effects
 */
export function processDiscoveryAttempt(
  pkg: PKG,
  entityId: string,
  context: string,
  personality: Personality,
  source: string
): { pkg: PKG; discovered: boolean; rumorGenerated: boolean } {
  const shouldDiscover = shouldDiscoverEntity(entityId, context, personality);
  let rumorGenerated = false;
  
  if (shouldDiscover) {
    // Add as fact
    pkg = addDiscoveredFactWithPersonality(pkg, entityId, undefined, source, personality);
  } else {
    // Maybe generate rumor instead
    const rumor = generateRumorFromPartialInfo(
      `information about ${entityId}`,
      entityId,
      personality,
      source
    );
    
    if (rumor) {
      pkg = addRumor(pkg, rumor);
      rumorGenerated = true;
    }
  }
  
  return { pkg, discovered: shouldDiscover, rumorGenerated };
}

// ============================================================================
// GTWG PROJECTION
// ============================================================================

/**
 * Filters GTWG to PKG based on projection level and personality
 * Uses scalable single function with projection level parameter
 */
export function filterGTWGForPKG(
  gtwg: GTWG,
  pkg: PKG,
  personality: Personality,
  projectionLevel: ProjectionLevel
): FilteredGTWG {
  const effects = calculatePersonalityEffects(personality);
  
  switch (projectionLevel) {
    case 'immediate':
      return filterForImmediate(gtwg, pkg, effects);
    case 'known':
      return filterForKnown(gtwg, pkg, effects);
    case 'strategic':
      return filterForStrategic(gtwg, pkg, effects);
    default:
      return filterForKnown(gtwg, pkg, effects); // Default to known
  }
}

/**
 * Projects only what protagonist can see right now
 */
function filterForImmediate(
  gtwg: GTWG,
  pkg: PKG,
  effects: any
): FilteredGTWG {
  // For immediate projection, only show entities that are:
  // 1. Already discovered as facts
  // 2. In the protagonist's current location
  // 3. Obvious or clearly visible
  
  const discoveredEntityIds = pkg.discoveredFacts.map(fact => fact.entityId);
  const discoveredRelationIds = pkg.discoveredFacts
    .map(fact => fact.relationId)
    .filter((id): id is string => id !== undefined);
  
  const entities = gtwg.entities.filter(entity => 
    discoveredEntityIds.includes(entity.id)
  );
  
  const relations = gtwg.relations.filter(relation => 
    discoveredRelationIds.includes(relation.id) ||
    (discoveredEntityIds.includes(relation.from) && discoveredEntityIds.includes(relation.to))
  );
  
  return {
    entities,
    relations,
    facts: pkg.discoveredFacts,
    rumors: [], // No rumors in immediate view
    metadata: {
      projectionLevel: 'immediate',
      personalityEffects: effects
    }
  };
}

/**
 * Projects all discovered facts and rumors
 */
function filterForKnown(
  gtwg: GTWG,
  pkg: PKG,
  effects: any
): FilteredGTWG {
  // For known projection, show:
  // 1. All discovered facts
  // 2. All rumors (but don't distinguish fact vs rumor to player)
  // 3. Related entities that protagonist might know about
  
  const discoveredEntityIds = pkg.discoveredFacts.map(fact => fact.entityId);
  const rumorEntityIds = pkg.rumors.map(rumor => rumor.entityId);
  const allKnownEntityIds = [...new Set([...discoveredEntityIds, ...rumorEntityIds])];
  
  // Get entities that are discovered or have rumors
  const entities = gtwg.entities.filter(entity => 
    allKnownEntityIds.includes(entity.id)
  );
  
  // Get relations involving known entities
  const relations = gtwg.relations.filter(relation => 
    allKnownEntityIds.includes(relation.from) || allKnownEntityIds.includes(relation.to)
  );
  
  return {
    entities,
    relations,
    facts: pkg.discoveredFacts,
    rumors: pkg.rumors,
    metadata: {
      projectionLevel: 'known',
      personalityEffects: effects
    }
  };
}

/**
 * Projects high-level context for GM planning
 */
function filterForStrategic(
  gtwg: GTWG,
  pkg: PKG,
  effects: any
): FilteredGTWG {
  // For strategic projection, show:
  // 1. All discovered facts and rumors
  // 2. High-level world context (regions, major factions, etc.)
  // 3. Quest-related entities
  // 4. Important NPCs and locations
  
  const discoveredEntityIds = pkg.discoveredFacts.map(fact => fact.entityId);
  const rumorEntityIds = pkg.rumors.map(rumor => rumor.entityId);
  const allKnownEntityIds = [...new Set([...discoveredEntityIds, ...rumorEntityIds])];
  
  // Get all entities that are:
  // - Discovered by protagonist
  // - Important for world context (regions, major factions, etc.)
  // - Quest-related
  const entities = gtwg.entities.filter(entity => 
    allKnownEntityIds.includes(entity.id) ||
    entity.type === 'region' ||
    entity.type === 'faction' ||
    entity.type === 'quest' ||
    (entity.type === 'character' && entity.properties?.characterType === 'npc') ||
    (entity.type === 'location' && entity.properties?.locationType === 'landmark')
  );
  
  // Get relations involving strategic entities
  const strategicEntityIds = entities.map(entity => entity.id);
  const relations = gtwg.relations.filter(relation => 
    strategicEntityIds.includes(relation.from) || strategicEntityIds.includes(relation.to)
  );
  
  return {
    entities,
    relations,
    facts: pkg.discoveredFacts,
    rumors: pkg.rumors,
    metadata: {
      projectionLevel: 'strategic',
      personalityEffects: effects
    }
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Gets projection statistics for debugging
 */
export function getProjectionStats(
  gtwg: GTWG,
  pkg: PKG,
  personality: Personality
): {
  immediate: { entityCount: number; relationCount: number };
  known: { entityCount: number; relationCount: number };
  strategic: { entityCount: number; relationCount: number };
} {
  const immediate = filterGTWGForPKG(gtwg, pkg, personality, 'immediate');
  const known = filterGTWGForPKG(gtwg, pkg, personality, 'known');
  const strategic = filterGTWGForPKG(gtwg, pkg, personality, 'strategic');
  
  return {
    immediate: { entityCount: immediate.entities.length, relationCount: immediate.relations.length },
    known: { entityCount: known.entities.length, relationCount: known.relations.length },
    strategic: { entityCount: strategic.entities.length, relationCount: strategic.relations.length }
  };
}

/**
 * Checks if protagonist has any knowledge about an entity
 */
export function hasAnyKnowledge(pkg: PKG, entityId: string): boolean {
  const facts = pkg.discoveredFacts.filter(fact => fact.entityId === entityId);
  const rumors = pkg.rumors.filter(rumor => rumor.entityId === entityId);
  
  return facts.length > 0 || rumors.length > 0;
}

/**
 * Gets all knowledge about an entity (facts and rumors combined)
 */
export function getEntityKnowledge(pkg: PKG, entityId: string): {
  facts: PKGDiscoveredFact[];
  rumors: PKGRumor[];
  hasFacts: boolean;
  hasRumors: boolean;
  knowledgeLevel: number;
} {
  const facts = pkg.discoveredFacts.filter(fact => fact.entityId === entityId);
  const rumors = pkg.rumors.filter(rumor => rumor.entityId === entityId);
  
  let knowledgeLevel = 0;
  if (facts.length > 0) {
    knowledgeLevel = 1.0; // Has facts = fully known
  } else if (rumors.length > 0) {
    // Average confidence of rumors
    const avgConfidence = rumors.reduce((sum, rumor) => sum + rumor.confidence, 0) / rumors.length;
    knowledgeLevel = avgConfidence;
  }
  
  return {
    facts,
    rumors,
    hasFacts: facts.length > 0,
    hasRumors: rumors.length > 0,
    knowledgeLevel
  };
} 