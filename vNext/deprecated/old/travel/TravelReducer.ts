// TravelReducer.ts - Core V2 Travel System
// ======================================
//
// PURE V2 ARCHITECTURE - COMPLETE FREEDOM
// This is the core travel system built with optimal architecture
// and zero compromises for V1 compatibility.
//
// ARCHITECTURAL PRINCIPLES:
// 1. IMMUTABLE OPERATIONS: All functions return new objects
// 2. GTWG INTEGRATION: Uses hierarchical region containment
// 3. PKG AWARENESS: Respects player knowledge limitations
// 4. DETERMINISTIC: Same inputs always produce same outputs
// 5. EXTENSIBLE: Plugin architecture for custom behaviors

import type { GTWG, GTWGEntity } from '../types/GTWGTypes.js';
import type { PKG } from '../data/PKG.js';
import type {
  TravelRoute,
  TravelSegment,
  TravelState, 
  PathfindingResult, 
  RoutePreferences,
  TravelEngineConfig,
  TerrainType,
  DifficultyLevel,
  TravelModifiers,
  TransportationMode,
  TravelResult
} from '../types/TravelTypes.js';
import { 
  getEntity, 
  getEntityContainmentChain, 
  getEntityContainer,
  getSpatialNeighbors,
  findConnectedEntities
} from '../data/GTWG.js';
import { isEntityDiscovered } from '../data/PKG.js';

// ============================================================================
// CORE TRAVEL REDUCER
// ============================================================================

/**
 * V2 Travel Reducer - Pure functional travel system
 * 
 * SYSTEMS ARCHITECTURE:
 * - Uses GTWG as single source of truth for world structure
 * - Integrates with PKG for knowledge-limited routing
 * - Hierarchical pathfinding for complex containment relationships
 * - Weather and terrain effects from existing systems
 * - Deterministic calculations for consistent behavior
 */
export class TravelReducer {
  private config: TravelEngineConfig;
  private routeCache: Map<string, TravelRoute> = new Map();

  constructor(config: TravelEngineConfig) {
    this.config = config;
  }

  // ========================================================================
  // ROUTE CALCULATION
  // ========================================================================

  /**
   * Calculates optimal route between two locations
   * 
   * HIERARCHICAL ROUTING STRATEGY:
   * 1. Find common container (lowest level that contains both locations)
   * 2. Route up from origin to common container
   * 3. Route across at common container level
   * 4. Route down from common container to destination
   * 
   * KNOWLEDGE INTEGRATION:
   * - Only routes through locations player knows about (PKG)
   * - Can suggest exploration if no known route exists
   * - Respects discovery limitations and uncertainty
   */
  async calculateRoute(
    gtwg: GTWG, 
    pkg: PKG, 
    fromId: string, 
    toId: string, 
    preferences: RoutePreferences = {}
  ): Promise<PathfindingResult> {
    const startTime = Date.now();
    
    try {
      // Validate inputs
      const validation = this.validateRouteInputs(gtwg, pkg, fromId, toId);
      if (!validation.success) {
        return {
          success: false,
          blockedReasons: [validation.error || 'Validation failed'],
          computationTime: Date.now() - startTime,
          nodesExplored: 0,
          algorithmUsed: 'validation'
        };
      }

      // Check cache first
      const cacheKey = this.generateCacheKey(fromId, toId, preferences);
      if (this.config.performance.cacheRoutes && this.routeCache.has(cacheKey)) {
        const cachedRoute = this.routeCache.get(cacheKey)!;
        return {
          success: true,
          route: cachedRoute,
          computationTime: Date.now() - startTime,
          nodesExplored: 0,
          algorithmUsed: 'cached'
        };
      }

      // Calculate route using hierarchical pathfinding
      const routeResult = await this.performHierarchicalPathfinding(
        gtwg, 
        pkg, 
        fromId, 
        toId, 
        preferences
      );

      // Cache successful routes
      if (routeResult.success && routeResult.route && this.config.performance.cacheRoutes) {
        this.routeCache.set(cacheKey, routeResult.route);
        
        // Manage cache size
        if (this.routeCache.size > this.config.performance.cacheSize) {
          const firstKey = this.routeCache.keys().next().value;
          this.routeCache.delete(firstKey);
        }
      }

      return {
        ...routeResult,
        computationTime: Date.now() - startTime
      };

    } catch (error) {
      return {
        success: false,
        blockedReasons: [`Calculation error: ${error}`],
        computationTime: Date.now() - startTime,
        nodesExplored: 0,
        algorithmUsed: 'error'
      };
    }
  }

