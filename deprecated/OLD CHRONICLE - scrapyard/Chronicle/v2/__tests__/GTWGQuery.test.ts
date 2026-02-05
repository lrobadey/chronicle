// GTWGQuery.test.ts - Test suite for the GTWGQuery fluent query builder
// Tests the composable query functionality

import { GTWG, GTWGEntity, GTWGRelation, RegionEntity, CharacterEntity, ItemEntity } from '../types';
import { GTWGQuery } from './GTWGQuery';
import { createEmptyGTWG, addEntity, addRelation } from './GTWG';

// Test utilities
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`TEST FAILED: ${message}`);
}

function assertEqual(actual: any, expected: any, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`TEST FAILED: ${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertLength(actual: any[], expectedLength: number, message: string) {
  if (actual.length !== expectedLength) {
    throw new Error(`TEST FAILED: ${message}\nExpected length: ${expectedLength}\nActual length: ${actual.length}`);
  }
}

// Test data
const testRegion: RegionEntity = {
  id: 'region-1',
  type: 'region',
  name: 'Test Region',
  properties: {
    description: 'A test region',
    regionType: 'building',
    climate: 'temperate',
    areaKm2: 1000,
    dangerLevel: 'safe',
  },
};

const testCharacter: CharacterEntity = {
  id: 'character-1',
  type: 'character',
  name: 'Test Character',
  properties: {
    description: 'A test character',
    characterType: 'npc',
    status: 'alive',
    health: 100,
    skills: { combat: 5, diplomacy: 3 },
  },
};

const testItem: ItemEntity = {
  id: 'item-1',
  type: 'item',
  name: 'Test Item',
  properties: {
    description: 'A test item',
    itemType: 'weapon',
    rarity: 'common',
    value: 50,
    weight: 2,
  },
};

const testRelation: GTWGRelation = {
  id: 'relation-1',
  type: 'contained_in',
  from: 'character-1',
  to: 'region-1',
};

// Test functions
function testQueryBuilderBasic() {
  console.log('Testing basic query builder functionality...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithData = addEntity(addEntity(addEntity(gtwg, testRegion), testCharacter), testItem);
  const gtwgWithRelation = addRelation(gtwgWithData, testRelation);
  
  const query = new GTWGQuery(gtwgWithRelation);
  
  // Test basic filtering by type
  const regions = query.filterByType('region').execute();
  assertLength(regions, 1, 'Should find 1 region');
  assertEqual(regions[0].id, 'region-1', 'Should find the correct region');
  
  const characters = query.filterByType('character').execute();
  assertLength(characters, 1, 'Should find 1 character');
  assertEqual(characters[0].id, 'character-1', 'Should find the correct character');
  
  const items = query.filterByType('item').execute();
  assertLength(items, 1, 'Should find 1 item');
  assertEqual(items[0].id, 'item-1', 'Should find the correct item');
  
  console.log('✅ Basic query builder tests passed');
}

function testQueryBuilderPropertyFiltering() {
  console.log('Testing property filtering...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithData = addEntity(addEntity(addEntity(gtwg, testRegion), testCharacter), testItem);
  
  const query = new GTWGQuery(gtwgWithData);
  
  // Test filtering by exact property value
  const buildingRegions = query.filterByType('region').filterByProperty('regionType', 'building').execute();
  assertLength(buildingRegions, 1, 'Should find 1 building region');
  
  // Test filtering by property with predicate function
  const expensiveItems = query.filterByType('item').filterByProperty('value', (value: number) => value > 25).execute();
  assertLength(expensiveItems, 1, 'Should find 1 expensive item');
  
  // Test filtering by array of values
  const characterTypes = query.filterByType('character').filterByProperty('characterType', ['npc', 'player']).execute();
  assertLength(characterTypes, 1, 'Should find 1 character with matching type');
  
  // Test filtering by nested property
  const safeRegions = query.filterByType('region').filterByProperty('dangerLevel', 'safe').execute();
  assertLength(safeRegions, 1, 'Should find 1 safe region');
  
  console.log('✅ Property filtering tests passed');
}

function testQueryBuilderGraphTraversal() {
  console.log('Testing graph traversal...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithData = addEntity(addEntity(addEntity(gtwg, testRegion), testCharacter), testItem);
  const gtwgWithRelation = addRelation(gtwgWithData, testRelation);
  
  const query = new GTWGQuery(gtwgWithRelation);
  
  // Test outgoing connections
  const characterConnections = query
    .filterByType('character')
    .getConnected('contained_in')
    .execute();
  assertLength(characterConnections, 1, 'Should find 1 region connected to character');
  assertEqual(characterConnections[0].id, 'region-1', 'Should find the correct connected region');
  
  // Test incoming connections
  const regionContents = query
    .filterByType('region')
    .getConnected('contained_in', 'in')
    .execute();
  assertLength(regionContents, 1, 'Should find 1 character in the region');
  assertEqual(regionContents[0].id, 'character-1', 'Should find the correct character in region');
  
  // Test bidirectional connections
  const allConnected = query
    .filterByType('character')
    .getConnected('contained_in', 'both')
    .execute();
  assertLength(allConnected, 1, 'Should find 1 connected entity in both directions');
  
  console.log('✅ Graph traversal tests passed');
}

function testQueryBuilderComposition() {
  console.log('Testing query composition...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithData = addEntity(addEntity(addEntity(gtwg, testRegion), testCharacter), testItem);
  const gtwgWithRelation = addRelation(gtwgWithData, testRelation);
  
  const query = new GTWGQuery(gtwgWithRelation);
  
  // Test chaining multiple filters
  const result = query
    .filterByType('character')
    .filterByProperty('status', 'alive')
    .getConnected('contained_in')
    .filterByProperty('regionType', 'building')
    .execute();
  
  assertLength(result, 1, 'Should find 1 building region containing alive character');
  assertEqual(result[0].id, 'region-1', 'Should find the correct building region');
  
  // Test complex composition
  const complexResult = query
    .filterByType('region')
    .filterByProperty('dangerLevel', 'safe')
    .filterByProperty('climate', 'temperate')
    .execute();
  
  assertLength(complexResult, 1, 'Should find 1 safe, temperate region');
  
  console.log('✅ Query composition tests passed');
}

function testQueryBuilderEdgeCases() {
  console.log('Testing edge cases...');
  
  const gtwg = createEmptyGTWG();
  const query = new GTWGQuery(gtwg);
  
  // Test empty GTWG
  const emptyResult = query.filterByType('region').execute();
  assertLength(emptyResult, 0, 'Should return empty array for empty GTWG');
  
  // Test non-existent type
  const nonExistentResult = query.filterByType('nonexistent' as any).execute();
  assertLength(nonExistentResult, 0, 'Should return empty array for non-existent type');
  
  // Test non-existent property
  const nonExistentPropertyResult = query.filterByProperty('nonexistent', 'value').execute();
  assertLength(nonExistentPropertyResult, 0, 'Should return empty array for non-existent property');
  
  // Test with data but no matches
  const gtwgWithData = addEntity(gtwg, testRegion);
  const queryWithData = new GTWGQuery(gtwgWithData);
  
  const noMatchResult = queryWithData.filterByProperty('regionType', 'nonexistent').execute();
  assertLength(noMatchResult, 0, 'Should return empty array when no matches found');
  
  console.log('✅ Edge case tests passed');
}

function testQueryBuilderPerformance() {
  console.log('Testing query builder performance...');
  
  // Create a larger dataset
  const gtwg = createEmptyGTWG();
  let currentGtwg = gtwg;
  
  // Add 100 regions
  for (let i = 0; i < 100; i++) {
    const region: RegionEntity = {
      id: `region-${i}`,
      type: 'region',
      name: `Region ${i}`,
      properties: {
        description: `Region ${i}`,
        regionType: i % 2 === 0 ? 'building' : 'room',
        climate: i % 3 === 0 ? 'temperate' : 'cold',
        dangerLevel: i % 4 === 0 ? 'safe' : 'wild',
      },
    };
    currentGtwg = addEntity(currentGtwg, region);
  }
  
  const query = new GTWGQuery(currentGtwg);
  
  // Test performance of complex query
  const startTime = Date.now();
  const result = query
    .filterByType('region')
    .filterByProperty('regionType', 'building')
    .filterByProperty('climate', 'temperate')
    .filterByProperty('dangerLevel', 'safe')
    .execute();
  const endTime = Date.now();
  
  const executionTime = endTime - startTime;
  assert(executionTime < 100, `Query should execute quickly (${executionTime}ms)`);
  assertLength(result, 9, 'Should find correct number of matching regions'); // 100/2/3/4 = ~9 (actual calculation)
  
  console.log('✅ Performance tests passed');
}

function runAllQueryTests() {
  console.log('🧪 Running GTWGQuery tests...\n');
  
  try {
    testQueryBuilderBasic();
    testQueryBuilderPropertyFiltering();
    testQueryBuilderGraphTraversal();
    testQueryBuilderComposition();
    testQueryBuilderEdgeCases();
    testQueryBuilderPerformance();
    
    console.log('\n🎉 All GTWGQuery tests passed!');
  } catch (error) {
    console.error('\n❌ GTWGQuery test failed:', error.message);
    throw error;
  }
}

// Export for external use
export { runAllQueryTests };

// Run tests if this file is executed directly
runAllQueryTests(); 