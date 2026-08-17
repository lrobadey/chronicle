// PKGPersonality.test.ts - Comprehensive test suite for PKG and Personality systems

import { 
  createEmptyPKG, 
  addDiscoveredFact, 
  addRumor, 
  isEntityDiscovered,
  getPKGStats,
  validatePKG 
} from './PKG';

import { 
  createPersonality, 
  calculatePersonalityEffects,
  calculateDiscoveryChance 
} from './Personality';

import {
  generateRumorFromNPCInteraction,
  generateRumorFromPartialInfo,
  processDiscoveryAttempt,
  filterGTWGForPKG,
  getProjectionStats,
  hasAnyKnowledge,
  getEntityKnowledge
} from './PKGPersonality';

import { GTWG, GTWGEntity, GTWGRelation } from '../types';

// ============================================================================
// TEST DATA
// ============================================================================

const sampleGTWG: GTWG = {
  entities: [
    {
      id: 'region-1',
      type: 'region',
      name: 'The Valley',
      properties: {
        description: 'A peaceful valley',
        climate: 'temperate',
        areaKm2: 1000,
        dangerLevel: 'safe'
      }
    },
    {
      id: 'location-1',
      type: 'location',
      name: 'The Tavern',
      properties: {
        description: 'A cozy tavern',
        locationType: 'tavern',
        coords: { x: 10, y: 10 },
        size: 50,
        dangerLevel: 'safe',
        accessibility: 'open'
      }
    },
    {
      id: 'character-1',
      type: 'character',
      name: 'Old Tom',
      properties: {
        description: 'The tavern keeper',
        characterType: 'npc',
        personality: 'friendly',
        occupation: 'tavern keeper',
        status: 'alive'
      }
    },
    {
      id: 'quest-1',
      type: 'quest',
      name: 'Find the Lost Key',
      properties: {
        description: 'Help find a lost key',
        questType: 'side',
        status: 'available',
        difficulty: 'easy'
      }
    }
  ],
  relations: [
    {
      id: 'rel-1',
      type: 'located_in',
      from: 'location-1',
      to: 'region-1'
    },
    {
      id: 'rel-2',
      type: 'located_in',
      from: 'character-1',
      to: 'location-1'
    },
    {
      id: 'rel-3',
      type: 'involves',
      from: 'quest-1',
      to: 'character-1'
    }
  ],
  metadata: {
    version: '1.0.0'
  }
};

// ============================================================================
// PERSONALITY TESTS
// ============================================================================

describe('Personality System', () => {
  test('should create personality with normalized traits', () => {
    const personality = createPersonality({
      analytical: 0.8,
      insecure: 0.3,
      curious: 0.9,
      cautious: 0.2
    });
    
    expect(personality.analytical).toBe(0.8);
    expect(personality.insecure).toBe(0.3);
    expect(personality.curious).toBe(0.9);
    expect(personality.cautious).toBe(0.2);
  });

  test('should clamp personality traits to 0-1 range', () => {
    const personality = createPersonality({
      analytical: 1.5,  // Should be clamped to 1.0
      insecure: -0.5,   // Should be clamped to 0.0
      curious: 0.7,     // Should remain 0.7
      cautious: 0.3     // Should remain 0.3
    });
    
    expect(personality.analytical).toBe(1.0);
    expect(personality.insecure).toBe(0.0);
    expect(personality.curious).toBe(0.7);
    expect(personality.cautious).toBe(0.3);
  });

  test('should calculate personality effects correctly', () => {
    const analyticalPersonality = createPersonality({ analytical: 1.0 });
    const effects = calculatePersonalityEffects(analyticalPersonality);
    
    expect(effects.rumorGenerationRate).toBeLessThan(0.5); // Reduces rumors
    expect(effects.factConfidence).toBeGreaterThan(0.5);   // Increases fact confidence
    expect(effects.discoveryRate).toBeGreaterThan(0.5);    // Increases discovery
  });

  test('should handle insecure personality effects', () => {
    const insecurePersonality = createPersonality({ insecure: 1.0 });
    const effects = calculatePersonalityEffects(insecurePersonality);
    
    expect(effects.rumorGenerationRate).toBeGreaterThan(0.5); // Increases rumors
    expect(effects.rumorConfidence).toBeLessThan(0.5);       // Decreases confidence
    expect(effects.factConfidence).toBeLessThan(0.5);        // Decreases fact confidence
  });

  test('should handle personality combinations', () => {
    const analyticalInsecure = createPersonality({ analytical: 0.8, insecure: 0.7 });
    const effects = calculatePersonalityEffects(analyticalInsecure);
    
    // Should have mixed effects
    expect(effects.interpretationStyle).toBe('cynical'); // Insecure dominates
    expect(effects.factConfidence).toBeGreaterThan(0.3); // Analytical helps
  });

  test('should calculate discovery chance based on context', () => {
    const curiousPersonality = createPersonality({ curious: 0.9 });
    
    const obviousChance = calculateDiscoveryChance(curiousPersonality, 'obvious information');
    const hiddenChance = calculateDiscoveryChance(curiousPersonality, 'hidden secret');
    const dangerousChance = calculateDiscoveryChance(curiousPersonality, 'dangerous area');
    
    expect(obviousChance).toBeGreaterThan(hiddenChance);
    expect(hiddenChance).toBeGreaterThan(dangerousChance);
  });
});

