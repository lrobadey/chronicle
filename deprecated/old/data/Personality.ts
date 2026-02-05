// Personality.ts - Personality trait system for PKG rumor generation and discovery
// Normalized traits (0-1 scale) with overlapping effects

export interface Personality {
  analytical: number;  // 0-1 scale
  insecure: number;    // 0-1 scale
  curious: number;     // 0-1 scale
  cautious: number;    // 0-1 scale
}

export interface PersonalityEffects {
  rumorGenerationRate: number;    // 0-1 scale, how likely to generate rumors
  rumorConfidence: number;        // 0-1 scale, base confidence in rumors
  discoveryRate: number;          // 0-1 scale, how likely to discover facts
  factConfidence: number;         // 0-1 scale, confidence in discovered facts
  interpretationStyle: 'cynical' | 'optimistic' | 'neutral';
}

/**
 * Creates a personality with normalized traits (0-1 scale)
 */
export function createPersonality(traits: Partial<Personality>): Personality {
  return {
    analytical: Math.max(0, Math.min(1, traits.analytical || 0)),
    insecure: Math.max(0, Math.min(1, traits.insecure || 0)),
    curious: Math.max(0, Math.min(1, traits.curious || 0)),
    cautious: Math.max(0, Math.min(1, traits.cautious || 0))
  };
}

/**
 * Calculates personality effects based on trait combinations
 * Uses simple overlapping rules that combine naturally
 */
export function calculatePersonalityEffects(personality: Personality): PersonalityEffects {
  // Base rates
  let rumorGenerationRate = 0.5;  // Default 50% chance
  let rumorConfidence = 0.5;      // Default 50% confidence
  let discoveryRate = 0.5;         // Default 50% discovery rate
  let factConfidence = 0.5;       // Default 50% fact confidence
  
  // Analytical trait effects
  rumorGenerationRate -= personality.analytical * 0.3;  // Reduces rumors
  factConfidence += personality.analytical * 0.4;       // Increases fact confidence
  discoveryRate += personality.analytical * 0.2;        // Systematic discovery
  
  // Insecure trait effects
  rumorGenerationRate += personality.insecure * 0.4;    // Increases rumors
  rumorConfidence -= personality.insecure * 0.3;        // Decreases confidence
  factConfidence -= personality.insecure * 0.2;         // Decreases fact confidence
  
  // Curious trait effects
  discoveryRate += personality.curious * 0.3;           // Increases discovery
  rumorGenerationRate += personality.curious * 0.2;     // More investigation = more rumors
  
  // Cautious trait effects
  discoveryRate -= personality.cautious * 0.2;          // Decreases discovery
  factConfidence += personality.cautious * 0.3;         // Higher confidence in known facts
  rumorConfidence += personality.cautious * 0.1;        // Slightly higher rumor confidence
  
  // Clamp all values to 0-1 range
  rumorGenerationRate = Math.max(0, Math.min(1, rumorGenerationRate));
  rumorConfidence = Math.max(0, Math.min(1, rumorConfidence));
  discoveryRate = Math.max(0, Math.min(1, discoveryRate));
  factConfidence = Math.max(0, Math.min(1, factConfidence));
  
  // Determine interpretation style based on dominant traits
  let interpretationStyle: 'cynical' | 'optimistic' | 'neutral' = 'neutral';
  
  if (personality.insecure > 0.6) {
    interpretationStyle = 'cynical';
  } else if (personality.curious > 0.6 && personality.insecure < 0.3) {
    interpretationStyle = 'optimistic';
  }
  
  return {
    rumorGenerationRate,
    rumorConfidence,
    discoveryRate,
    factConfidence,
    interpretationStyle
  };
}

/**
 * Calculates discovery chance based on personality and context
 */
export function calculateDiscoveryChance(
  personality: Personality, 
  context: string
): number {
  const effects = calculatePersonalityEffects(personality);
  let baseChance = effects.discoveryRate;
  
  // Context modifiers
  if (context.includes('obvious') || context.includes('clear')) {
    baseChance += 0.2;
  }
  if (context.includes('hidden') || context.includes('secret')) {
    baseChance -= 0.3;
  }
  if (context.includes('dangerous') || context.includes('risky')) {
    baseChance -= personality.cautious * 0.4;
  }
  
  return Math.max(0, Math.min(1, baseChance));
}

/**
 * Generates rumor content based on personality interpretation style
 */
export function generateRumorContent(
  partialInfo: string, 
  personality: Personality
): string {
  const effects = calculatePersonalityEffects(personality);
  
  switch (effects.interpretationStyle) {
    case 'cynical':
      return `Rumors suggest ${partialInfo} might be more dangerous than it appears.`;
    case 'optimistic':
      return `Some say ${partialInfo} could be quite beneficial.`;
    default:
      return `There are whispers about ${partialInfo}, but details are unclear.`;
  }
}

/**
 * Calculates confidence change based on new information and personality
 */
export function calculateConfidenceChange(
  personality: Personality,
  newInfo: string,
  currentConfidence: number
): number {
  const effects = calculatePersonalityEffects(personality);
  
  // Base confidence change
  let change = 0.1;
  
  // Personality modifiers
  if (personality.analytical > 0.5) {
    change += 0.1; // Analytical people are more confident with new info
  }
  if (personality.insecure > 0.5) {
    change -= 0.1; // Insecure people are less confident with new info
  }
  if (personality.cautious > 0.5) {
    change += 0.05; // Cautious people are slightly more confident
  }
  
  // Information quality modifiers
  if (newInfo.includes('confirmed') || newInfo.includes('verified')) {
    change += 0.2;
  }
  if (newInfo.includes('rumor') || newInfo.includes('hearsay')) {
    change -= 0.1;
  }
  
  return Math.max(-0.5, Math.min(0.5, change)); // Limit change to ±50%
} 