  /**
   * Hierarchical pathfinding implementation
   * 
   * ALGORITHM:
   * 1. Determine containment relationship between origin and destination
   * 2. Use appropriate pathfinding strategy based on relationship
   * 3. Generate segments with realistic time/distance calculations
   * 4. Apply modifiers (weather, terrain, character stats)
   */
  private async performHierarchicalPathfinding(
    gtwg: GTWG,
    pkg: PKG,
    fromId: string,
    toId: string,
    preferences: RoutePreferences
  ): Promise<PathfindingResult> {
    
    const fromEntity = getEntity(gtwg, fromId)!;
    const toEntity = getEntity(gtwg, toId)!;
    
    // Get containment chains for both locations
    const fromChain = getEntityContainmentChain(gtwg, fromId);
    const toChain = getEntityContainmentChain(gtwg, toId);
    
    // Find relationship between locations
    const relationship = this.analyzeLocationRelationship(fromChain, toChain, fromId, toId);
    
    let segments: TravelSegment[] = [];
    let nodesExplored = 0;
    
    switch (relationship.type) {
      case 'same_location':
        // Already at destination
        segments = [];
        break;
        
      case 'same_container':
        // Both in same immediate container - direct route
        const directResult = await this.calculateDirectRoute(gtwg, pkg, fromId, toId, preferences);
        segments = directResult.segments;
        nodesExplored = directResult.nodesExplored;
        break;
        
      case 'nested':
        // One contains the other - simple containment traversal
        const nestedResult = await this.calculateNestedRoute(gtwg, pkg, relationship, preferences);
        segments = nestedResult.segments;
        nodesExplored = nestedResult.nodesExplored;
        break;
        
      case 'distant':
        // Different containers - hierarchical routing required
        const distantResult = await this.calculateHierarchicalRoute(gtwg, pkg, relationship, preferences);
        segments = distantResult.segments;
        nodesExplored = distantResult.nodesExplored;
        break;
    }
    
    if (segments.length === 0 && relationship.type !== 'same_location') {
      return {
        success: false,
        blockedReasons: ['No valid route found'],
        nodesExplored,
        algorithmUsed: 'hierarchical',
        computationTime: 0
      };
    }
    
    // Create final route
    const route: TravelRoute = {
      id: this.generateRouteId(fromId, toId),
      origin: fromId,
      destination: toId,
      segments,
      totalDistance: segments.reduce((sum, seg) => sum + seg.distance, 0),
      estimatedTime: segments.reduce((sum, seg) => sum + seg.baseTime, 0),
      routeType: this.determineRouteType(segments, preferences),
      createdAt: new Date().toISOString(),
      calculatedBy: 'system'
    };
    
    return {
      success: true,
      route,
      nodesExplored,
      algorithmUsed: 'hierarchical',
      computationTime: 0
    };
  }

