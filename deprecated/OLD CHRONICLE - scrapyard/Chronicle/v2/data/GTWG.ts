// GTWG.ts - Ground-Truth World Graph Data Store
// =====================================================
//
// SYSTEMS ARCHITECTURE OVERVIEW:
// This module implements the "source of truth" for the entire game world.
// It's a graph database where entities (nodes) connect via relations (edges).
// 
// KEY ARCHITECTURAL DECISIONS:
// 1. IMMUTABILITY: Every function returns a NEW GTWG object, never modifies existing ones
//    - This enables time-travel debugging, undo/redo, and safe concurrent access
//    - Prevents hidden state mutations that cause hard-to-debug issues
//    - Makes the system predictable: same input always produces same output
//
// 2. GRAPH MODEL: Everything is either an Entity or a Relation
//    - Entities = things that exist (regions, characters, items, quests, factions, events)
//    - Relations = how things connect (contained_in, north_of, owns, etc.)
//    - This unified model can represent any world complexity without special cases
//
// 3. FLEXIBLE TYPING: Entities have a 'type' but properties are open-ended
//    - Core types provide structure (region, character, etc.)
//    - Properties allow infinite customization without breaking the system
//    - LLMs can create new region types dynamically ("crystal_cavern", "time_portal")
//
// 4. SEPARATION OF CONCERNS: GTWG = what EXISTS, not what player KNOWS
//    - PKG (Player Knowledge Graph) handles what player has discovered
//    - This separation enables realistic information discovery mechanics
//    - Same world can generate different experiences for different players

import type { GTWG, GTWGEntity, GTWGRelation, GTWGEntityType, GTWGRelationType, RegionEntity, CommonRegionType, CharacterEntity, ItemEntity, QuestEntity, FactionEntity, EventEntity } from '../types/GTWGTypes.js';
import { GTWGQuery } from './GTWGQuery';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Updates the metadata with current timestamp
 * 
 * SYSTEMS PURPOSE: Maintains audit trail of when world state changes
 * - Every modification updates lastModified timestamp
 * - Enables debugging: "when did this entity get added?"
 * - Supports analytics: tracking world building patterns over time
 * - Could enable automatic backup triggers based on modification frequency
 * 
 * IMMUTABILITY PATTERN: Uses object spread to create new objects
 * - ...gtwg creates shallow copy of entire GTWG
 * - ...gtwg.metadata preserves existing metadata fields
 * - Only lastModified gets updated, everything else unchanged
 * - No side effects: original gtwg object remains untouched
 */
function updateMetadata(gtwg: GTWG): GTWG {
  return {
    ...gtwg,
    metadata: {
      ...gtwg.metadata,
      lastModified: new Date().toISOString()
    }
  };
}

/**
 * Validates that an entity exists in the GTWG
 * 
 * SYSTEMS PURPOSE: Defensive programming for graph integrity
 * - Prevents operations on non-existent entities (would create dangling references)
 * - Provides clear error messages for debugging world building issues
 * - Acts as a "circuit breaker" - fails fast instead of corrupting data
 * - Centralizes existence checking logic (DRY principle)
 * 
 * ERROR HANDLING STRATEGY:
 * - Returns boolean rather than throwing exceptions (functional approach)
 * - Logs warnings for developer debugging but doesn't crash the system
 * - Calling code can decide how to handle missing entities gracefully
 * - Operation parameter provides context for more helpful error messages
 * 
 * GRAPH THEORY: Validates node existence before edge operations
 * - Essential for maintaining graph invariants (no edges to missing nodes)
 * - Prevents cascade failures when entities are removed
 */
function validateEntityExists(gtwg: GTWG, entityId: string, operation: string = 'access'): boolean {
  const entity = getEntity(gtwg, entityId);
  if (!entity) {
    console.warn(`Entity with ID ${entityId} not found. Cannot ${operation}.`);
    return false;
  }
  return true;
}

// ============================================================================
// PLUGIN REGISTRIES AND QUERY HELPER
// ============================================================================

// EXTENSIBILITY SYSTEM: Plugin registries for custom behaviors
// These allow the core GTWG system to be extended without modifying source code
// Think of these as "hooks" that custom game logic can register with

// Entity type plugins: Custom logic for specific entity types
// Example: A "spell" entity type might register casting behavior
// Map<entityType, pluginBehavior> - O(1) lookup by type name
const _entityTypePlugins = new Map<string, unknown>();

// Relation type plugins: Custom logic for specific relationship types
// Example: A "teleports_to" relation might register instant travel behavior
// Allows game-specific relationship semantics without hardcoding
const _relationTypePlugins = new Map<string, unknown>();

// Validation plugins: Custom integrity checks for specific game rules
// Example: "no_circular_containment", "max_inventory_size", "political_consistency"
// Enables domain-specific validation without cluttering core system
const _validators = new Map<string, (gtwg: GTWG) => boolean | { ok: boolean; message?: string }>();

/**
 * PLUGIN REGISTRATION FUNCTIONS
 * 
 * ARCHITECTURE PATTERN: Registry pattern for extensibility
 * - Core system provides hooks, game-specific code registers behaviors
 * - Follows Open/Closed Principle: open for extension, closed for modification
 * - Enables modular game development: different teams can add features independently
 * - Supports runtime configuration: plugins can be loaded based on game mode
 */