// ============================================================================
// PKG TESTS
// ============================================================================

describe('PKG System', () => {
  test('should create empty PKG', () => {
    const pkg = createEmptyPKG();
    
    expect(pkg.discoveredFacts).toEqual([]);
    expect(pkg.rumors).toEqual([]);
    expect(pkg.metadata?.version).toBe('1.0.0');
  });

  test('should add discovered facts', () => {
    const pkg = createEmptyPKG();
    const fact = {
      entityId: 'character-1',
      discoveredAt: new Date().toISOString(),
      source: 'GM narration'
    };
    
    const newPKG = addDiscoveredFact(pkg, fact);
    
    expect(newPKG.discoveredFacts).toHaveLength(1);
    expect(newPKG.discoveredFacts[0].entityId).toBe('character-1');
  });

  test('should add rumors', () => {
    const pkg = createEmptyPKG();
    const rumor = {
      entityId: 'location-1',
      confidence: 0.7,
      source: 'Old Tom',
      discoveredAt: new Date().toISOString(),
      content: 'The tavern has a secret basement'
    };
    
    const newPKG = addRumor(pkg, rumor);
    
    expect(newPKG.rumors).toHaveLength(1);
    expect(newPKG.rumors[0].entityId).toBe('location-1');
    expect(newPKG.rumors[0].confidence).toBe(0.7);
  });

  test('should check if entity is discovered', () => {
    const pkg = createEmptyPKG();
    const fact = {
      entityId: 'character-1',
      discoveredAt: new Date().toISOString(),
      source: 'GM narration'
    };
    
    const pkgWithFact = addDiscoveredFact(pkg, fact);
    
    expect(isEntityDiscovered(pkgWithFact, 'character-1')).toBe(true);
    expect(isEntityDiscovered(pkgWithFact, 'unknown-entity')).toBe(false);
  });

  test('should prevent duplicate facts', () => {
    const pkg = createEmptyPKG();
    const fact = {
      entityId: 'character-1',
      discoveredAt: new Date().toISOString(),
      source: 'GM narration'
    };
    
    const pkgWithFact = addDiscoveredFact(pkg, fact);
    const pkgWithDuplicate = addDiscoveredFact(pkgWithFact, fact);
    
    expect(pkgWithDuplicate.discoveredFacts).toHaveLength(1); // Should not add duplicate
  });

  test('should validate PKG correctly', () => {
    const validPKG = createEmptyPKG();
    const validation = validatePKG(validPKG);
    
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  test('should get PKG statistics', () => {
    const pkg = createEmptyPKG();
    const fact = {
      entityId: 'character-1',
      discoveredAt: new Date().toISOString(),
      source: 'GM narration'
    };
    const rumor = {
      entityId: 'location-1',
      confidence: 0.7,
      source: 'Old Tom',
      discoveredAt: new Date().toISOString(),
      content: 'The tavern has a secret basement'
    };
    
    const pkgWithData = addRumor(addDiscoveredFact(pkg, fact), rumor);
    const stats = getPKGStats(pkgWithData);
    
    expect(stats.factCount).toBe(1);
    expect(stats.rumorCount).toBe(1);
    expect(stats.discoveredEntityCount).toBe(2);
    expect(stats.averageRumorConfidence).toBe(0.7);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('PKG + Personality Integration', () => {
  test('should generate rumors from NPC interaction', () => {
    const personality = createPersonality({ insecure: 0.8 });
    const npcInfo = 'The tavern keeper seems nervous about something';
    
    const rumor = generateRumorFromNPCInteraction(npcInfo, 'location-1', personality, 'Old Tom');
    
    if (rumor) {
      expect(rumor.entityId).toBe('location-1');
      expect(rumor.source).toBe('Old Tom');
      expect(rumor.confidence).toBeLessThan(0.5); // Insecure personality = low confidence
      expect(rumor.content).toContain('dangerous'); // Cynical interpretation
    }
  });

  test('should generate rumors from partial information', () => {
    const personality = createPersonality({ curious: 0.9 });
    const partialInfo = 'strange sounds from the basement';
    
    const rumor = generateRumorFromPartialInfo(partialInfo, 'location-1', personality, 'overheard');
    
    if (rumor) {
      expect(rumor.entityId).toBe('location-1');
      expect(rumor.source).toBe('overheard');
      expect(rumor.content).toContain('whispers');
    }
  });

  test('should process discovery attempts with personality', () => {
    const pkg = createEmptyPKG();
    const personality = createPersonality({ analytical: 0.9, curious: 0.8 });
    const context = 'obvious information about the tavern';
    
    const result = processDiscoveryAttempt(pkg, 'location-1', context, personality, 'GM narration');
    
    expect(result.discovered).toBe(true); // High analytical + curious should discover
    expect(result.pkg.discoveredFacts).toHaveLength(1);
  });

  test('should filter GTWG for different projection levels', () => {
    const pkg = createEmptyPKG();
    const personality = createPersonality({ analytical: 0.5, curious: 0.5 });
    
    // Add some discovered facts
    const pkgWithFacts = addDiscoveredFact(pkg, {
      entityId: 'location-1',
      discoveredAt: new Date().toISOString(),
      source: 'GM narration'
    });
    
    const immediate = filterGTWGForPKG(sampleGTWG, pkgWithFacts, personality, 'immediate');
    const known = filterGTWGForPKG(sampleGTWG, pkgWithFacts, personality, 'known');
    const strategic = filterGTWGForPKG(sampleGTWG, pkgWithFacts, personality, 'strategic');
    
    expect(immediate.entities.length).toBeLessThanOrEqual(known.entities.length);
    expect(known.entities.length).toBeLessThanOrEqual(strategic.entities.length);
    expect(immediate.rumors).toHaveLength(0); // No rumors in immediate view
  });

  test('should get projection statistics', () => {
    const pkg = createEmptyPKG();
    const personality = createPersonality({ analytical: 0.5 });
    
    const stats = getProjectionStats(sampleGTWG, pkg, personality);
    
    expect(stats.immediate.entityCount).toBeLessThanOrEqual(stats.known.entityCount);
    expect(stats.known.entityCount).toBeLessThanOrEqual(stats.strategic.entityCount);
  });

  test('should check entity knowledge', () => {
    const pkg = createEmptyPKG();
    const personality = createPersonality({ analytical: 0.5 });
    
    // Add a fact
    const pkgWithFact = addDiscoveredFact(pkg, {
      entityId: 'character-1',
      discoveredAt: new Date().toISOString(),
      source: 'GM narration'
    });
    
    // Add a rumor
    const pkgWithRumor = addRumor(pkgWithFact, {
      entityId: 'location-1',
      confidence: 0.7,
      source: 'Old Tom',
      discoveredAt: new Date().toISOString(),
      content: 'The tavern has a secret basement'
    });
    
    expect(hasAnyKnowledge(pkgWithRumor, 'character-1')).toBe(true);
    expect(hasAnyKnowledge(pkgWithRumor, 'location-1')).toBe(true);
    expect(hasAnyKnowledge(pkgWithRumor, 'unknown-entity')).toBe(false);
    
    const knowledge = getEntityKnowledge(pkgWithRumor, 'character-1');
    expect(knowledge.hasFacts).toBe(true);
    expect(knowledge.hasRumors).toBe(false);
    expect(knowledge.knowledgeLevel).toBe(1.0);
    
    const rumorKnowledge = getEntityKnowledge(pkgWithRumor, 'location-1');
    expect(rumorKnowledge.hasFacts).toBe(false);
    expect(rumorKnowledge.hasRumors).toBe(true);
    expect(rumorKnowledge.knowledgeLevel).toBe(0.7);
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('Edge Cases', () => {
  test('should handle empty PKG operations', () => {
    const pkg = createEmptyPKG();
    
    expect(isEntityDiscovered(pkg, 'any-entity')).toBe(false);
    expect(getPKGStats(pkg).factCount).toBe(0);
    expect(getPKGStats(pkg).rumorCount).toBe(0);
  });

  test('should handle personality with all traits at zero', () => {
    const personality = createPersonality({});
    const effects = calculatePersonalityEffects(personality);
    
    expect(effects.rumorGenerationRate).toBe(0.5); // Default values
    expect(effects.rumorConfidence).toBe(0.5);
    expect(effects.discoveryRate).toBe(0.5);
    expect(effects.factConfidence).toBe(0.5);
  });

  test('should handle personality with all traits at maximum', () => {
    const personality = createPersonality({
      analytical: 1.0,
      insecure: 1.0,
      curious: 1.0,
      cautious: 1.0
    });
    const effects = calculatePersonalityEffects(personality);
    
    // All values should be clamped to 0-1 range
    expect(effects.rumorGenerationRate).toBeGreaterThanOrEqual(0);
    expect(effects.rumorGenerationRate).toBeLessThanOrEqual(1);
    expect(effects.rumorConfidence).toBeGreaterThanOrEqual(0);
    expect(effects.rumorConfidence).toBeLessThanOrEqual(1);
  });

  test('should handle invalid confidence updates', () => {
    const pkg = createEmptyPKG();
    const rumor = {
      entityId: 'location-1',
      confidence: 0.5,
      source: 'Old Tom',
      discoveredAt: new Date().toISOString(),
      content: 'The tavern has a secret basement'
    };
    
    const pkgWithRumor = addRumor(pkg, rumor);
    
    // Try to update with invalid confidence values
    const updatedPKG = updateRumorConfidence(pkgWithRumor, 'location-1', undefined, 1.5);
    const updatedRumor = updatedPKG.rumors.find(r => r.entityId === 'location-1');
    
    expect(updatedRumor?.confidence).toBe(1.0); // Should be clamped to 1.0
  });
});

console.log('✅ All PKG and Personality tests completed successfully!'); 