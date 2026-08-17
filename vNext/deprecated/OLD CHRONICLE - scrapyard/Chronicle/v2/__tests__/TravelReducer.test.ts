// TravelReducer.test.ts - V2 Travel System Tests
// ===============================================

import { TravelReducer, createTravelReducer } from '../travel/TravelReducer';
import { createEmptyGTWG, addEntity, addRelation, createExampleDynamicRegions } from '../data/GTWG';
import { createEmptyPKG, addDiscoveredFact, isEntityDiscovered } from '../data/PKG';
import { GTWG, GTWGEntity, GTWGRelation, RegionEntity } from '../types/GTWGTypes.js';

describe('TravelReducer V2 System', () => {
  let travelReducer: TravelReducer;
  let gtwg: GTWG;
  let pkg: ReturnType<typeof createEmptyPKG>;

  beforeEach(() => {
    // Create V2 travel system
    travelReducer = createTravelReducer();
    
    // Create test world with dynamic regions
    gtwg = createExampleDynamicRegions();
    
    // Create test PKG with some discovered locations
    pkg = createEmptyPKG();
    pkg = addDiscoveredFact(pkg, {
      entityId: 'city-1',
      discoveredAt: new Date().toISOString(),
      source: 'starting_location'
    });
    pkg = addDiscoveredFact(pkg, {
      entityId: 'academy-1',
      discoveredAt: new Date().toISOString(),
      source: 'exploration'
    });
  });

  describe('Route Calculation', () => {
    test('should calculate route between known locations', async () => {
      const result = await travelReducer.calculateRoute(
        gtwg, 
        pkg, 
        'city-1', 
        'academy-1'
      );

      expect(result.success).toBe(true);
      expect(result.route).toBeDefined();
      expect(result.route!.origin).toBe('city-1');
      expect(result.route!.destination).toBe('academy-1');
      expect(result.route!.segments.length).toBeGreaterThan(0);
      expect(result.computationTime).toBeGreaterThan(0);
    });

    test('should fail for unknown destinations', async () => {
      const result = await travelReducer.calculateRoute(
        gtwg, 
        pkg, 
        'city-1', 
        'unknown-location'
      );

      expect(result.success).toBe(false);
      expect(result.blockedReasons).toContain('Destination entity unknown-location not found');
    });

    test('should fail for undiscovered destinations', async () => {
      // Add a location to GTWG but not PKG
      const newRegion: RegionEntity = {
        id: 'secret-cave',
        type: 'region',
        name: 'Secret Cave',
        properties: {
          description: 'A hidden cave',
          regionType: 'cave'
        }
      };
      gtwg = addEntity(gtwg, newRegion);

      const result = await travelReducer.calculateRoute(
        gtwg, 
        pkg, 
        'city-1', 
        'secret-cave'
      );

      expect(result.success).toBe(false);
      expect(result.blockedReasons).toContain('Destination secret-cave is unknown to player');
    });

    test('should handle same location routing', async () => {
      const result = await travelReducer.calculateRoute(
        gtwg, 
        pkg, 
        'city-1', 
        'city-1'
      );

      expect(result.success).toBe(true);
      expect(result.route!.segments.length).toBe(0);
      expect(result.route!.totalDistance).toBe(0);
    });
  });

  describe('Time Calculation', () => {
    test('should calculate realistic travel times', async () => {
      const result = await travelReducer.calculateRoute(
        gtwg, 
        pkg, 
        'city-1', 
        'academy-1'
      );

      expect(result.success).toBe(true);
      expect(result.route!.estimatedTime).toBeGreaterThan(0);
      
      // Should be reasonable time (not too fast or slow)
      expect(result.route!.estimatedTime).toBeLessThan(1000); // Less than 1000 minutes
      expect(result.route!.estimatedTime).toBeGreaterThan(0.1); // More than 0.1 minutes
    });

    test('should apply modifiers to travel time', () => {
      const mockRoute = {
        id: 'test-route',
        origin: 'city-1',
        destination: 'academy-1',
        segments: [],
        totalDistance: 1000,
        estimatedTime: 60, // 1 hour base time
        routeType: 'direct' as any,
        createdAt: new Date().toISOString(),
        calculatedBy: 'system' as any
      };

      // Test weather modifier
      const modifiers = {
        weather: {
          weatherType: 'rain',
          intensity: 3,
          timeMultiplier: 1.5, // 50% slower in rain
          difficultyIncrease: 1,
          blockedRoutes: []
        }
      } as any;

      const modifiedTime = travelReducer.estimateTravelTime(mockRoute, modifiers);
      expect(modifiedTime).toBe(90); // 60 * 1.5 = 90 minutes
    });
  });

  describe('Route Validation', () => {
    test('should validate existing routes', async () => {
      const result = await travelReducer.calculateRoute(
        gtwg, 
        pkg, 
        'city-1', 
        'academy-1'
      );

      expect(result.success).toBe(true);
      
      const validation = await travelReducer.validateRoute(gtwg, pkg, result.route!);
      expect(validation.valid).toBe(true);
      expect(validation.issues.length).toBe(0);
    });

    test('should detect invalid routes', async () => {
      const invalidRoute = {
        id: 'invalid-route',
        origin: 'nonexistent-1',
        destination: 'nonexistent-2',
        segments: [{
          id: 'invalid-segment',
          from: 'nonexistent-1',
          to: 'nonexistent-2',
          segmentType: 'connection' as any,
          distance: 100,
          baseTime: 10,
          terrain: 'path' as any,
          difficulty: 'easy' as any
        }],
        totalDistance: 100,
        estimatedTime: 10,
        routeType: 'direct' as any,
        createdAt: new Date().toISOString(),
        calculatedBy: 'system' as any
      };

      const validation = await travelReducer.validateRoute(gtwg, pkg, invalidRoute);
      expect(validation.valid).toBe(false);
      expect(validation.issues.length).toBeGreaterThan(0);
    });
  });

  describe('Configuration', () => {
    test('should create reducer with default config', () => {
      const reducer = createTravelReducer();
      expect(reducer).toBeInstanceOf(TravelReducer);
    });

    test('should create reducer with custom config', () => {
      const customConfig = {
        pathfinding: {
          algorithm: 'astar' as any,
          maxDepth: 5
        },
        performance: {
          cacheRoutes: false,
          maxRouteLength: 20
        }
      };

      const reducer = createTravelReducer(customConfig);
      expect(reducer).toBeInstanceOf(TravelReducer);
    });
  });

  describe('Performance', () => {
    test('should complete route calculation quickly', async () => {
      const startTime = Date.now();
      
      const result = await travelReducer.calculateRoute(
        gtwg, 
        pkg, 
        'city-1', 
        'academy-1'
      );
      
      const endTime = Date.now();
      const actualTime = endTime - startTime;

      expect(result.success).toBe(true);
      expect(actualTime).toBeLessThan(100); // Should complete in under 100ms
      expect(result.computationTime).toBeGreaterThan(0);
    });

    test('should use route caching', async () => {
      // First calculation
      const result1 = await travelReducer.calculateRoute(
        gtwg, 
        pkg, 
        'city-1', 
        'academy-1'
      );

      // Second calculation (should use cache)
      const result2 = await travelReducer.calculateRoute(
        gtwg, 
        pkg, 
        'city-1', 
        'academy-1'
      );

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result2.algorithmUsed).toBe('cached');
      expect(result2.computationTime).toBeLessThan(result1.computationTime);
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('V2 System Integration', () => {
  test('should integrate with GTWG dynamic regions', () => {
    const gtwg = createExampleDynamicRegions();
    const travelReducer = createTravelReducer();
    
    // Should handle LLM-generated region types
    const magicAcademy = gtwg.entities.find(e => e.id === 'academy-1');
    expect(magicAcademy).toBeDefined();
    expect((magicAcademy as RegionEntity).properties.regionType).toBe('magic_academy');
    expect((magicAcademy as RegionEntity).properties.llmGenerated).toBe(true);
  });

  test('should integrate with PKG knowledge system', () => {
    const pkg = createEmptyPKG();
    const updatedPkg = addDiscoveredFact(pkg, {
      entityId: 'test-location',
      discoveredAt: new Date().toISOString(),
      source: 'exploration'
    });
    
    expect(updatedPkg.discoveredFacts.length).toBe(1);
    expect(updatedPkg.discoveredFacts[0].entityId).toBe('test-location');
  });
});

console.log('✅ V2 Travel System Tests Ready');
console.log('🚀 Pure V2 Architecture - Zero V1 Dependencies');
console.log('🧪 Comprehensive Test Coverage for Travel System');