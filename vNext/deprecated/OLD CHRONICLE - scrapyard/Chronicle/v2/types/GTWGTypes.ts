// GTWGTypes.ts - Pure V2 GTWG type definitions
// =============================================
// Self-contained V2 type definitions for complete architectural isolation

export type GTWGEntityType =
  | 'region'        // SIMPLIFIED: Everything is a region
  | 'character'
  | 'item'
  | 'quest'
  | 'faction'
  | 'event';

export interface GTWGEntity {
  id: string; // Unique identifier
  type: GTWGEntityType;
  name: string;
  properties?: Record<string, any>; // Flexible for future extension
}

export type GTWGRelationType =
  | 'contained_in'    // Regions can contain other regions
  | 'adjacent_to'
  | 'north_of' | 'south_of' | 'east_of' | 'west_of'  // Spatial directions
  | 'above' | 'below'                                 // Vertical relationships
  | 'inside' | 'outside'                              // Containment relationships
  | 'near' | 'far_from'                               // Distance relationships
  | 'trades_with'
  | 'allied_with'
  | 'at_war_with'
  | 'controls'
  | 'owns'
  | 'causes'
  | 'blocks'
  | 'involves'
  | 'related_to'
  | 'happened_before' | 'happened_after' | 'during' | 'overlaps'  // Temporal relationships
  | 'results_from';  // Causality

export interface GTWGRelation {
  id: string; // Unique identifier for the relation
  type: GTWGRelationType;
  from: string; // Entity ID
  to: string;   // Entity ID
  properties?: Record<string, any>;
}

export interface GTWG {
  entities: GTWGEntity[];
  relations: GTWGRelation[];
  // Optionally, metadata (e.g., version, seed)
  metadata?: Record<string, any>;
}

// Common region types for convenience and consistency
export type CommonRegionType = 
  | 'world' | 'continent' | 'kingdom' | 'province' | 'county' | 'city' | 'district' 
  | 'neighborhood' | 'street' | 'building' | 'room' | 'area' | 'zone' | 'landmark'
  | 'natural_feature' | 'structure' | 'object' | 'feature' | 'terrain' | 'water'
  | 'forest' | 'mountain' | 'desert' | 'swamp' | 'cave' | 'dungeon' | 'temple'
  | 'shop' | 'tavern' | 'inn' | 'castle' | 'tower' | 'gate' | 'bridge' | 'road'
  | 'field' | 'garden' | 'market' | 'square' | 'alley' | 'wall' | 'door' | 'window'
  | 'furniture' | 'container' | 'item_location';

export interface RegionEntity extends GTWGEntity {
  type: 'region';
  properties: {
    description: string;
    regionType: string; // DYNAMIC: Can be any string the LLM creates
    // Optional: Use common types for consistency when appropriate
    commonType?: CommonRegionType;
    
    tags?: string[]; // e.g., ["mountainous", "forested", "abandoned", "market"]
    
    // Spatial properties
    coords?: { x: number; y: number; z?: number }; // Optional for non-point regions
    size?: number | string; // Area in m² or descriptive ("small", "large")
    dimensions?: { width: number; height: number; depth?: number };
    areaKm2?: number; // For large regions
    
    // Environmental properties
    climate?: string; // e.g., "temperate", "arid", "tropical"
    biome?: string; // e.g., "forest", "mountain", "plains"
    weather?: string; // e.g., "rainy", "sunny", "stormy"
    
    // Gameplay properties
    dangerLevel?: 'safe' | 'wild' | 'hostile';
    accessibility?: 'open' | 'locked' | 'hidden' | 'guarded' | 'blocked';
    population?: number; // Number of people typically present
    importance?: number; // 0-10 scale for narrative significance
    
    // Economic properties
    wealth?: number; // 0-100 scale
    resources?: Record<string, number>; // e.g., { "gold": 1000, "food": 500 }
    
    // State properties (for interactive regions)
    state?: string; // e.g., "open", "closed", "lit", "unlit", "locked", "broken"
    
    // LLM-specific properties
    llmGenerated?: boolean; // Whether this region type was created by LLM
    context?: string; // Context for why this region type was created
    experience?: string; // What user experience led to this region type
    
    // Additional flexible properties
    [key: string]: any;
  };
}

