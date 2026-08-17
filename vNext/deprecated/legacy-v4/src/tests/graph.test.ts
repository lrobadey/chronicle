/**
 * Chronicle v4 - Graph Tests
 * 
 * Tests for entity graph, store, and PKG projection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGraphStore,
  ensureSeededFromWorld,
  resetGraphStore,
  projectPKG,
  P,
  type GraphStore,
} from '../core/graph';
import { createIsleOfMarrowWorld } from '../worlds/isle-of-marrow';
import type { World } from '../core/world';

describe('Graph Store', () => {
  let store: GraphStore;

  beforeEach(() => {
    store = createGraphStore();
  });

  describe('Entity Operations', () => {
    it('should create entities', () => {
      const result = store.createEntity({
        type: 'location',
        props: { name: 'Test Room', description: 'A test location' },
      });

      expect(result.id).toBeDefined();
      expect(result.id).toContain('location-');
    });

    it('should get entities by ID', () => {
      store.createEntity({
        type: 'item',
        props: { name: 'Sword' },
        id: 'sword-1',
      });

      const entity = store.getEntity('sword-1');
      expect(entity).toBeDefined();
      expect(entity!.type).toBe('item');
      expect(entity!.props?.name).toBe('Sword');
    });

    it('should update entity props', () => {
      store.createEntity({
        type: 'actor',
        props: { name: 'Hero', health: 100 },
        id: 'hero',
      });

      store.updateEntity('hero', { health: 80, status: 'injured' });

      const entity = store.getEntity('hero');
      expect(entity!.props?.health).toBe(80);
      expect(entity!.props?.status).toBe('injured');
      expect(entity!.props?.name).toBe('Hero'); // Unchanged
    });

    it('should throw on duplicate entity ID', () => {
      store.createEntity({ type: 'item', id: 'duplicate' });
      expect(() => store.createEntity({ type: 'item', id: 'duplicate' })).toThrow();
    });
  });

  describe('Relation Operations', () => {
    beforeEach(() => {
      store.createEntity({ type: 'location', id: 'room-1', props: { name: 'Room 1' } });
      store.createEntity({ type: 'location', id: 'room-2', props: { name: 'Room 2' } });
      store.createEntity({ type: 'actor', id: 'player', props: { name: 'Player' } });
      store.createEntity({ type: 'item', id: 'key', props: { name: 'Key' } });
    });

    it('should create relations', () => {
      const result = store.createRelation({
        subj: 'player',
        pred: P.located_in,
        obj: 'room-1',
      });

      expect(result.id).toBeDefined();
    });

    it('should get relations by subject', () => {
      store.createRelation({ subj: 'room-1', pred: P.contains, obj: 'key' });

      const relations = store.getRelationsBySubject('room-1');
      expect(relations.length).toBe(1);
      expect(relations[0].pred).toBe(P.contains);
      expect(relations[0].obj).toBe('key');
    });

    it('should get relations by predicate', () => {
      store.createRelation({ subj: 'player', pred: P.located_in, obj: 'room-1' });
      store.createRelation({ subj: 'room-1', pred: P.contains, obj: 'key' });

      const locatedIn = store.getRelationsByPredicate(P.located_in);
      expect(locatedIn.length).toBe(1);

      const contains = store.getRelationsByPredicate(P.contains);
      expect(contains.length).toBe(1);
    });

    it('should get located_in relation', () => {
      store.createRelation({ subj: 'player', pred: P.located_in, obj: 'room-1' });

      const located = store.getLocatedIn('player');
      expect(located).toBeDefined();
      expect(located!.obj).toBe('room-1');
    });

    it('should remove relations', () => {
      const rel = store.createRelation({ subj: 'room-1', pred: P.contains, obj: 'key' });
      expect(store.getRelationsBySubject('room-1').length).toBe(1);

      store.removeRelation(rel.id);
      expect(store.getRelationsBySubject('room-1').length).toBe(0);
    });
  });

  describe('Position Operations', () => {
    beforeEach(() => {
      store.createEntity({
        type: 'location',
        id: 'loc-1',
        props: { name: 'Location 1', pos: { x: 100, y: 200 } },
      });
    });

    it('should get position', () => {
      const pos = store.getPosition('loc-1');
      expect(pos).toBeDefined();
      expect(pos!.x).toBe(100);
      expect(pos!.y).toBe(200);
    });

    it('should set position', () => {
      store.setPosition('loc-1', { x: 300, y: 400, z: 50 });

      const pos = store.getPosition('loc-1');
      expect(pos!.x).toBe(300);
      expect(pos!.y).toBe(400);
      expect(pos!.z).toBe(50);
    });

    it('should return undefined for missing position', () => {
      store.createEntity({ type: 'item', id: 'no-pos' });
      const pos = store.getPosition('no-pos');
      expect(pos).toBeUndefined();
    });
  });
});

describe('Graph Seeding from World', () => {
  let world: World;

  beforeEach(() => {
    resetGraphStore(); // Clear cache to ensure fresh seeding
    world = createIsleOfMarrowWorld();
  });

  it('should seed graph from Isle of Marrow world', () => {
    const store = ensureSeededFromWorld(world);

    // Check player entity exists
    const player = store.getEntity('player-1');
    expect(player).toBeDefined();
    expect(player!.type).toBe('actor');

    // Check location entities
    const landing = store.getEntity('the-landing');
    expect(landing).toBeDefined();
    expect(landing!.type).toBe('location');
    expect(landing!.props?.name).toBe('The Landing');
  });

  it('should create player location relation', () => {
    const store = ensureSeededFromWorld(world);

    const located = store.getLocatedIn('player-1');
    expect(located).toBeDefined();
    expect(located!.obj).toBe('the-landing');
  });

  it('should seed items with contains relations', () => {
    const store = ensureSeededFromWorld(world);

    // The Rib Market has a heartwater jar
    const contains = store.getRelationsBySubject('the-rib-market').filter(r => r.pred === P.contains);
    expect(contains.length).toBe(1);
    expect(contains[0].obj).toBe('heartwater-jar');
  });

  it('should set positions from location coords', () => {
    const store = ensureSeededFromWorld(world);

    const pos = store.getPosition('the-landing');
    expect(pos).toBeDefined();
    expect(pos!.x).toBe(0);
    expect(pos!.y).toBe(0);

    const marketPos = store.getPosition('the-rib-market');
    expect(marketPos).toBeDefined();
    expect(marketPos!.x).toBe(0);
    expect(marketPos!.y).toBe(1200);
  });

  it('should reuse store for same world signature', () => {
    const store1 = ensureSeededFromWorld(world);
    const store2 = ensureSeededFromWorld(world);

    expect(store1).toBe(store2);
  });

  it('should reseed when world changes (new location added)', () => {
    const store1 = ensureSeededFromWorld(world);

    // Modify world by adding a new location (changes the signature)
    world.locations['new-location'] = {
      id: 'new-location',
      name: 'New Place',
      description: 'A new location',
    };

    const store2 = ensureSeededFromWorld(world);
    expect(store2).not.toBe(store1);
    expect(store2.getEntity('new-location')).toBeDefined();
  });

  it('should reseed when explicitly reset', () => {
    // Seed once
    const store1 = ensureSeededFromWorld(world);
    const locatedBefore = store1.getLocatedIn('player-1')!.obj;
    expect(locatedBefore).toBe('the-landing');

    // Change player location and reset cache
    world.player.location = 'the-rib-market';
    resetGraphStore();

    // Re-seed - should reflect new location
    const store2 = ensureSeededFromWorld(world);
    const locatedAfter = store2.getLocatedIn('player-1')!.obj;
    expect(locatedAfter).toBe('the-rib-market');
  });
});

describe('PKG Projection', () => {
  let world: World;

  beforeEach(() => {
    resetGraphStore(); // Clear cache to ensure fresh seeding
    world = createIsleOfMarrowWorld();
  });

  it('should project basic PKG', () => {
    const pkg = projectPKG(world);

    expect(pkg.playerId).toBe('player-1');
    expect(pkg.currentLocationId).toBe('the-landing');
    expect(pkg.knownLocations).toBeInstanceOf(Array);
    expect(pkg.knownNPCs).toBeInstanceOf(Array);
    expect(pkg.knownItems).toBeInstanceOf(Array);
    expect(pkg.nearbyDirections).toBeInstanceOf(Array);
  });

  it('should include current location in known locations', () => {
    const pkg = projectPKG(world);

    const currentLoc = pkg.knownLocations.find(l => l.id === 'the-landing');
    expect(currentLoc).toBeDefined();
    expect(currentLoc!.name).toBe('The Landing');
    expect(currentLoc!.visited).toBe(true);
  });

  it('should include nearby locations', () => {
    const pkg = projectPKG(world);

    // From The Landing (0,0), some locations should be within 100m or mentioned in ledger
    expect(pkg.knownLocations.length).toBeGreaterThan(1);
  });

  it('should include NPCs at current location', () => {
    // Move to Spine Ridge where Mira Salt is
    world.player.location = 'the-spine-ridge';
    world.player.pos = { x: 0, y: 6000, z: 120 };

    const pkg = projectPKG(world);

    const mira = pkg.knownNPCs.find(n => n.id === 'mira-salt');
    expect(mira).toBeDefined();
    expect(mira!.name).toBe('Mira Salt');
  });

  it('should include inventory items', () => {
    world.player.inventory = [
      { id: 'sword', name: 'Iron Sword' },
      { id: 'potion', name: 'Health Potion' },
    ];

    const pkg = projectPKG(world);

    const sword = pkg.knownItems.find(i => i.id === 'sword');
    expect(sword).toBeDefined();
    expect(sword!.inInventory).toBe(true);
  });

  it('should include items at current location', () => {
    // Move to Rib Market where heartwater jar is
    world.player.location = 'the-rib-market';
    world.player.pos = { x: 0, y: 1200, z: 15 };

    const pkg = projectPKG(world);

    const jar = pkg.knownItems.find(i => i.id === 'heartwater-jar');
    expect(jar).toBeDefined();
    expect(jar!.inInventory).toBe(false);
  });

  it('should calculate nearby directions', () => {
    const pkg = projectPKG(world);

    for (const dir of pkg.nearbyDirections) {
      expect(['north', 'south', 'east', 'west']).toContain(dir.direction);
      expect(dir.distance).toBeLessThan(150);
    }
  });

  it('should track visited locations from ledger', () => {
    // Add a ledger entry mentioning the market
    world.ledger.push('Visited The Rib Market and traded goods.');

    const pkg = projectPKG(world);

    const market = pkg.knownLocations.find(l => l.id === 'the-rib-market');
    expect(market).toBeDefined();
    expect(market!.visited).toBe(true);
  });
});

