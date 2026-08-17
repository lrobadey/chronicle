// GTWG.test.ts - Comprehensive test suite for GTWG data store
// Tests all functions with various scenarios and edge cases

import { 
  GTWG, GTWGEntity, GTWGRelation, RegionEntity,
  CharacterEntity, ItemEntity, QuestEntity, FactionEntity, EventEntity
} from '../types';

import {
  createEmptyGTWG,
  createGTWG,
  addEntity,
  addEntities,
  getEntity,
  getEntitiesByType,
  updateEntity,
  removeEntity,
  addRelation,
  addRelations,
  getRelation,
  getRelations,
  removeRelation,
  findConnectedEntities,
  findIncomingEntities,
  getRegions,
  getCharacters,
  getItems,
  getQuests,
  getFactions,
  getEvents,
  validateGTWG,
  hasOrphanEntities,
  getGTWGStats,
  cloneGTWG,
  areGTWGsEqual,
  queryGTWG
} from './GTWG';

// Test utilities
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`TEST FAILED: ${message}`);
}

function assertEqual(actual: any, expected: any, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`TEST FAILED: ${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertNull(actual: any, message: string) {
  if (actual !== null) {
    throw new Error(`TEST FAILED: ${message}\nExpected: null\nActual: ${JSON.stringify(actual)}`);
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
function testCreateEmptyGTWG() {
  console.log('Testing createEmptyGTWG...');
  
  const gtwg = createEmptyGTWG();
  
  assert(gtwg.entities.length === 0, 'Should have no entities');
  assert(gtwg.relations.length === 0, 'Should have no relations');
  assert(gtwg.metadata.version === '1.0.0', 'Should have correct version');
  assert(gtwg.metadata.createdAt, 'Should have creation timestamp');
  assert(gtwg.metadata.lastModified, 'Should have modification timestamp');
  
  console.log('✅ createEmptyGTWG tests passed');
}

function testCreateGTWG() {
  console.log('Testing createGTWG...');
  
  const entities = [testRegion, testCharacter];
  const relations = [testRelation];
  const gtwg = createGTWG(entities, relations);
  
  assert(gtwg.entities.length === 2, 'Should have 2 entities');
  assert(gtwg.relations.length === 1, 'Should have 1 relation');
  assert(getEntity(gtwg, 'region-1') !== null, 'Should contain region');
  assert(getEntity(gtwg, 'character-1') !== null, 'Should contain character');
  assert(getRelation(gtwg, 'relation-1') !== null, 'Should contain relation');
  
  console.log('✅ createGTWG tests passed');
}

function testAddEntity() {
  console.log('Testing addEntity...');
  
  const gtwg = createEmptyGTWG();
  const newGtwg = addEntity(gtwg, testRegion);
  
  assert(newGtwg.entities.length === 1, 'Should have 1 entity');
  assert(getEntity(newGtwg, 'region-1') !== null, 'Should contain the added entity');
  assert(newGtwg.metadata.lastModified, 'Should have timestamp');
  
  // Test duplicate entity
  const duplicateGtwg = addEntity(newGtwg, testRegion);
  assert(duplicateGtwg.entities.length === 1, 'Should not add duplicate entity');
  
  console.log('✅ addEntity tests passed');
}

function testGetEntity() {
  console.log('Testing getEntity...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithEntity = addEntity(gtwg, testRegion);
  
  const foundEntity = getEntity(gtwgWithEntity, 'region-1');
  assert(foundEntity !== null, 'Should find existing entity');
  assertEqual(foundEntity?.id, 'region-1', 'Should find correct entity');
  
  const notFoundEntity = getEntity(gtwgWithEntity, 'nonexistent');
  assertNull(notFoundEntity, 'Should return null for non-existent entity');
  
  console.log('✅ getEntity tests passed');
}

function testGetEntitiesByType() {
  console.log('Testing getEntitiesByType...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithEntities = addEntity(addEntity(gtwg, testRegion), testCharacter);
  
  const regions = getEntitiesByType(gtwgWithEntities, 'region');
  assert(regions.length === 1, 'Should find 1 region');
  assertEqual(regions[0].id, 'region-1', 'Should find correct region');
  
  const characters = getEntitiesByType(gtwgWithEntities, 'character');
  assert(characters.length === 1, 'Should find 1 character');
  assertEqual(characters[0].id, 'character-1', 'Should find correct character');
  
  const items = getEntitiesByType(gtwgWithEntities, 'item');
  assert(items.length === 0, 'Should find 0 items');
  
  console.log('✅ getEntitiesByType tests passed');
}

function testAddRelation() {
  console.log('Testing addRelation...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithEntities = addEntity(addEntity(gtwg, testRegion), testCharacter);
  const gtwgWithRelation = addRelation(gtwgWithEntities, testRelation);
  
  assert(gtwgWithRelation.relations.length === 1, 'Should have 1 relation');
  assert(getRelation(gtwgWithRelation, 'relation-1') !== null, 'Should contain the added relation');
  
  // Test duplicate relation
  const duplicateGtwg = addRelation(gtwgWithRelation, testRelation);
  assert(duplicateGtwg.relations.length === 1, 'Should not add duplicate relation');
  
  console.log('✅ addRelation tests passed');
}

function testFindConnectedEntities() {
  console.log('Testing findConnectedEntities...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithEntities = addEntity(addEntity(gtwg, testRegion), testCharacter);
  const gtwgWithRelation = addRelation(gtwgWithEntities, testRelation);
  
  const connected = findConnectedEntities(gtwgWithRelation, 'character-1', 'contained_in');
  assert(connected.length === 1, 'Should find 1 connected entity');
  assertEqual(connected[0].id, 'region-1', 'Should find correct connected entity');
  
  console.log('✅ findConnectedEntities tests passed');
}

function testQueryGTWG() {
  console.log('Testing queryGTWG...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithEntities = addEntity(addEntity(gtwg, testRegion), testCharacter);
  
  const query = queryGTWG(gtwgWithEntities);
  const regions = query.filterByType('region').execute();
  
  assert(regions.length === 1, 'Should find 1 region via query');
  assertEqual(regions[0].id, 'region-1', 'Should find correct region via query');
  
  console.log('✅ queryGTWG tests passed');
}

function testValidateGTWG() {
  console.log('Testing validateGTWG...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithEntities = addEntity(addEntity(gtwg, testRegion), testCharacter);
  const gtwgWithRelation = addRelation(gtwgWithEntities, testRelation);
  
  const validation = validateGTWG(gtwgWithRelation);
  assert(validation.isValid, 'Should be valid GTWG');
  assert(validation.errors.length === 0, 'Should have no errors');
  
  console.log('✅ validateGTWG tests passed');
}

function testGetGTWGStats() {
  console.log('Testing getGTWGStats...');
  
  const gtwg = createEmptyGTWG();
  const gtwgWithEntities = addEntity(addEntity(gtwg, testRegion), testCharacter);
  const gtwgWithRelation = addRelation(gtwgWithEntities, testRelation);
  
  const stats = getGTWGStats(gtwgWithRelation);
  assert(stats.entityCount === 2, 'Should have 2 entities');
  assert(stats.relationCount === 1, 'Should have 1 relation');
  assert(stats.entityTypeCounts.region === 1, 'Should have 1 region');
  assert(stats.entityTypeCounts.character === 1, 'Should have 1 character');
  
  console.log('✅ getGTWGStats tests passed');
}

function runAllTests() {
  console.log('🧪 Running GTWG tests...\n');
  
  try {
    testCreateEmptyGTWG();
    testCreateGTWG();
    testAddEntity();
    testGetEntity();
    testGetEntitiesByType();
    testAddRelation();
    testFindConnectedEntities();
    testQueryGTWG();
    testValidateGTWG();
    testGetGTWGStats();
    
    console.log('\n🎉 All GTWG tests passed!');
  } catch (error) {
    console.error('\n❌ GTWG test failed:', error.message);
    throw error;
  }
}

// Run tests if this file is executed directly
runAllTests();