  /**
   * Analyzes spatial relationship between two locations
   */
  private analyzeLocationRelationship(
    fromChain: any[], 
    toChain: any[], 
    fromId: string, 
    toId: string
  ) {
    if (fromId === toId) {
      return { type: 'same_location' as const };
    }
    
    // Check if one contains the other
    const fromContainsTo = fromChain.some(entity => entity.id === toId);
    const toContainsFrom = toChain.some(entity => entity.id === fromId);
    
    if (fromContainsTo || toContainsFrom) {
      return { 
        type: 'nested' as const, 
        direction: fromContainsTo ? 'from_contains_to' : 'to_contains_from'
      };
    }
    
    // Find common container
    const commonContainer = this.findCommonContainer(fromChain, toChain);
    
    if (commonContainer) {
      return { 
        type: 'same_container' as const, 
        container: commonContainer 
      };
    }
    
    // Find lowest common ancestor
    const commonAncestor = this.findLowestCommonAncestor(fromChain, toChain);
    
    return { 
      type: 'distant' as const, 
      commonAncestor,
      fromChain,
      toChain
    };
  }

  /**
   * Calculates direct route between locations in same container
   */
  private async calculateDirectRoute(
    gtwg: GTWG, 
    pkg: PKG, 
    fromId: string, 
    toId: string, 
    preferences: RoutePreferences
  ): Promise<{ segments: TravelSegment[]; nodesExplored: number }> {
    
    // Check for direct spatial connection
    const spatialNeighbors = getSpatialNeighbors(gtwg, fromId);
    const directConnection = Object.values(spatialNeighbors).find(neighbor => neighbor?.id === toId);
    
    if (directConnection) {
      // Direct spatial connection exists
      const segment = this.createTravelSegment(
        fromId, 
        toId, 
        'adjacent', 
        this.calculateDirectDistance(gtwg, fromId, toId),
        'path', // Default terrain
        'easy'  // Default difficulty
      );
      
      return { segments: [segment], nodesExplored: 2 };
    }
    
    // No direct connection - need pathfinding within container
    const pathfindingResult = await this.performLocalPathfinding(gtwg, pkg, fromId, toId, preferences);
    return pathfindingResult;
  }

  /**
   * Local pathfinding within a single container
   */
  private async performLocalPathfinding(
    gtwg: GTWG,
    pkg: PKG,
    fromId: string,
    toId: string,
    preferences: RoutePreferences
  ): Promise<{ segments: TravelSegment[]; nodesExplored: number }> {
    
    // Get container to limit search scope
    const container = getEntityContainer(gtwg, fromId);
    if (!container) {
      return { segments: [], nodesExplored: 0 };
    }
    
    // Use A* pathfinding within container
    // For now, simplified implementation - can be enhanced later
    const segments: TravelSegment[] = [];
    let nodesExplored = 0;
    
    // Check if player knows about destination
    if (!isEntityDiscovered(pkg, toId)) {
      return { segments: [], nodesExplored: 1 };
    }
    
    // Create simple segment for MVP
    const segment = this.createTravelSegment(
      fromId,
      toId,
      'connection',
      this.calculateDirectDistance(gtwg, fromId, toId),
      'path',
      'moderate'
    );
    
    segments.push(segment);
    nodesExplored = 2;
    
    return { segments, nodesExplored };
  }

  /**
   * Calculates route between nested locations (one contains other)
   */
  private async calculateNestedRoute(
    gtwg: GTWG,
    pkg: PKG,
    relationship: any,
    preferences: RoutePreferences
  ): Promise<{ segments: TravelSegment[]; nodesExplored: number }> {
    
    // For nested relationships, create containment traversal segments
    const segments: TravelSegment[] = [];
    
    // Simplified for MVP - can be enhanced with proper containment traversal
    const segment = this.createTravelSegment(
      relationship.fromId,
      relationship.toId,
      'containment',
      10, // Small distance for containment traversal
      'path',
      'trivial'
    );
    
    segments.push(segment);
    
    return { segments, nodesExplored: 2 };
  }

