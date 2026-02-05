import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createIsleOfMarrowWorld } from '../state/world';
import { buildTurnTelemetry } from '../state/telemetry';
import { projectPKGFromGraph } from '../state/pkg';
import { buildFilteredContext, formatFilteredContext } from '../agents/context/filter';

describe('Context filter', () => {
  const world = createIsleOfMarrowWorld();
  const telemetry = buildTurnTelemetry(world);
  const pkg = projectPKGFromGraph(world);

  it('limits list lengths according to configuration', () => {
    const filtered = buildFilteredContext({
      telemetry,
      pkg,
      options: { maxLocations: 2, maxNPCs: 1, maxItems: 2, maxLedgerEntries: 2 },
    });

    const nearby = filtered.sections.find((section) => section.label === 'Nearby');
    assert.ok(!nearby || nearby.body.split('\n').length <= 2);

    const npcs = filtered.sections.find((section) => section.label === 'Player Knowledge: NPCs');
    assert.ok(!npcs || npcs.body.split('\n').length <= 1);
  });

  it('truncates low-priority sections when exceeding char budget', () => {
    const filtered = buildFilteredContext({
      telemetry,
      pkg,
      options: { maxChars: 200, maxLocations: 2 },
    });
    assert.ok(filtered.stats.truncatedSections.length > 0);
  });

  it('produces deterministic output for identical inputs', () => {
    const a = buildFilteredContext({ telemetry, pkg });
    const b = buildFilteredContext({ telemetry, pkg });
    assert.deepStrictEqual(a, b);
    assert.ok(formatFilteredContext(a).length > 0);
  });
});