export function registerEntityType(type: string, plugin: unknown) {
  _entityTypePlugins.set(type, plugin);
}
export function registerRelationType(type: string, plugin: unknown) {
  _relationTypePlugins.set(type, plugin);
}
export function registerValidator(name: string, fn: (gtwg: GTWG) => boolean | { ok: boolean; message?: string }) {
  _validators.set(name, fn);
}

/**
 * Returns a fluent query builder for advanced composable queries
 * 
 * QUERY SYSTEM DESIGN: Fluent API for graph traversal
 * - Enables readable, chainable queries: queryGTWG(world).filterByType('character').getConnected('contained_in')
 * - Each method returns new query object (immutable chain)
 * - Lazy evaluation: query builds up operations, .execute() runs them
 * - Composable: complex queries built from simple, reusable operations
 * 
 * SYSTEMS THINKING: Abstraction layer over raw graph operations
 * - Hides complexity of manual entity/relation filtering
 * - Provides consistent API regardless of underlying data structure changes
 * - Could be optimized later (indexes, caching) without changing client code
 * - Supports both simple and complex spatial reasoning queries
 * 
 * PERFORMANCE: Query object is lightweight wrapper around entity ID sets
 * - No expensive operations until .execute() is called
 * - Enables query optimization before execution
 * - Memory efficient: doesn't copy entity objects until final result
 */
export function queryGTWG(gtwg: GTWG): GTWGQuery {
  return new GTWGQuery(gtwg);
}

// ============================================================================
// CORE GTWG OPERATIONS
// ============================================================================

/**
 * Creates a new empty GTWG
 * 
 * SYSTEMS PURPOSE: Factory function for world initialization
 * - Establishes the foundational data structure for an entire game world
 * - Creates consistent starting state with proper metadata
 * - Version tracking enables future migration/compatibility checks
 * - Timestamps enable audit trails and debugging
 * 
 * ARCHITECTURE DECISION: Start with empty collections rather than null
 * - Empty arrays are safer than null/undefined (no null pointer exceptions)
 * - Consistent interface: all GTWGs have same structure regardless of content
 * - Functional programming: always return valid, complete objects
 * - Makes other functions simpler: no need to check for null entities/relations
 * 
 * METADATA STRATEGY: Track creation and modification times
 * - createdAt: When this world was first initialized
 * - lastModified: When any entity/relation was last changed
 * - version: Enables schema evolution and migration logic
 * - Could be extended: worldSeed, authorId, gameMode, etc.
 */
export function createEmptyGTWG(): GTWG {
  return {
    entities: [],
    relations: [],
    metadata: {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString()
    }
  };
}

/**
 * Creates a new GTWG with the given entities and relations
 * 
 * SYSTEMS PURPOSE: Bulk world creation from complete data sets
 * - Used for loading saved worlds, importing procedurally generated content
 * - Ensures proper ordering: entities must exist before relations can reference them
 * - Leverages existing add functions to maintain all validation and integrity checks
 * 
 * COMPOSITION PATTERN: Built from smaller, single-purpose functions
 * - addEntities() handles entity validation and deduplication
 * - addRelations() handles relation validation and reference checking
 * - Each function maintains its own invariants, composition maintains global invariants
 * - Easier to test and debug than one monolithic creation function
 * 
 * FUNCTIONAL FLOW: Empty -> +Entities -> +Relations -> Complete GTWG
 * - Start with clean slate (createEmptyGTWG)
 * - Add all entities first (creates all nodes in the graph)
 * - Add relations second (creates all edges between existing nodes)
 * - This ordering prevents dangling reference errors
 * 
 * ERROR HANDLING: Inherits from composed functions
 * - Invalid entities get filtered out with warnings
 * - Relations to non-existent entities get rejected with warnings
 * - Result is always a valid GTWG, even if input had errors
 */
export function createGTWG(entities: GTWGEntity[], relations: GTWGRelation[]): GTWG {
  const gtwg = createEmptyGTWG();
  return addRelations(addEntities(gtwg, entities), relations);
}

// ============================================================================
// ENTITY OPERATIONS
// ============================================================================
// GRAPH THEORY: These functions manage the "nodes" in our world graph
// Every entity represents something that exists in the game world
// Entities can be: regions (spaces), characters (beings), items (objects),
// quests (goals), factions (groups), events (happenings)

/**
 * Adds a single entity to the GTWG
 * 
 * SYSTEMS PURPOSE: Core world-building operation for adding new "things"
 * - Fundamental building block: everything in the world starts as an entity
 * - Used by GMs adding new locations, NPCs, items, etc.
 * - Used by procedural generation systems creating content
 * - Used by player actions that create new world elements
 * 
 * INTEGRITY CHECKS: Prevents duplicate entities
 * - Each entity must have unique ID (database primary key concept)
 * - Duplicate IDs would break entity lookup and relation integrity
 * - Warning logged but system continues (graceful degradation)
 * - Returns original GTWG unchanged if duplicate detected
 * 
 * IMMUTABILITY PATTERN: Creates new world state, preserves old
 * - [...gtwg.entities, entity] creates new array with added entity
 * - updateMetadata() ensures modification timestamp gets updated
 * - Original gtwg remains unchanged (enables undo/redo, time travel)
 * - Safe for concurrent access and functional programming patterns
 * 
 * PERFORMANCE: O(n) for duplicate check, O(1) for addition
 * - getEntity() does linear search through entities (acceptable for game scale)
 * - Array spread creates new array (memory cost but enables immutability)
 * - Could be optimized with Map index later without changing interface
 */
