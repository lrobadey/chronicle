import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';
import { applyEvent, applyEvents } from '../../sim/reducer';
import { checkInvariants } from '../../sim/invariants';
import { runReputationDrift } from '../../sim/systems/reputation';

const FIXED_ANCHOR = '2025-01-01T06:00:00Z';

function baseWorld() {
  return createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
}

// ---------------------------------------------------------------------------
// ModifyReputation
// ---------------------------------------------------------------------------

describe('ModifyReputation event', () => {
  it('adds standing to an actor that had none', () => {
    const world = baseWorld();
    const result = applyEvent(world, {
      type: 'ModifyReputation',
      actorId: 'player-1',
      factionId: 'the-market-guild',
      delta: 20,
    });

    assert.equal(result.actors['player-1']?.factionStandings?.['the-market-guild'], 20);
  });

  it('accumulates standing across multiple events', () => {
    const world = baseWorld();
    const after = applyEvents(world, [
      { type: 'ModifyReputation', actorId: 'player-1', factionId: 'the-market-guild', delta: 15 },
      { type: 'ModifyReputation', actorId: 'player-1', factionId: 'the-market-guild', delta: 10 },
    ]);

    assert.equal(after.actors['player-1']?.factionStandings?.['the-market-guild'], 25);
  });

  it('clamps standing at +100 on positive overflow', () => {
    const world = baseWorld();
    const after = applyEvents(world, [
      { type: 'ModifyReputation', actorId: 'player-1', factionId: 'the-market-guild', delta: 80 },
      { type: 'ModifyReputation', actorId: 'player-1', factionId: 'the-market-guild', delta: 80 },
    ]);

    assert.equal(after.actors['player-1']?.factionStandings?.['the-market-guild'], 100);
  });

  it('clamps standing at -100 on negative overflow', () => {
    const world = baseWorld();
    const after = applyEvents(world, [
      { type: 'ModifyReputation', actorId: 'player-1', factionId: 'the-market-guild', delta: -80 },
      { type: 'ModifyReputation', actorId: 'player-1', factionId: 'the-market-guild', delta: -80 },
    ]);

    assert.equal(after.actors['player-1']?.factionStandings?.['the-market-guild'], -100);
  });

  it('tracks different factions independently', () => {
    const world = baseWorld();
    const after = applyEvents(world, [
      { type: 'ModifyReputation', actorId: 'player-1', factionId: 'the-market-guild', delta: 30 },
      { type: 'ModifyReputation', actorId: 'player-1', factionId: 'heartspring-clergy', delta: -10 },
    ]);

    const standings = after.actors['player-1']?.factionStandings;
    assert.equal(standings?.['the-market-guild'], 30);
    assert.equal(standings?.['heartspring-clergy'], -10);
  });

  it('ignores unknown actor id', () => {
    const world = baseWorld();
    const result = applyEvent(world, {
      type: 'ModifyReputation',
      actorId: 'nonexistent-actor',
      factionId: 'the-market-guild',
      delta: 20,
    });

    // State should be unchanged
    assert.deepEqual(result.actors, world.actors);
  });

  it('adds a ledger entry', () => {
    const world = baseWorld();
    const ledgerLengthBefore = world.ledger.length;
    const result = applyEvent(world, {
      type: 'ModifyReputation',
      actorId: 'player-1',
      factionId: 'the-market-guild',
      delta: 10,
    });

    assert.ok(result.ledger.length > ledgerLengthBefore, 'ledger should have a new entry');
  });
});

// ---------------------------------------------------------------------------
// SpreadRumor
// ---------------------------------------------------------------------------

describe('SpreadRumor event', () => {
  it('appends a rumor to the recipient\'s knowledge', () => {
    const world = baseWorld();
    const result = applyEvent(world, {
      type: 'SpreadRumor',
      toActorId: 'player-1',
      rumor: 'The market guild is fixing salt prices.',
      subject: 'market-guild',
    });

    assert.ok(result.knowledge['player-1']?.rumors.includes('The market guild is fixing salt prices.'));
  });

  it('does not duplicate the same rumor', () => {
    const world = baseWorld();
    const after = applyEvents(world, [
      { type: 'SpreadRumor', toActorId: 'player-1', rumor: 'Tide left something on the pilings.' },
      { type: 'SpreadRumor', toActorId: 'player-1', rumor: 'Tide left something on the pilings.' },
    ]);

    const rumors = after.knowledge['player-1']?.rumors ?? [];
    assert.equal(rumors.filter(r => r === 'Tide left something on the pilings.').length, 1);
  });

  it('accumulates multiple distinct rumors', () => {
    const world = baseWorld();
    const after = applyEvents(world, [
      { type: 'SpreadRumor', toActorId: 'player-1', rumor: 'Father Kel had a visitor at midnight.' },
      { type: 'SpreadRumor', toActorId: 'player-1', rumor: 'The market guild owes debts in the south.' },
    ]);

    const rumors = after.knowledge['player-1']?.rumors ?? [];
    assert.equal(rumors.length, 2);
  });

  it('ignores unknown recipient actor id', () => {
    const world = baseWorld();
    const result = applyEvent(world, {
      type: 'SpreadRumor',
      toActorId: 'nobody',
      rumor: 'This should go nowhere.',
    });

    // Knowledge state should be unchanged
    assert.deepEqual(result.knowledge, world.knowledge);
  });

  it('adds a ledger entry', () => {
    const world = baseWorld();
    const ledgerLengthBefore = world.ledger.length;
    const result = applyEvent(world, {
      type: 'SpreadRumor',
      toActorId: 'player-1',
      rumor: 'Something strange happened at the maw.',
    });

    assert.ok(result.ledger.length > ledgerLengthBefore, 'ledger should have a new entry');
  });
});