  /**
   * Calculates hierarchical route for distant locations
   */
  private async calculateHierarchicalRoute(
    gtwg: GTWG,
    pkg: PKG,
    relationship: any,
    preferences: RoutePreferences
  ): Promise<{ segments: TravelSegment[]; nodesExplored: number }> {
    
    const segments: TravelSegment[] = [];
    let nodesExplored = 0;
    
    // Simplified hierarchical routing for MVP
    // This would be enhanced with proper multi-level pathfinding
    
    // For now, create a single long-distance segment
    const segment = this.createTravelSegment(
      relationship.fromChain[0]?.id || relationship.fromId,
      relationship.toChain[0]?.id || relationship.toId,
      'connection',
      this.calculateHierarchicalDistance(relationship),
      'road',
      'moderate'
    );
    
    segments.push(segment);
    nodesExplored = Math.max(relationship.fromChain.length, relationship.toChain.length);
    
    return { segments, nodesExplored };
  }

  // ========================================================================
  // HELPER FUNCTIONS
  // ========================================================================

  private validateRouteInputs(
    gtwg: GTWG, 
    pkg: PKG, 
    fromId: string, 
    toId: string
  ): { success: boolean; error?: string } {
    
    const fromEntity = getEntity(gtwg, fromId);
    if (!fromEntity) {
      return { success: false, error: `Origin entity ${fromId} not found` };
    }
    
    const toEntity = getEntity(gtwg, toId);
    if (!toEntity) {
      return { success: false, error: `Destination entity ${toId} not found` };
    }
    
    // Check if player knows about destination
    if (!isEntityDiscovered(pkg, toId)) {
      return { success: false, error: `Destination ${toId} is unknown to player` };
    }
    
    return { success: true };
  }

  private createTravelSegment(
    from: string,
    to: string,
    segmentType: 'containment' | 'adjacent' | 'connection' | 'teleport',
    distance: number,
    terrain: TerrainType,
    difficulty: DifficultyLevel
  ): TravelSegment {
    
    return {
      id: `segment_${from}_${to}_${Date.now()}`,
      from,
      to,
      segmentType,
      distance,
      baseTime: this.calculateBaseTime(distance, terrain),
      terrain,
      difficulty
    };
  }

  private calculateDirectDistance(gtwg: GTWG, fromId: string, toId: string): number {
    const fromEntity = getEntity(gtwg, fromId);
    const toEntity = getEntity(gtwg, toId);
    
    // Use coordinates if available
    if (fromEntity?.properties?.coords && toEntity?.properties?.coords) {
      const fromCoords = fromEntity.properties.coords;
      const toCoords = toEntity.properties.coords;
      // Grid distance in units
      const gridDistance = Math.sqrt(
        Math.pow(toCoords.x - fromCoords.x, 2) + 
        Math.pow(toCoords.y - fromCoords.y, 2)
      );
      // Convert grid units to meters using metadata scale (default 1m per unit)
      const scale = (gtwg.metadata as any)?.gridScaleMetersPerUnit ?? 1;
      return gridDistance * scale;
    }
    
    // Default distance for unknown coordinates
    return 100; // meters
  }

  private calculateHierarchicalDistance(relationship: any): number {
    // Simplified distance calculation for hierarchical routes
    // Would be enhanced with proper distance calculations
    return 1000; // meters
  }

  private calculateBaseTime(distance: number, terrain: TerrainType): number {
    const baseSpeed = this.config.timeCalculation.baseWalkingSpeed * 1000 / 60; // m/min
    const terrainMultiplier = this.config.timeCalculation.terrainMultipliers[terrain] || 1.0;
    
    return (distance / baseSpeed) * terrainMultiplier;
  }

  private findCommonContainer(fromChain: any[], toChain: any[]): any | null {
    // Find immediate common container
    for (const fromContainer of fromChain) {
      for (const toContainer of toChain) {
        if (fromContainer.id === toContainer.id) {
          return fromContainer;
        }
      }
    }
    return null;
  }

  private findLowestCommonAncestor(fromChain: any[], toChain: any[]): any | null {
    // Find the lowest level container that contains both chains
    return this.findCommonContainer(fromChain, toChain);
  }