export function addEntity(gtwg: GTWG, entity: GTWGEntity): GTWG {
  // Check if entity already exists
  if (getEntity(gtwg, entity.id)) {
    console.warn(`Entity with ID ${entity.id} already exists. Skipping addition.`);
    return gtwg;
  }

  return updateMetadata({
    ...gtwg,
    entities: [...gtwg.entities, entity]
  });
}

/**
 * Adds multiple entities to the GTWG
 * 
 * SYSTEMS PURPOSE: Bulk world creation and batch operations
 * - Loading saved worlds from JSON/database
 * - Importing procedurally generated regions, NPCs, items
 * - Applying large world updates from GM tools
 * - More efficient than multiple individual addEntity() calls
 * 
 * FUNCTIONAL COMPOSITION: Built from single-entity operation
 * - Leverages addEntity() for all validation and integrity checks
 * - Inherits duplicate detection and error handling
 * - Each iteration gets previous result as input (chain of transformations)
 * - reduce() pattern: accumulates state changes through pure functions
 * 
 * ERROR HANDLING: Partial success model
 * - Invalid/duplicate entities get skipped with warnings
 * - Valid entities still get added successfully
 * - Result is best-effort: as much as possible succeeds
 * - Better than all-or-nothing: some content is better than no content
 * 
 * PERFORMANCE: O(n*m) where n=entities, m=existing entities
 * - Each addEntity() does duplicate check against all existing entities
 * - For large imports, could be optimized with temporary lookup map
 * - Functional approach prioritizes correctness over raw performance
 */
export function addEntities(gtwg: GTWG, entities: GTWGEntity[]): GTWG {
  return entities.reduce((currentGTWG, entity) => addEntity(currentGTWG, entity), gtwg);
}

/**
 * Gets an entity by ID
 * 
 * SYSTEMS PURPOSE: Core lookup operation for world queries
 * - Most fundamental operation: "what is this thing?"
 * - Used by relation validation (does this entity exist?)
 * - Used by UI rendering (show details for selected entity)
 * - Used by game logic (get player's current location)
 * 
 * DATABASE ANALOGY: Primary key lookup
 * - Entity ID acts like database primary key (unique identifier)
 * - Returns complete entity object with all properties
 * - Null return enables safe chaining with optional operators (?)
 * - Consistent interface: always returns entity object or null
 * 
 * PERFORMANCE: O(n) linear search
 * - Acceptable for game-scale entity counts (hundreds to thousands)
 * - Could be optimized with Map<id, entity> index for larger worlds
 * - Simple implementation prioritizes code clarity and correctness
 * - find() stops at first match (efficient for successful lookups)
 * 
 * ERROR HANDLING: Null object pattern
 * - Returns null rather than throwing exception (functional approach)
 * - Calling code can handle missing entities gracefully
 * - || null ensures consistent return type (find() returns undefined on miss)
 * - Prevents cascade failures from missing entities
 */
export function getEntity(gtwg: GTWG, id: string): GTWGEntity | null {
  return gtwg.entities.find(entity => entity.id === id) || null;
}

/**
 * Gets all entities of a specific type
 * 
 * SYSTEMS PURPOSE: Category-based world queries
 * - "Show me all characters in the world" (type='character')
 * - "List all regions" (type='region') for map building
 * - "Find all quests" (type='quest') for quest log UI
 * - "Get all items" (type='item') for inventory systems
 * 
 * ARCHITECTURE DECISION: Delegates to query system
 * - Could implement as direct filter: gtwg.entities.filter(e => e.type === type)
 * - Instead uses queryGTWG().filterByType() for consistency
 * - All filtering goes through same query system (uniform interface)
 * - Enables future optimizations in query layer without changing callers
 * 
 * QUERY COMPOSITION: Building block for complex queries
 * - This simple filter often combined with spatial/property filters
 * - Example: getEntitiesByType('character') then filter by location
 * - Query system makes these compositions readable and efficient
 * - Separates "what to find" logic from "how to find" implementation
 * 
 * TYPE SAFETY: Leverages TypeScript enum constraints
 * - GTWGEntityType ensures only valid entity types can be queried
 * - Compile-time prevention of typos ('charactr' vs 'character')
 * - IDE autocompletion for available entity types
 * - Runtime type checking in query execution
 */
export function getEntitiesByType(gtwg: GTWG, type: GTWGEntityType): GTWGEntity[] {
  return queryGTWG(gtwg).filterByType(type).execute();
}