// ---------------------------------------------------------------------------
// CreateEntity { kind: 'faction' }
// ---------------------------------------------------------------------------

describe('CreateEntity faction', () => {
  it('adds the faction to state.factions', () => {
    const world = baseWorld();
    const result = applyEvent(world, {
      type: 'CreateEntity',
      entity: {
        kind: 'faction',
        data: {
          id: 'the-ridge-watchers',
          name: 'The Ridge Watchers',
          description: 'A loose group of sentinels stationed at the Spine Ridge.',
          tags: ['watch', 'ridge'],
          memberIds: ['mira-salt'],
        },
      },
    });

    const faction = result.factions['the-ridge-watchers'];
    assert.ok(faction, 'faction should exist in state.factions');
    assert.equal(faction.name, 'The Ridge Watchers');
    assert.deepEqual(faction.memberIds, ['mira-salt']);
  });

  it('creates a faction spine entity', () => {
    const world = baseWorld();
    const result = applyEvent(world, {
      type: 'CreateEntity',
      entity: {
        kind: 'faction',
        data: {
          id: 'the-ridge-watchers',
          name: 'The Ridge Watchers',
          description: 'Sentinels of the Spine Ridge.',
          memberIds: [],
        },
      },
    });

    const entity = result.spine.entities['the-ridge-watchers'];
    assert.ok(entity, 'spine entity should exist');
    assert.equal(entity.kind, 'faction');
    assert.equal(entity.archetype, 'faction.group');
  });

  it('creates member_of relations for each listed member', () => {
    const world = baseWorld();
    const result = applyEvent(world, {
      type: 'CreateEntity',
      entity: {
        kind: 'faction',
        data: {
          id: 'the-ridge-watchers',
          name: 'The Ridge Watchers',
          description: 'Sentinels.',
          memberIds: ['mira-salt'],
        },
      },
    });

    const relation = result.spine.relations['member_of:mira-salt:the-ridge-watchers'];
    assert.ok(relation, 'member_of relation should exist');
    assert.equal(relation.type, 'member_of');
    assert.equal(relation.from, 'mira-salt');
    assert.equal(relation.to, 'the-ridge-watchers');
  });
});

// ---------------------------------------------------------------------------
// Reputation drift (kernel system)
// ---------------------------------------------------------------------------

