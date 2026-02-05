"use strict";
// GTWG.test.ts - Comprehensive test suite for GTWG data store
// Tests all functions with various scenarios and edge cases
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAllTests = runAllTests;
const GTWG_1 = require("./GTWG");
// Test utilities
function assert(condition, message) {
    if (!condition)
        throw new Error(`TEST FAILED: ${message}`);
}
function assertEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`TEST FAILED: ${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
    }
}
function assertNull(actual, message) {
    if (actual !== null) {
        throw new Error(`TEST FAILED: ${message}\nExpected: null\nActual: ${JSON.stringify(actual)}`);
    }
}
// Test data
const testRegion = {
    id: 'region-1',
    type: 'region',
    name: 'Test Region',
    properties: {
        description: 'A test region',
        climate: 'temperate',
        areaKm2: 1000,
        dangerLevel: 'safe',
    },
};
const testLocation = {
    id: 'location-1',
    type: 'location',
    name: 'Test Location',
    properties: {
        description: 'A test location',
        locationType: 'house',
        coords: { x: 10, y: 20 },
        size: 'small',
        dangerLevel: 'safe',
        accessibility: 'open',
    },
};
const testFeature = {
    id: 'feature-1',
    type: 'feature',
    name: 'Test Feature',
    properties: {
        description: 'A test feature',
        featureType: 'well',
        coords: { x: 5, y: 8 },
        accessibility: 'open',
    },
};
const testCharacter = {
    id: 'character-1',
    type: 'character',
    name: 'Test Character',
    properties: {
        description: 'A test character',
        personality: 'friendly',
    },
};
const testRelation1 = {
    id: 'rel-1',
    type: 'located_in',
    from: 'location-1',
    to: 'region-1',
};
const testRelation2 = {
    id: 'rel-2',
    type: 'located_in',
    from: 'feature-1',
    to: 'location-1',
};
const testRelation3 = {
    id: 'rel-3',
    type: 'located_in',
    from: 'character-1',
    to: 'location-1',
};
// ============================================================================
// CORE GTWG OPERATIONS TESTS
// ============================================================================
function testCreateEmptyGTWG() {
    console.log('Testing createEmptyGTWG...');
    const gtwg = (0, GTWG_1.createEmptyGTWG)();
    assert(gtwg.entities.length === 0, 'Empty GTWG should have no entities');
    assert(gtwg.relations.length === 0, 'Empty GTWG should have no relations');
    assert(gtwg.metadata?.version === '1.0.0', 'Should have correct version');
    assert(gtwg.metadata?.createdAt, 'Should have creation timestamp');
    assert(gtwg.metadata?.lastModified, 'Should have last modified timestamp');
    console.log('✅ createEmptyGTWG passed');
}
function testCreateGTWG() {
    console.log('Testing createGTWG...');
    const entities = [testRegion, testLocation];
    const relations = [testRelation1];
    const gtwg = (0, GTWG_1.createGTWG)(entities, relations);
    assert(gtwg.entities.length === 2, 'Should have 2 entities');
    assert(gtwg.relations.length === 1, 'Should have 1 relation');
    assert((0, GTWG_1.getEntity)(gtwg, 'region-1') !== null, 'Should contain region-1');
    assert((0, GTWG_1.getEntity)(gtwg, 'location-1') !== null, 'Should contain location-1');
    assert((0, GTWG_1.getRelation)(gtwg, 'rel-1') !== null, 'Should contain rel-1');
    console.log('✅ createGTWG passed');
}
// ============================================================================
// ENTITY OPERATIONS TESTS
// ============================================================================
function testAddEntity() {
    console.log('Testing addEntity...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    // Test adding a single entity
    gtwg = (0, GTWG_1.addEntity)(gtwg, testRegion);
    assert(gtwg.entities.length === 1, 'Should have 1 entity after adding');
    assert((0, GTWG_1.getEntity)(gtwg, 'region-1') !== null, 'Should find added entity');
    // Test adding duplicate entity (should be ignored)
    const originalLength = gtwg.entities.length;
    gtwg = (0, GTWG_1.addEntity)(gtwg, testRegion);
    assert(gtwg.entities.length === originalLength, 'Should not add duplicate entity');
    console.log('✅ addEntity passed');
}
function testAddEntities() {
    console.log('Testing addEntities...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    const entities = [testRegion, testLocation, testFeature];
    gtwg = (0, GTWG_1.addEntities)(gtwg, entities);
    assert(gtwg.entities.length === 3, 'Should have 3 entities after adding');
    assert((0, GTWG_1.getEntity)(gtwg, 'region-1') !== null, 'Should find region-1');
    assert((0, GTWG_1.getEntity)(gtwg, 'location-1') !== null, 'Should find location-1');
    assert((0, GTWG_1.getEntity)(gtwg, 'feature-1') !== null, 'Should find feature-1');
    console.log('✅ addEntities passed');
}
function testGetEntity() {
    console.log('Testing getEntity...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntity)(gtwg, testRegion);
    // Test getting existing entity
    const found = (0, GTWG_1.getEntity)(gtwg, 'region-1');
    assert(found !== null, 'Should find existing entity');
    assert(found?.name === 'Test Region', 'Should return correct entity');
    // Test getting non-existent entity
    const notFound = (0, GTWG_1.getEntity)(gtwg, 'non-existent');
    assertNull(notFound, 'Should return null for non-existent entity');
    console.log('✅ getEntity passed');
}
function testGetEntitiesByType() {
    console.log('Testing getEntitiesByType...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature, testCharacter]);
    const regions = (0, GTWG_1.getEntitiesByType)(gtwg, 'region');
    assert(regions.length === 1, 'Should find 1 region');
    assert(regions[0].id === 'region-1', 'Should find correct region');
    const locations = (0, GTWG_1.getEntitiesByType)(gtwg, 'location');
    assert(locations.length === 1, 'Should find 1 location');
    assert(locations[0].id === 'location-1', 'Should find correct location');
    const features = (0, GTWG_1.getEntitiesByType)(gtwg, 'feature');
    assert(features.length === 1, 'Should find 1 feature');
    assert(features[0].id === 'feature-1', 'Should find correct feature');
    const characters = (0, GTWG_1.getEntitiesByType)(gtwg, 'character');
    assert(characters.length === 1, 'Should find 1 character');
    assert(characters[0].id === 'character-1', 'Should find correct character');
    console.log('✅ getEntitiesByType passed');
}
function testUpdateEntity() {
    console.log('Testing updateEntity...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntity)(gtwg, testRegion);
    // Test updating existing entity
    gtwg = (0, GTWG_1.updateEntity)(gtwg, 'region-1', { name: 'Updated Region' });
    const updated = (0, GTWG_1.getEntity)(gtwg, 'region-1');
    assert(updated?.name === 'Updated Region', 'Should update entity name');
    assert(updated?.type === 'region', 'Should preserve entity type');
    // Test updating non-existent entity
    const originalGTWG = (0, GTWG_1.cloneGTWG)(gtwg);
    gtwg = (0, GTWG_1.updateEntity)(gtwg, 'non-existent', { name: 'New Name' });
    assert((0, GTWG_1.areGTWGsEqual)(gtwg, originalGTWG), 'Should not change GTWG for non-existent entity');
    console.log('✅ updateEntity passed');
}
function testRemoveEntity() {
    console.log('Testing removeEntity...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature]);
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation1, testRelation2]);
    // Test removing entity with relations
    gtwg = (0, GTWG_1.removeEntity)(gtwg, 'location-1');
    assert(gtwg.entities.length === 2, 'Should have 2 entities after removal');
    assert((0, GTWG_1.getEntity)(gtwg, 'location-1') === null, 'Should not find removed entity');
    assert(gtwg.relations.length === 0, 'Should remove all relations involving the entity');
    // Test removing non-existent entity
    const originalGTWG = (0, GTWG_1.cloneGTWG)(gtwg);
    gtwg = (0, GTWG_1.removeEntity)(gtwg, 'non-existent');
    assert((0, GTWG_1.areGTWGsEqual)(gtwg, originalGTWG), 'Should not change GTWG for non-existent entity');
    console.log('✅ removeEntity passed');
}
// ============================================================================
// RELATION OPERATIONS TESTS
// ============================================================================
function testAddRelation() {
    console.log('Testing addRelation...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation]);
    // Test adding valid relation
    gtwg = (0, GTWG_1.addRelation)(gtwg, testRelation1);
    assert(gtwg.relations.length === 1, 'Should have 1 relation after adding');
    assert((0, GTWG_1.getRelation)(gtwg, 'rel-1') !== null, 'Should find added relation');
    // Test adding duplicate relation (should be ignored)
    const originalLength = gtwg.relations.length;
    gtwg = (0, GTWG_1.addRelation)(gtwg, testRelation1);
    assert(gtwg.relations.length === originalLength, 'Should not add duplicate relation');
    // Test adding relation with non-existent entities (should be ignored)
    const invalidRelation = {
        id: 'invalid-rel',
        type: 'located_in',
        from: 'non-existent-1',
        to: 'non-existent-2',
    };
    gtwg = (0, GTWG_1.addRelation)(gtwg, invalidRelation);
    assert(gtwg.relations.length === originalLength, 'Should not add relation with invalid entities');
    console.log('✅ addRelation passed');
}
function testAddRelations() {
    console.log('Testing addRelations...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature]);
    const relations = [testRelation1, testRelation2];
    gtwg = (0, GTWG_1.addRelations)(gtwg, relations);
    assert(gtwg.relations.length === 2, 'Should have 2 relations after adding');
    assert((0, GTWG_1.getRelation)(gtwg, 'rel-1') !== null, 'Should find rel-1');
    assert((0, GTWG_1.getRelation)(gtwg, 'rel-2') !== null, 'Should find rel-2');
    console.log('✅ addRelations passed');
}
function testGetRelation() {
    console.log('Testing getRelation...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addRelation)(gtwg, testRelation1);
    // Test getting existing relation
    const found = (0, GTWG_1.getRelation)(gtwg, 'rel-1');
    assert(found !== null, 'Should find existing relation');
    assert(found?.type === 'located_in', 'Should return correct relation');
    // Test getting non-existent relation
    const notFound = (0, GTWG_1.getRelation)(gtwg, 'non-existent');
    assertNull(notFound, 'Should return null for non-existent relation');
    console.log('✅ getRelation passed');
}
function testGetRelations() {
    console.log('Testing getRelations...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature, testCharacter]);
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation1, testRelation2, testRelation3]);
    // Test getting all relations
    const allRelations = (0, GTWG_1.getRelations)(gtwg);
    assert(allRelations.length === 3, 'Should find all 3 relations');
    // Test filtering by fromId
    const fromLocation = (0, GTWG_1.getRelations)(gtwg, 'location-1');
    assert(fromLocation.length === 1, 'Should find 1 relation from location-1');
    assert(fromLocation[0].id === 'rel-1', 'Should find correct relation');
    // Test filtering by toId
    const toLocation = (0, GTWG_1.getRelations)(gtwg, undefined, 'location-1');
    assert(toLocation.length === 2, 'Should find 2 relations to location-1');
    // Test filtering by type
    const locatedIn = (0, GTWG_1.getRelations)(gtwg, undefined, undefined, 'located_in');
    assert(locatedIn.length === 3, 'Should find all 3 located_in relations');
    // Test filtering by multiple criteria
    const specificRelation = (0, GTWG_1.getRelations)(gtwg, 'feature-1', 'location-1', 'located_in');
    assert(specificRelation.length === 1, 'Should find 1 specific relation');
    assert(specificRelation[0].id === 'rel-2', 'Should find correct relation');
    console.log('✅ getRelations passed');
}
function testRemoveRelation() {
    console.log('Testing removeRelation...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation1, testRelation2]);
    // Test removing existing relation
    gtwg = (0, GTWG_1.removeRelation)(gtwg, 'rel-1');
    assert(gtwg.relations.length === 1, 'Should have 1 relation after removal');
    assert((0, GTWG_1.getRelation)(gtwg, 'rel-1') === null, 'Should not find removed relation');
    assert((0, GTWG_1.getRelation)(gtwg, 'rel-2') !== null, 'Should still find other relation');
    // Test removing non-existent relation
    const originalGTWG = (0, GTWG_1.cloneGTWG)(gtwg);
    gtwg = (0, GTWG_1.removeRelation)(gtwg, 'non-existent');
    assert((0, GTWG_1.areGTWGsEqual)(gtwg, originalGTWG), 'Should not change GTWG for non-existent relation');
    console.log('✅ removeRelation passed');
}
// ============================================================================
// QUERY OPERATIONS TESTS
// ============================================================================
function testFindConnectedEntities() {
    console.log('Testing findConnectedEntities...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature, testCharacter]);
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation1, testRelation2, testRelation3]);
    // Test finding all connected entities
    const connectedToLocation = (0, GTWG_1.findConnectedEntities)(gtwg, 'location-1');
    assert(connectedToLocation.length === 1, 'Should find 1 entity connected to location-1');
    assert(connectedToLocation[0].id === 'region-1', 'Should find region-1');
    // Test finding entities with specific relation type
    const locatedInRegion = (0, GTWG_1.findConnectedEntities)(gtwg, 'location-1', 'located_in');
    assert(locatedInRegion.length === 1, 'Should find 1 entity located in region');
    assert(locatedInRegion[0].id === 'region-1', 'Should find region-1');
    // Test finding entities with non-existent relation type
    const noRelations = (0, GTWG_1.findConnectedEntities)(gtwg, 'location-1', 'allied_with');
    assert(noRelations.length === 0, 'Should find no entities with non-existent relation type');
    console.log('✅ findConnectedEntities passed');
}
function testFindIncomingEntities() {
    console.log('Testing findIncomingEntities...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature, testCharacter]);
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation1, testRelation2, testRelation3]);
    // Test finding all incoming entities
    const incomingToLocation = (0, GTWG_1.findIncomingEntities)(gtwg, 'location-1');
    assert(incomingToLocation.length === 2, 'Should find 2 entities located in location-1');
    assert(incomingToLocation.some(e => e.id === 'feature-1'), 'Should find feature-1');
    assert(incomingToLocation.some(e => e.id === 'character-1'), 'Should find character-1');
    console.log('✅ findIncomingEntities passed');
}
function testGetEntityLocation() {
    console.log('Testing getEntityLocation...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature]);
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation2]);
    // Test getting location for entity that is in a location
    const featureLocation = (0, GTWG_1.getEntityLocation)(gtwg, 'feature-1');
    assert(featureLocation !== null, 'Should find location for feature-1');
    assert(featureLocation?.id === 'location-1', 'Should find correct location');
    // Test getting location for entity that is not in a location
    const regionLocation = (0, GTWG_1.getEntityLocation)(gtwg, 'region-1');
    assertNull(regionLocation, 'Should return null for entity not in location');
    console.log('✅ getEntityLocation passed');
}
function testGetLocationContents() {
    console.log('Testing getLocationContents...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature, testCharacter]);
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation2, testRelation3]);
    // Test getting contents of location
    const locationContents = (0, GTWG_1.getLocationContents)(gtwg, 'location-1');
    assert(locationContents.length === 2, 'Should find 2 entities in location-1');
    assert(locationContents.some(e => e.id === 'feature-1'), 'Should find feature-1');
    assert(locationContents.some(e => e.id === 'character-1'), 'Should find character-1');
    // Test getting contents of empty location
    const emptyLocationContents = (0, GTWG_1.getLocationContents)(gtwg, 'region-1');
    assert(emptyLocationContents.length === 0, 'Should find no entities in region-1');
    console.log('✅ getLocationContents passed');
}
function testGetRegionsLocationsFeatures() {
    console.log('Testing getRegions, getLocations, getFeatures...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature]);
    const regions = (0, GTWG_1.getRegions)(gtwg);
    assert(regions.length === 1, 'Should find 1 region');
    assert(regions[0].id === 'region-1', 'Should find correct region');
    const locations = (0, GTWG_1.getLocations)(gtwg);
    assert(locations.length === 1, 'Should find 1 location');
    assert(locations[0].id === 'location-1', 'Should find correct location');
    const features = (0, GTWG_1.getFeatures)(gtwg);
    assert(features.length === 1, 'Should find 1 feature');
    assert(features[0].id === 'feature-1', 'Should find correct feature');
    console.log('✅ getRegions, getLocations, getFeatures passed');
}
// ============================================================================
// VALIDATION OPERATIONS TESTS
// ============================================================================
function testValidateGTWG() {
    console.log('Testing validateGTWG...');
    // Test valid GTWG
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation]);
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation1]);
    let validation = (0, GTWG_1.validateGTWG)(gtwg);
    assert(validation.isValid, 'Valid GTWG should pass validation');
    assert(validation.errors.length === 0, 'Valid GTWG should have no errors');
    // Test GTWG with orphan entities
    gtwg = (0, GTWG_1.addEntity)(gtwg, testFeature);
    validation = (0, GTWG_1.validateGTWG)(gtwg);
    assert(!validation.isValid, 'GTWG with orphan entities should fail validation');
    assert(validation.errors.some(e => e.includes('Orphan entities')), 'Should detect orphan entities');
    // Test GTWG with invalid relation references
    gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntity)(gtwg, testRegion);
    const invalidRelation = {
        id: 'invalid-rel',
        type: 'located_in',
        from: 'region-1',
        to: 'non-existent',
    };
    gtwg = (0, GTWG_1.addRelation)(gtwg, invalidRelation);
    validation = (0, GTWG_1.validateGTWG)(gtwg);
    assert(!validation.isValid, 'GTWG with invalid relations should fail validation');
    assert(validation.errors.some(e => e.includes('Invalid relation references')), 'Should detect invalid relations');
    console.log('✅ validateGTWG passed');
}
function testHasOrphanEntities() {
    console.log('Testing hasOrphanEntities...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation]);
    // Test GTWG without orphan entities
    assert(!(0, GTWG_1.hasOrphanEntities)(gtwg), 'GTWG with no relations should not have orphan entities (empty is valid)');
    // Test GTWG with orphan entities
    gtwg = (0, GTWG_1.addEntity)(gtwg, testFeature);
    assert((0, GTWG_1.hasOrphanEntities)(gtwg), 'GTWG with unconnected entity should have orphan entities');
    console.log('✅ hasOrphanEntities passed');
}
function testHasCircularLocationReferences() {
    console.log('Testing hasCircularLocationReferences...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature]);
    // Test GTWG without circular references
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation1, testRelation2]);
    assert(!(0, GTWG_1.hasCircularLocationReferences)(gtwg), 'GTWG without circular references should pass');
    // Test GTWG with circular references
    const circularRelation = {
        id: 'circular-rel',
        type: 'located_in',
        from: 'region-1',
        to: 'location-1',
    };
    gtwg = (0, GTWG_1.addRelation)(gtwg, circularRelation);
    assert((0, GTWG_1.hasCircularLocationReferences)(gtwg), 'GTWG with circular references should be detected');
    console.log('✅ hasCircularLocationReferences passed');
}
// ============================================================================
// UTILITY OPERATIONS TESTS
// ============================================================================
function testGetGTWGStats() {
    console.log('Testing getGTWGStats...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation, testFeature, testCharacter]);
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation1, testRelation2, testRelation3]);
    const stats = (0, GTWG_1.getGTWGStats)(gtwg);
    assert(stats.entityCount === 4, 'Should have 4 entities');
    assert(stats.relationCount === 3, 'Should have 3 relations');
    assert(stats.entityTypeCounts.region === 1, 'Should have 1 region');
    assert(stats.entityTypeCounts.location === 1, 'Should have 1 location');
    assert(stats.entityTypeCounts.feature === 1, 'Should have 1 feature');
    assert(stats.entityTypeCounts.character === 1, 'Should have 1 character');
    assert(stats.relationTypeCounts.located_in === 3, 'Should have 3 located_in relations');
    console.log('✅ getGTWGStats passed');
}
function testCloneGTWG() {
    console.log('Testing cloneGTWG...');
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    gtwg = (0, GTWG_1.addEntities)(gtwg, [testRegion, testLocation]);
    gtwg = (0, GTWG_1.addRelations)(gtwg, [testRelation1]);
    const cloned = (0, GTWG_1.cloneGTWG)(gtwg);
    assert((0, GTWG_1.areGTWGsEqual)(gtwg, cloned), 'Cloned GTWG should be equal to original');
    assert(gtwg !== cloned, 'Cloned GTWG should be a different object');
    // Test that modifications to clone don't affect original
    cloned.entities.push(testFeature);
    assert(!(0, GTWG_1.areGTWGsEqual)(gtwg, cloned), 'Modified clone should not equal original');
    console.log('✅ cloneGTWG passed');
}
function testAreGTWGsEqual() {
    console.log('Testing areGTWGsEqual...');
    let gtwg1 = (0, GTWG_1.createEmptyGTWG)();
    gtwg1 = (0, GTWG_1.addEntities)(gtwg1, [testRegion, testLocation]);
    gtwg1 = (0, GTWG_1.addRelations)(gtwg1, [testRelation1]);
    let gtwg2 = (0, GTWG_1.createEmptyGTWG)();
    gtwg2 = (0, GTWG_1.addEntities)(gtwg2, [testRegion, testLocation]);
    gtwg2 = (0, GTWG_1.addRelations)(gtwg2, [testRelation1]);
    assert((0, GTWG_1.areGTWGsEqual)(gtwg1, gtwg2), 'Identical GTWGs should be equal');
    // Test with different entities
    gtwg2 = (0, GTWG_1.addEntity)(gtwg2, testFeature);
    assert(!(0, GTWG_1.areGTWGsEqual)(gtwg1, gtwg2), 'GTWGs with different entities should not be equal');
    // Test with different relations
    gtwg2 = (0, GTWG_1.createEmptyGTWG)();
    gtwg2 = (0, GTWG_1.addEntities)(gtwg2, [testRegion, testLocation]);
    gtwg2 = (0, GTWG_1.addRelations)(gtwg2, [testRelation2]);
    assert(!(0, GTWG_1.areGTWGsEqual)(gtwg1, gtwg2), 'GTWGs with different relations should not be equal');
    console.log('✅ areGTWGsEqual passed');
}
// ============================================================================
// COMPLEX SCENARIO TESTS
// ============================================================================
function testComplexScenario() {
    console.log('Testing complex scenario...');
    // Create a complex world with multiple entities and relations
    let gtwg = (0, GTWG_1.createEmptyGTWG)();
    // Add multiple regions
    const region1 = { ...testRegion, id: 'region-1', name: 'Northern Region' };
    const region2 = { ...testRegion, id: 'region-2', name: 'Southern Region' };
    // Add multiple locations
    const location1 = { ...testLocation, id: 'location-1', name: 'Northern Town' };
    const location2 = { ...testLocation, id: 'location-2', name: 'Southern City' };
    const location3 = { ...testLocation, id: 'location-3', name: 'Mountain Pass' };
    // Add multiple features
    const feature1 = { ...testFeature, id: 'feature-1', name: 'Town Well' };
    const feature2 = { ...testFeature, id: 'feature-2', name: 'City Gate' };
    const feature3 = { ...testFeature, id: 'feature-3', name: 'Pass Bridge' };
    // Add multiple characters
    const character1 = { ...testCharacter, id: 'character-1', name: 'Alice' };
    const character2 = { ...testCharacter, id: 'character-2', name: 'Bob' };
    const character3 = { ...testCharacter, id: 'character-3', name: 'Charlie' };
    gtwg = (0, GTWG_1.addEntities)(gtwg, [region1, region2, location1, location2, location3, feature1, feature2, feature3, character1, character2, character3]);
    // Add complex relations
    const relations = [
        { id: 'rel-1', type: 'located_in', from: 'location-1', to: 'region-1' },
        { id: 'rel-2', type: 'located_in', from: 'location-2', to: 'region-2' },
        { id: 'rel-3', type: 'located_in', from: 'location-3', to: 'region-1' },
        { id: 'rel-4', type: 'located_in', from: 'feature-1', to: 'location-1' },
        { id: 'rel-5', type: 'located_in', from: 'feature-2', to: 'location-2' },
        { id: 'rel-6', type: 'located_in', from: 'feature-3', to: 'location-3' },
        { id: 'rel-7', type: 'located_in', from: 'character-1', to: 'location-1' },
        { id: 'rel-8', type: 'located_in', from: 'character-2', to: 'location-2' },
        { id: 'rel-9', type: 'located_in', from: 'character-3', to: 'location-3' },
        { id: 'rel-10', type: 'adjacent_to', from: 'location-1', to: 'location-3' },
        { id: 'rel-11', type: 'adjacent_to', from: 'location-3', to: 'location-2' },
    ];
    gtwg = (0, GTWG_1.addRelations)(gtwg, relations);
    // Test complex queries
    const northernRegionContents = (0, GTWG_1.getLocationContents)(gtwg, 'region-1');
    assert(northernRegionContents.length === 2, 'Should find 2 locations in northern region');
    const southernRegionContents = (0, GTWG_1.getLocationContents)(gtwg, 'region-2');
    assert(southernRegionContents.length === 1, 'Should find 1 location in southern region');
    const northernTownContents = (0, GTWG_1.getLocationContents)(gtwg, 'location-1');
    assert(northernTownContents.length === 2, 'Should find 2 entities in northern town');
    const adjacentToNorthernTown = (0, GTWG_1.findConnectedEntities)(gtwg, 'location-1', 'adjacent_to');
    assert(adjacentToNorthernTown.length === 1, 'Should find 1 location adjacent to northern town');
    assert(adjacentToNorthernTown[0].id === 'location-3', 'Should find mountain pass adjacent to northern town');
    // Test validation
    const validation = (0, GTWG_1.validateGTWG)(gtwg);
    assert(validation.isValid, 'Complex GTWG should be valid');
    console.log('✅ Complex scenario passed');
}
// ============================================================================
// RUN ALL TESTS
// ============================================================================
function runAllTests() {
    console.log('🚀 Starting GTWG test suite...\n');
    try {
        // Core operations
        testCreateEmptyGTWG();
        testCreateGTWG();
        // Entity operations
        testAddEntity();
        testAddEntities();
        testGetEntity();
        testGetEntitiesByType();
        testUpdateEntity();
        testRemoveEntity();
        // Relation operations
        testAddRelation();
        testAddRelations();
        testGetRelation();
        testGetRelations();
        testRemoveRelation();
        // Query operations
        testFindConnectedEntities();
        testFindIncomingEntities();
        testGetEntityLocation();
        testGetLocationContents();
        testGetRegionsLocationsFeatures();
        // Validation operations
        testValidateGTWG();
        testHasOrphanEntities();
        testHasCircularLocationReferences();
        // Utility operations
        testGetGTWGStats();
        testCloneGTWG();
        testAreGTWGsEqual();
        // Complex scenarios
        testComplexScenario();
        console.log('\n🎉 All GTWG tests passed!');
        console.log('✅ GTWG data store is ready for use.');
    }
    catch (error) {
        console.error('\n❌ Test failed:', error.message);
        throw error;
    }
}
// Run tests if this file is executed directly
if (typeof window === 'undefined') {
    runAllTests();
}