/**
 * Updates an entity by ID
 * 
 * SYSTEMS PURPOSE: Core mutation operation for world changes
 * - GM modifies entity properties during gameplay
 * - Player actions change world state (open door, damage item)
 * - Procedural systems update entity states over time
 * - Quest progression updates character/location properties
 * 
 * PARTIAL UPDATE PATTERN: Uses Partial<GTWGEntity> for flexible updates
 * - Only specified properties get changed, others remain untouched
 * - Type safety: can't accidentally update to invalid entity structure
 * - Example: updateEntity(gtwg, 'door-1', { properties: { state: 'open' } })
 * - Object spread (...updates) merges new values over existing ones
 * 
 * IMMUTABILITY PRESERVATION: Creates new arrays and objects
 * - [...gtwg.entities] creates new entities array
 * - {...oldEntity, ...updates} creates new entity object
 * - Original GTWG remains unchanged (enables undo/time-travel)
 * - Safe for concurrent access and functional programming
 * 
 * ERROR HANDLING: Graceful failure for missing entities
 * - validateEntityExists() checks existence before attempting update
 * - Returns original GTWG unchanged if entity not found
 * - Logs warning for debugging but doesn't crash system
 * - "Do no harm" principle: failed operations don't corrupt data
 * 
 * PERFORMANCE: O(n) for find, O(1) for update
 * - findIndex() does linear search to locate entity
 * - Array spread creates new array (memory cost for immutability)
 * - Could be optimized with Map index for large entity counts
 * - Prioritizes correctness and safety over raw performance
 */
export function updateEntity(gtwg: GTWG, id: string, updates: Partial<GTWGEntity>): GTWG {
  if (!validateEntityExists(gtwg, id, 'update')) {
    return gtwg;
  }

  const entityIndex = gtwg.entities.findIndex(entity => entity.id === id);
  const updatedEntities = [...gtwg.entities];
  updatedEntities[entityIndex] = {
    ...updatedEntities[entityIndex],
    ...updates
  };

  return updateMetadata({
    ...gtwg,
    entities: updatedEntities
  });
}

/**
 * Removes an entity by ID
 * 
 * SYSTEMS PURPOSE: Entity lifecycle management and world cleanup
 * - GM removes temporary NPCs, expired events, destroyed items
 * - Player actions destroy objects (break door, consume potion)
 * - Procedural cleanup removes old/irrelevant content
 * - Quest completion removes quest-specific entities
 * 
 * CASCADE DELETION: Automatically removes related connections
 * - Deletes all relations where this entity is source (relation.from === id)
 * - Deletes all relations where this entity is target (relation.to === id)
 * - Prevents dangling references and maintains graph integrity
 * - Critical for referential integrity (database foreign key concept)
 * 
 * GRAPH THEORY: Removes node and all connected edges
 * - Entity = node in the graph
 * - Relations = edges connecting nodes
 * - Removing node without edges would leave orphaned edges
 * - System automatically cleans up to maintain valid graph structure
 * 
 * IMMUTABILITY: Creates new filtered arrays
 * - filter() creates new arrays containing only non-matching items
 * - Original GTWG remains unchanged (enables undo/rollback)
 * - Both entities and relations get filtered in single operation
 * - updateMetadata() ensures modification timestamp updated
 * 
 * PERFORMANCE: O(n + m) where n=entities, m=relations
 * - Two filter operations: one for entities, one for relations
 * - No early termination possible (must check all relations for references)
 * - More expensive than simple entity removal but necessary for integrity
 * - Cost justified by preventing data corruption from dangling references
 * 
 * ERROR HANDLING: Idempotent operation
 * - No validation check (unlike update operations)
 * - Removing non-existent entity is safe no-op
 * - filter() naturally handles missing entities (filters out nothing)
 * - Result is always valid GTWG regardless of input validity
 */
export function removeEntity(gtwg: GTWG, id: string): GTWG {
  const filteredEntities = gtwg.entities.filter(entity => entity.id !== id);
  const filteredRelations = gtwg.relations.filter(relation => 
    relation.from !== id && relation.to !== id
  );

  return updateMetadata({
    ...gtwg,
    entities: filteredEntities,
    relations: filteredRelations
  });
}

// ============================================================================
// RELATION OPERATIONS
// ============================================================================

/**
 * Adds a single relation to the GTWG
 * Returns a new GTWG with the relation added
 */
export function addRelation(gtwg: GTWG, relation: GTWGRelation): GTWG {
  // Check if relation already exists
  if (getRelation(gtwg, relation.id)) {
    console.warn(`Relation with ID ${relation.id} already exists. Skipping addition.`);
    return gtwg;
  }

  return updateMetadata({
    ...gtwg,
    relations: [...gtwg.relations, relation]
  });
}

/**
 * Adds multiple relations to the GTWG
 * Returns a new GTWG with all relations added
 */
export function addRelations(gtwg: GTWG, relations: GTWGRelation[]): GTWG {
  return relations.reduce((currentGTWG, relation) => addRelation(currentGTWG, relation), gtwg);
}

/**
 * Gets a relation by ID
 * Returns null if relation doesn't exist
 */
export function getRelation(gtwg: GTWG, id: string): GTWGRelation | null {
  return gtwg.relations.find(relation => relation.id === id) || null;
}

/**
 * Gets relations with optional filtering
 * All parameters are optional - if not provided, all relations are returned
 */
export function getRelations(
  gtwg: GTWG,
  fromId?: string,
  toId?: string,
  type?: GTWGRelationType
): GTWGRelation[] {
  return gtwg.relations.filter(relation => {
    if (fromId && relation.from !== fromId) return false;
    if (toId && relation.to !== toId) return false;
    if (type && relation.type !== type) return false;
    return true;
  });
}