describe('runReputationDrift', () => {
  it('standing at exactly 0 does not change', () => {
    const world = baseWorld();
    const after = applyEvent(world, {
      type: 'ModifyReputation',
      actorId: 'player-1',
      factionId: 'the-market-guild',
      delta: 0,
    });

    after.systems.time.elapsedMinutes = 14400; // 10 days
    runReputationDrift(after);

    assert.equal(after.actors['player-1']?.factionStandings?.['the-market-guild'] ?? 0, 0);
  });

  it('positive standing drifts downward toward 0 over time', () => {
    const world = baseWorld();
    const withReputation = applyEvent(world, {
      type: 'ModifyReputation',
      actorId: 'player-1',
      factionId: 'the-market-guild',
      delta: 50,
    });

    // Advance 100 days = 144000 minutes (significant drift)
    withReputation.systems.time.elapsedMinutes = 144000;
    runReputationDrift(withReputation);

    const standing = withReputation.actors['player-1']?.factionStandings?.['the-market-guild'] ?? 50;
    assert.ok(standing < 50, `standing ${standing} should have drifted below 50`);
    assert.ok(standing >= 0, `standing ${standing} should not go below 0`);
  });

  it('negative standing drifts upward toward 0 over time', () => {
    const world = baseWorld();
    const withReputation = applyEvent(world, {
      type: 'ModifyReputation',
      actorId: 'player-1',
      factionId: 'the-market-guild',
      delta: -50,
    });

    withReputation.systems.time.elapsedMinutes = 144000;
    runReputationDrift(withReputation);

    const standing = withReputation.actors['player-1']?.factionStandings?.['the-market-guild'] ?? -50;
    assert.ok(standing > -50, `standing ${standing} should have drifted above -50`);
    assert.ok(standing <= 0, `standing ${standing} should not go above 0`);
  });

  it('standing within drift threshold is not changed', () => {
    const world = baseWorld();
    const withReputation = applyEvent(world, {
      type: 'ModifyReputation',
      actorId: 'player-1',
      factionId: 'the-market-guild',
      delta: 3, // within DRIFT_THRESHOLD of 5
    });

    withReputation.systems.time.elapsedMinutes = 144000;
    runReputationDrift(withReputation);

    // Should remain unchanged — within ±5 of neutral
    assert.equal(withReputation.actors['player-1']?.factionStandings?.['the-market-guild'], 3);
  });

  it('is idempotent at the same elapsed time', () => {
    const world = baseWorld();
    const withReputation = applyEvent(world, {
      type: 'ModifyReputation',
      actorId: 'player-1',
      factionId: 'the-market-guild',
      delta: 40,
    });

    withReputation.systems.time.elapsedMinutes = 144000;
    runReputationDrift(withReputation);
    const afterFirst = withReputation.actors['player-1']?.factionStandings?.['the-market-guild'];

    // Run again at the same elapsed time — no additional drift should occur
    runReputationDrift(withReputation);
    const afterSecond = withReputation.actors['player-1']?.factionStandings?.['the-market-guild'];

    assert.equal(afterFirst, afterSecond);
  });
});

// ---------------------------------------------------------------------------
// Isle of Marrow world initialization
// ---------------------------------------------------------------------------

describe('Isle of Marrow faction initialization', () => {
  it('world contains three factions', () => {
    const world = baseWorld();
    const factionIds = Object.keys(world.factions);
    assert.ok(factionIds.includes('the-market-guild'), 'should have the-market-guild');
    assert.ok(factionIds.includes('heartspring-clergy'), 'should have heartspring-clergy');
    assert.ok(factionIds.includes('dock-brotherhood'), 'should have dock-brotherhood');
  });

  it('faction members are correctly assigned', () => {
    const world = baseWorld();
    assert.ok(world.factions['the-market-guild']?.memberIds.includes('ledger-pike'));
    assert.ok(world.factions['heartspring-clergy']?.memberIds.includes('father-kel'));
    assert.ok(world.factions['dock-brotherhood']?.memberIds.includes('tamar-vane'));
  });

  it('player starts with empty factionStandings', () => {
    const world = baseWorld();
    assert.deepEqual(world.actors['player-1']?.factionStandings, {});
  });

  it('player knowledge starts with empty rumors array', () => {
    const world = baseWorld();
    assert.deepEqual(world.knowledge['player-1']?.rumors, []);
  });

  it('faction spine entities exist after initialization', () => {
    const world = baseWorld();
    assert.equal(world.spine.entities['the-market-guild']?.kind, 'faction');
    assert.equal(world.spine.entities['heartspring-clergy']?.kind, 'faction');
    assert.equal(world.spine.entities['dock-brotherhood']?.kind, 'faction');
  });

  it('member_of relations exist in spine', () => {
    const world = baseWorld();
    assert.ok(world.spine.relations['member_of:ledger-pike:the-market-guild']);
    assert.ok(world.spine.relations['member_of:father-kel:heartspring-clergy']);
    assert.ok(world.spine.relations['member_of:tamar-vane:dock-brotherhood']);
  });

  it('passes invariant checks after initialization', () => {
    const world = baseWorld();
    const issues = checkInvariants(world);
    assert.deepEqual(issues, [], `Expected no invariant issues, got: ${JSON.stringify(issues)}`);
  });
});

// ---------------------------------------------------------------------------
// Invariant checks
// ---------------------------------------------------------------------------

describe('faction invariants', () => {
  it('flags standing that references an unknown faction', () => {
    const world = baseWorld();
    // Manually inject a bad standing reference
    world.actors['player-1']!.factionStandings = { 'nonexistent-faction': 50 };
    const issues = checkInvariants(world);
    assert.ok(
      issues.some(i => i.path.includes('factionStandings') && i.message.includes('nonexistent-faction')),
      `Expected invariant issue for unknown faction, got: ${JSON.stringify(issues)}`,
    );
  });

  it('flags faction membership that references an unknown actor', () => {
    const world = baseWorld();
    // Inject a bad member ID
    world.factions['the-market-guild']!.memberIds.push('ghost-npc');
    const issues = checkInvariants(world);
    assert.ok(
      issues.some(i => i.path.includes('factions') && i.message.includes('ghost-npc')),
      `Expected invariant issue for unknown actor, got: ${JSON.stringify(issues)}`,
    );
  });
});