export interface CharacterEntity extends GTWGEntity {
  type: 'character';
  properties: {
    description: string;
    characterType: 'npc' | 'player' | 'animal' | 'monster';
    personality?: string; // e.g., "friendly", "suspicious", "aggressive"
    occupation?: string; // e.g., "blacksmith", "merchant", "guard"
    status: 'alive' | 'dead' | 'unconscious' | 'missing';
    health?: number; // 0-100 scale
    skills?: Record<string, number>; // e.g., { "combat": 7, "diplomacy": 3 }
    inventory?: string[]; // Array of item IDs
    relationships?: Record<string, string>; // e.g., { "spouse": "character-2", "employer": "faction-1" }
    // Additional fields can be added as needed
  };
}

export interface ItemEntity extends GTWGEntity {
  type: 'item';
  properties: {
    description: string;
    itemType: 'weapon' | 'armor' | 'tool' | 'consumable' | 'treasure' | 'document' | 'key' | 'container';
    rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
    value?: number; // Monetary value
    weight?: number; // Weight in kg
    durability?: number; // 0-100 scale
    effects?: Record<string, any>; // e.g., { "damage": 5, "defense": 2 }
    owner?: string; // Character ID who owns this item
    location?: string; // Region ID where item is stored
    state?: string; // e.g., "broken", "enchanted", "cursed"
    // Additional fields can be added as needed
  };
}

export interface QuestEntity extends GTWGEntity {
  type: 'quest';
  properties: {
    description: string;
    questType: 'main' | 'side' | 'daily' | 'event';
    status: 'available' | 'active' | 'completed' | 'failed' | 'expired';
    difficulty: 'easy' | 'medium' | 'hard' | 'legendary';
    reward?: {
      experience?: number;
      items?: string[]; // Array of item IDs
      reputation?: Record<string, number>; // e.g., { "faction-1": 10 }
    };
    requirements?: {
      level?: number;
      skills?: Record<string, number>;
      items?: string[]; // Required items
      relationships?: Record<string, string>; // Required relationships
    };
    objectives?: Array<{
      id: string;
      description: string;
      type: 'collect' | 'deliver' | 'defeat' | 'explore' | 'talk';
      target?: string; // Entity ID
      quantity?: number;
      completed: boolean;
    }>;
    timeLimit?: string; // ISO date string
    giver?: string; // Character ID who gave the quest
    // Additional fields can be added as needed
  };
}

export interface FactionEntity extends GTWGEntity {
  type: 'faction';
  properties: {
    description: string;
    factionType: 'noble_house' | 'merchant_guild' | 'thieves_guild' | 'religious_order' | 'military' | 'bandit_group';
    size: 'small' | 'medium' | 'large' | 'massive';
    influence: number; // 0-100 scale
    wealth: number; // 0-100 scale
    territory?: string[]; // Array of region IDs
    members?: string[]; // Array of character IDs
    allies?: string[]; // Array of faction IDs
    enemies?: string[]; // Array of faction IDs
    goals?: string[]; // Array of faction objectives
    resources?: Record<string, number>; // e.g., { "gold": 1000, "soldiers": 50 }
    // Additional fields can be added as needed
  };
}

export interface EventEntity extends GTWGEntity {
  type: 'event';
  properties: {
    description: string;
    eventType: 'festival' | 'disaster' | 'war' | 'discovery' | 'ceremony' | 'accident' | 'miracle';
    status: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
    startTime: string; // ISO date string
    endTime?: string; // ISO date string
    location?: string; // Region ID where event occurs
    participants?: string[]; // Array of character/faction IDs
    effects?: Record<string, any>; // e.g., { "reputation_change": { "faction-1": 5 } }
    requirements?: {
      weather?: string;
      participants?: string[];
      items?: string[];
    };
    consequences?: Array<{
      id: string;
      description: string;
      probability: number; // 0-1 scale
      effects: Record<string, any>;
    }>;
    // Additional fields can be added as needed
  };
}