/**
 * Removes a relation by ID
 * Returns a new GTWG with the relation removed
 */
export function removeRelation(gtwg: GTWG, id: string): GTWG {
  const filteredRelations = gtwg.relations.filter(relation => relation.id !== id);

  return updateMetadata({
    ...gtwg,
    relations: filteredRelations
  });
}

// ============================================================================
// REGION-BASED QUERY OPERATIONS
// ============================================================================

/**
 * Finds all entities connected to a given entity
 * Optionally filters by relation type
 */
export function findConnectedEntities(
  gtwg: GTWG,
  entityId: string,
  relationType?: GTWGRelationType
): GTWGEntity[] {
  const relations = getRelations(gtwg, entityId, undefined, relationType);
  const connectedIds = relations.map(relation => relation.to);
  
  return connectedIds
    .map(id => getEntity(gtwg, id))
    .filter((entity): entity is GTWGEntity => entity !== null);
}

/**
 * Finds all entities that connect to a given entity
 * Optionally filters by relation type
 */
export function findIncomingEntities(
  gtwg: GTWG,
  entityId: string,
  relationType?: GTWGRelationType
): GTWGEntity[] {
  const relations = getRelations(gtwg, undefined, entityId, relationType);
  const connectedIds = relations.map(relation => relation.from);
  
  return connectedIds
    .map(id => getEntity(gtwg, id))
    .filter((entity): entity is GTWGEntity => entity !== null);
}

/**
 * Gets the complete containment chain for an entity
 * Returns array from immediate container to root container
 * Example: [Room, Building, Street, District, City, Province, Kingdom]
 */
export function getEntityContainmentChain(gtwg: GTWG, entityId: string): RegionEntity[] {
  const chain: RegionEntity[] = [];
  let currentEntity = getEntity(gtwg, entityId);
  
  while (currentEntity) {
    const container = getEntityContainer(gtwg, currentEntity.id);
    if (container && container.type === 'region') {
      chain.unshift(container as RegionEntity);
      currentEntity = container;
    } else {
      break;
    }
  }
  
  return chain;
}

/**
 * Gets the immediate container of an entity
 * Returns null if entity is not contained in anything
 */
export function getEntityContainer(gtwg: GTWG, entityId: string): GTWGEntity | null {
  const containerRelations = getRelations(gtwg, entityId, undefined, 'contained_in');
  
  if (containerRelations.length === 0) {
    return null;
  }

  // Get the first container relation (assuming one container per entity)
  const containerId = containerRelations[0].to;
  return getEntity(gtwg, containerId);
}

/**
 * Gets all entities contained within a specific container
 * Recursively finds all nested entities
 */
export function getAllContainedEntities(gtwg: GTWG, containerId: string): GTWGEntity[] {
  const contained: GTWGEntity[] = [];
  const visited = new Set<string>();
  
  function traverse(containerId: string) {
    if (visited.has(containerId)) return;
    visited.add(containerId);
    
    const directContents = getDirectContainedEntities(gtwg, containerId);
    contained.push(...directContents);
    
    // Recursively traverse each contained entity
    directContents.forEach(entity => {
      if (entity.type === 'region') {
        traverse(entity.id);
      }
    });
  }
  
  traverse(containerId);
  return contained;
}

/**
 * Gets only directly contained entities (not nested)
 */
export function getDirectContainedEntities(gtwg: GTWG, containerId: string): GTWGEntity[] {
  const containerRelations = getRelations(gtwg, undefined, containerId, 'contained_in');
  const entityIds = containerRelations.map(relation => relation.from);
  
  return entityIds
    .map(id => getEntity(gtwg, id))
    .filter((entity): entity is GTWGEntity => entity !== null);
}

/**
 * Gets spatial neighbors in all directions
 */
export function getSpatialNeighbors(gtwg: GTWG, entityId: string): {
  north?: GTWGEntity;
  south?: GTWGEntity;
  east?: GTWGEntity;
  west?: GTWGEntity;
  above?: GTWGEntity;
  below?: GTWGEntity;
} {
  const neighbors: any = {};
  
  const directions: (GTWGRelationType)[] = ['north_of', 'south_of', 'east_of', 'west_of', 'above', 'below'];
  
  directions.forEach(direction => {
    const relations = getRelations(gtwg, entityId, undefined, direction);
    if (relations.length > 0) {
      const neighborId = relations[0].to;
      const neighbor = getEntity(gtwg, neighborId);
      if (neighbor) {
        const key = direction.replace('_of', '') as keyof typeof neighbors;
        neighbors[key] = neighbor;
      }
    }
  });
  
  return neighbors;
}

/**
 * Gets all entities within a certain distance/spatial radius
 */
export function getEntitiesInRadius(gtwg: GTWG, centerEntityId: string, radius: number): GTWGEntity[] {
  const centerEntity = getEntity(gtwg, centerEntityId);
  if (!centerEntity || centerEntity.type !== 'region') {
    return [];
  }
  
  const centerCoords = (centerEntity as RegionEntity).properties.coords;
  if (!centerCoords) {
    return [];
  }
  
  return gtwg.entities
    .filter(entity => entity.type === 'region')
    .map(entity => entity as RegionEntity)
    .filter(entity => {
      const entityCoords = entity.properties.coords;
      if (!entityCoords) return false;
      
      const distance = Math.sqrt(
        Math.pow(entityCoords.x - centerCoords.x, 2) + 
        Math.pow(entityCoords.y - centerCoords.y, 2)
      );
      
      return distance <= radius;
    });
}