  private determineRouteType(segments: TravelSegment[], preferences: RoutePreferences): any {
    // Analyze segments to determine route characteristics
    if (preferences.optimizeFor === 'speed') return 'fast';
    if (preferences.optimizeFor === 'safety') return 'safe';
    if (preferences.optimizeFor === 'discovery') return 'scenic';
    return 'direct';
  }

  private generateRouteId(fromId: string, toId: string): string {
    return `route_${fromId}_${toId}_${Date.now()}`;
  }

  private generateCacheKey(fromId: string, toId: string, preferences: RoutePreferences): string {
    return `${fromId}-${toId}-${JSON.stringify(preferences)}`;
  }

  // ========================================================================
  // TIME AND MODIFIER CALCULATIONS
  // ========================================================================

  /**
   * Calculates actual travel time with all modifiers applied
   */
  estimateTravelTime(route: TravelRoute, modifiers?: TravelModifiers): number {
    let totalTime = route.estimatedTime;
    
    if (modifiers) {
      // Apply weather effects
      if (modifiers.weather) {
        totalTime *= modifiers.weather.timeMultiplier;
      }
      
      // Apply transportation effects
      if (modifiers.transportation) {
        totalTime *= modifiers.transportation.speedMultiplier;
      }
      
      // Apply character effects
      if (modifiers.character) {
        const staminaEffect = Math.max(0.5, modifiers.character.stamina);
        const healthEffect = Math.max(0.3, modifiers.character.condition.health);
        totalTime *= (2 - staminaEffect) * (2 - healthEffect);
      }
    }
    
    return Math.round(totalTime);
  }

  /**
   * Validates that a route is still valid
   */
  async validateRoute(gtwg: GTWG, pkg: PKG, route: TravelRoute): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    
    // Check that all entities still exist
    for (const segment of route.segments) {
      if (!getEntity(gtwg, segment.from)) {
        issues.push(`Origin entity ${segment.from} no longer exists`);
      }
      if (!getEntity(gtwg, segment.to)) {
        issues.push(`Destination entity ${segment.to} no longer exists`);
      }
    }
    
    // Check player still knows about route endpoints
    if (!isEntityDiscovered(pkg, route.destination)) {
      issues.push(`Destination ${route.destination} no longer known to player`);
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a new TravelReducer with default configuration
 */
export function createTravelReducer(config?: Partial<TravelEngineConfig>): TravelReducer {
  const defaultConfig: TravelEngineConfig = {
    pathfinding: {
      algorithm: 'hierarchical',
      heuristic: 'time',
      maxDepth: 10,
      allowUnknown: false,
      preferKnown: true,
      riskTolerance: 0.5,
      optimizeFor: 'speed'
    },
    timeCalculation: {
      baseWalkingSpeed: 5, // km/h
      terrainMultipliers: {
        road: 1.0,
        path: 1.2,
        trail: 1.5,
        wilderness: 2.0,
        mountain: 3.0,
        forest: 1.8,
        swamp: 2.5,
        desert: 2.2,
        water: 0.5,
        bridge: 1.0,
        tunnel: 1.1,
        air: 0.1,
        magical: 0.8
      },
      weatherEffects: true,
      characterEffects: true,
      timeOfDayEffects: true,
      restRequirements: true
    },
    discovery: {
      enabled: true,
      personalityEffects: true,
      discoveryRadius: 100,
      landmarkVisibility: 5000,
      secretDiscoveryChance: 0.1
    },
    events: {
      enabled: true,
      frequency: 0.5,
      eventTypes: ['discovery', 'encounter', 'weather_change'],
      personalityEffects: true,
      weatherTriggers: true
    },
    performance: {
      maxRouteLength: 50,
      pathfindingTimeout: 5000,
      cacheRoutes: true,
      cacheSize: 100,
      backgroundCalculation: false
    }
  };
  
  const finalConfig = { ...defaultConfig, ...config };
  return new TravelReducer(finalConfig);
}