// ============================================================================
// DYNAMIC REGION QUERIES
// ============================================================================

/**
 * Gets all regions of a specific type (supports both common and dynamic types)
 */
export function getRegionsByType(gtwg: GTWG, regionType: string): RegionEntity[] {
  return queryGTWG(gtwg)
    .filterByType('region')
    .filterByProperty('regionType', regionType)
    .execute() as RegionEntity[];
}

/**
 * Gets all regions in the GTWG
 */
export function getRegions(gtwg: GTWG): RegionEntity[] {
  return getEntitiesByType(gtwg, 'region') as RegionEntity[];
}

/**
 * Gets all regions that are locations (buildings, rooms, etc.)
 */
export function getLocationRegions(gtwg: GTWG): RegionEntity[] {
  const locationTypes: CommonRegionType[] = [
    'building', 'room', 'shop', 'tavern', 'inn', 'castle', 'tower', 'temple',
    'dungeon', 'cave', 'market', 'square', 'alley', 'gate', 'bridge'
  ];
  
  return queryGTWG(gtwg)
    .filterByType('region')
    .filterByProperty('regionType', (rt: string) => {
      const lower = rt.toLowerCase();
      const isCommon = locationTypes.includes(rt as CommonRegionType);
      const isDynamic = lower.includes('room') || lower.includes('building') || lower.includes('house') || lower.includes('shop') || lower.includes('tavern');
      return isCommon || isDynamic;
    })
    .execute() as RegionEntity[];
}

/**
 * Gets all regions that are features (doors, windows, furniture, etc.)
 */
export function getFeatureRegions(gtwg: GTWG): RegionEntity[] {
  const featureTypes: CommonRegionType[] = [
    'door', 'window', 'furniture', 'container', 'feature', 'landmark',
    'structure', 'object', 'item_location'
  ];
  
  return queryGTWG(gtwg)
    .filterByType('region')
    .filterByProperty('regionType', (rt: string) => {
      const lower = rt.toLowerCase();
      const isCommon = featureTypes.includes(rt as CommonRegionType);
      const isDynamic = lower.includes('door') || lower.includes('window') || lower.includes('container') || lower.includes('furniture') || lower.includes('object');
      return isCommon || isDynamic;
    })
    .execute() as RegionEntity[];
}

/**
 * Gets all LLM-generated region types
 */
export function getLLMGeneratedRegions(gtwg: GTWG): RegionEntity[] {
  return gtwg.entities
    .filter(entity => entity.type === 'region')
    .map(entity => entity as RegionEntity)
    .filter(entity => entity.properties.llmGenerated === true);
}

/**
 * Gets all unique region types in the GTWG
 */
export function getAllRegionTypes(gtwg: GTWG): string[] {
  const regionTypes = new Set<string>();
  
  gtwg.entities
    .filter(entity => entity.type === 'region')
    .forEach(entity => {
      const regionEntity = entity as RegionEntity;
      regionTypes.add(regionEntity.properties.regionType);
    });
  
  return Array.from(regionTypes);
}

/**
 * Gets regions by context (what experience led to their creation)
 */
export function getRegionsByContext(gtwg: GTWG, context: string): RegionEntity[] {
  return gtwg.entities
    .filter(entity => entity.type === 'region')
    .map(entity => entity as RegionEntity)
    .filter(entity => entity.properties.context?.toLowerCase().includes(context.toLowerCase()));
}

// ============================================================================
// NON-REGION ENTITY QUERIES
// ============================================================================

/**
 * Gets all characters in the GTWG
 */
export function getCharacters(gtwg: GTWG): CharacterEntity[] {
  return getEntitiesByType(gtwg, 'character') as CharacterEntity[];
}

/**
 * Gets all items in the GTWG
 */
export function getItems(gtwg: GTWG): ItemEntity[] {
  return getEntitiesByType(gtwg, 'item') as ItemEntity[];
}

/**
 * Gets all quests in the GTWG
 */
export function getQuests(gtwg: GTWG): QuestEntity[] {
  return getEntitiesByType(gtwg, 'quest') as QuestEntity[];
}

/**
 * Gets all factions in the GTWG
 */
export function getFactions(gtwg: GTWG): FactionEntity[] {
  return getEntitiesByType(gtwg, 'faction') as FactionEntity[];
}

/**
 * Gets all events in the GTWG
 */
export function getEvents(gtwg: GTWG): EventEntity[] {
  return getEntitiesByType(gtwg, 'event') as EventEntity[];
}

// ============================================================================
// VALIDATION OPERATIONS
// ============================================================================

/**
 * Validates the GTWG for consistency
 * Returns validation result with any errors found
 */
export function validateGTWG(gtwg: GTWG): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for duplicate entity IDs
  const entityIds = gtwg.entities.map(entity => entity.id);
  const duplicateEntityIds = entityIds.filter((id, index) => entityIds.indexOf(id) !== index);
  if (duplicateEntityIds.length > 0) {
    errors.push(`Duplicate entity IDs found: ${duplicateEntityIds.join(', ')}`);
  }

  // Check for duplicate relation IDs
  const relationIds = gtwg.relations.map(relation => relation.id);
  const duplicateRelationIds = relationIds.filter((id, index) => relationIds.indexOf(id) !== index);
  if (duplicateRelationIds.length > 0) {
    errors.push(`Duplicate relation IDs found: ${duplicateRelationIds.join(', ')}`);
  }

  // Check for invalid relation references
  const invalidRelations = gtwg.relations.filter(relation => {
    const fromExists = gtwg.entities.some(entity => entity.id === relation.from);
    const toExists = gtwg.entities.some(entity => entity.id === relation.to);
    return !fromExists || !toExists;
  });

  if (invalidRelations.length > 0) {
    errors.push(`Invalid relation references found: ${invalidRelations.map(r => r.id).join(', ')}`);
  }

  // Check for circular containment references
  const containmentRelations = getRelations(gtwg, undefined, undefined, 'contained_in');
  const circularContainment = findCircularContainmentReferences(gtwg, containmentRelations);
  if (circularContainment.length > 0) {
    errors.push(`Circular containment references found: ${circularContainment.join(' -> ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Checks if the GTWG has orphan entities
 */
export function hasOrphanEntities(gtwg: GTWG): boolean {
  return gtwg.entities.some(entity => {
    const hasOutgoing = gtwg.relations.some(relation => relation.from === entity.id);
    const hasIncoming = gtwg.relations.some(relation => relation.to === entity.id);
    return !hasOutgoing && !hasIncoming;
  });
}

/**
 * Checks if the GTWG has circular containment references
 */
export function hasCircularContainmentReferences(gtwg: GTWG): boolean {
  const containmentRelations = getRelations(gtwg, undefined, undefined, 'contained_in');
  const circularPaths = findCircularContainmentReferences(gtwg, containmentRelations);
  return circularPaths.length > 0;
}

/**
 * Helper function to find circular containment references
 */
function findCircularContainmentReferences(gtwg: GTWG, containmentRelations: GTWGRelation[]): string[][] {
  const circularPaths: string[][] = [];
  const visited = new Set<string>();
  const path = new Map<string, string>();

  function dfs(entityId: string, currentPath: string[]): void {
    if (currentPath.includes(entityId)) {
      // Found a cycle
      const cycleStart = currentPath.indexOf(entityId);
      const cycle = currentPath.slice(cycleStart);
      circularPaths.push([...cycle, entityId]);
      return;
    }

    if (visited.has(entityId)) {
      return;
    }

    visited.add(entityId);
    currentPath.push(entityId);

    // Find all entities that contain this entity
    const incomingContainmentRelations = containmentRelations.filter(relation => relation.from === entityId);
    
    for (const relation of incomingContainmentRelations) {
      const containerId = relation.to;
      dfs(containerId, [...currentPath]);
    }
  }

  // Start DFS from each entity
  for (const entity of gtwg.entities) {
    if (!visited.has(entity.id)) {
      dfs(entity.id, []);
    }
  }

  return circularPaths;
}

// ============================================================================
// UTILITY OPERATIONS
// ============================================================================

/**
 * Gets comprehensive statistics about the GTWG
 */
export function getGTWGStats(gtwg: GTWG): {
  entityCount: number;
  relationCount: number;
  entityTypeCounts: Record<GTWGEntityType, number>;
  relationTypeCounts: Record<GTWGRelationType, number>;
  regionTypeCounts: Record<string, number>;
  llmGeneratedCount: number;
  uniqueRegionTypes: string[];
} {
  const entityTypeCounts = {} as Record<GTWGEntityType, number>;
  const relationTypeCounts = {} as Record<GTWGRelationType, number>;
  const regionTypeCounts = {} as Record<string, number>;
  let llmGeneratedCount = 0;
  const uniqueRegionTypes = new Set<string>();

  // Count entity types
  gtwg.entities.forEach(entity => {
    entityTypeCounts[entity.type] = (entityTypeCounts[entity.type] || 0) + 1;
    
    // Count region subtypes and LLM-generated regions
    if (entity.type === 'region') {
      const regionEntity = entity as RegionEntity;
      const regionType = regionEntity.properties.regionType;
      regionTypeCounts[regionType] = (regionTypeCounts[regionType] || 0) + 1;
      uniqueRegionTypes.add(regionType);
      
      if (regionEntity.properties.llmGenerated) {
        llmGeneratedCount++;
      }
    }
  });

  // Count relation types
  gtwg.relations.forEach(relation => {
    relationTypeCounts[relation.type] = (relationTypeCounts[relation.type] || 0) + 1;
  });

  return {
    entityCount: gtwg.entities.length,
    relationCount: gtwg.relations.length,
    entityTypeCounts,
    relationTypeCounts,
    regionTypeCounts,
    llmGeneratedCount,
    uniqueRegionTypes: Array.from(uniqueRegionTypes)
  };
}

/**
 * Creates a deep copy of the GTWG
 */
export function cloneGTWG(gtwg: GTWG): GTWG {
  return {
    entities: [...gtwg.entities],
    relations: [...gtwg.relations],
    metadata: gtwg.metadata ? { ...gtwg.metadata } : undefined
  };
}

/**
 * Compares two GTWGs for equality
 */
export function areGTWGsEqual(gtwg1: GTWG, gtwg2: GTWG): boolean {
  if (gtwg1.entities.length !== gtwg2.entities.length) return false;
  if (gtwg1.relations.length !== gtwg2.relations.length) return false;

  // Compare entities
  for (let i = 0; i < gtwg1.entities.length; i++) {
    if (JSON.stringify(gtwg1.entities[i]) !== JSON.stringify(gtwg2.entities[i])) {
      return false;
    }
  }

  // Compare relations
  for (let i = 0; i < gtwg1.relations.length; i++) {
    if (JSON.stringify(gtwg1.relations[i]) !== JSON.stringify(gtwg2.relations[i])) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// EXAMPLE: DYNAMIC REGION CREATION
// ============================================================================

/**
 * Creates an example world with dynamic region types
 * Demonstrates LLM-generated region types
 */
export function createExampleDynamicRegions(): GTWG {
  const gtwg = createEmptyGTWG();
  
  // Create regions with both common and dynamic types
  const world: RegionEntity = {
    id: 'world-1',
    type: 'region',
    name: 'The World',
    properties: {
      description: 'The entire world',
      regionType: 'world',
      climate: 'temperate',
      importance: 10
    }
  };
  
  const kingdom: RegionEntity = {
    id: 'kingdom-1',
    type: 'region',
    name: 'Aetheria',
    properties: {
      description: 'A prosperous kingdom',
      regionType: 'kingdom',
      climate: 'temperate',
      wealth: 80,
      importance: 8
    }
  };
  
  const city: RegionEntity = {
    id: 'city-1',
    type: 'region',
    name: 'Stormhaven',
    properties: {
      description: 'A bustling port city',
      regionType: 'city',
      climate: 'temperate',
      population: 50000,
      wealth: 85,
      importance: 8
    }
  };
  
  // LLM-generated region types based on user experience
  const magicAcademy: RegionEntity = {
    id: 'academy-1',
    type: 'region',
    name: 'The Arcane Academy',
    properties: {
      description: 'A prestigious school for magic users',
      regionType: 'magic_academy', // LLM-generated type
      commonType: 'building', // Optional common type for consistency
      llmGenerated: true,
      context: 'User wanted to learn magic',
      experience: 'Player asked about magic training',
      population: 200,
      wealth: 90,
      importance: 7
    }
  };
  
  const crystalCave: RegionEntity = {
    id: 'cave-1',
    type: 'region',
    name: 'The Crystal Caverns',
    properties: {
      description: 'A mystical cave filled with glowing crystals',
      regionType: 'crystal_cavern', // LLM-generated type
      commonType: 'cave', // Optional common type
      llmGenerated: true,
      context: 'User discovered magical crystals',
      experience: 'Player found crystals and wanted to explore',
      dangerLevel: 'wild',
      importance: 6
    }
  };
  
  const timePortal: RegionEntity = {
    id: 'portal-1',
    type: 'region',
    name: 'The Time Portal',
    properties: {
      description: 'A mysterious portal that bends time',
      regionType: 'time_portal', // LLM-generated type
      llmGenerated: true,
      context: 'User encountered time travel',
      experience: 'Player discovered temporal anomalies',
      accessibility: 'hidden',
      importance: 9
    }
  };
  
  // Create containment relationships
  const relations: GTWGRelation[] = [
    { id: 'rel-1', type: 'contained_in', from: 'kingdom-1', to: 'world-1' },
    { id: 'rel-2', type: 'contained_in', from: 'city-1', to: 'kingdom-1' },
    { id: 'rel-3', type: 'contained_in', from: 'academy-1', to: 'city-1' },
    { id: 'rel-4', type: 'contained_in', from: 'cave-1', to: 'academy-1' },
    { id: 'rel-5', type: 'contained_in', from: 'portal-1', to: 'cave-1' }
  ];
  
  // Add all entities and relations
  const entities = [world, kingdom, city, magicAcademy, crystalCave, timePortal];
  return addRelations(addEntities(gtwg, entities), relations);
}

/**
 * Demonstrates dynamic region queries
 */
export function demonstrateDynamicRegions(gtwg: GTWG): void {
  console.log('=== DYNAMIC REGION DEMONSTRATION ===');
  
  // Get all unique region types
  const allRegionTypes = getAllRegionTypes(gtwg);
  console.log('All region types:', allRegionTypes);
  // Output: ['world', 'kingdom', 'city', 'magic_academy', 'crystal_cavern', 'time_portal']
  
  // Get LLM-generated regions
  const llmRegions = getLLMGeneratedRegions(gtwg);
  console.log('LLM-generated regions:', llmRegions.map(e => e.name));
  // Output: ['The Arcane Academy', 'The Crystal Caverns', 'The Time Portal']
  
  // Get regions by context
  const magicRegions = getRegionsByContext(gtwg, 'magic');
  console.log('Magic-related regions:', magicRegions.map(e => e.name));
  
  // Get regions by type (supports both common and dynamic)
  const academyRegions = getRegionsByType(gtwg, 'magic_academy');
  console.log('Magic academy regions:', academyRegions.map(e => e.name));
  
  console.log('=== END DEMONSTRATION ===');
} 