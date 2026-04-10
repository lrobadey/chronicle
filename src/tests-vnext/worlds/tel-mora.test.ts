import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getItemPlacement } from '../../sim/spine';
import { createTelMoraWorldVNext, telMoraWorldModule } from '../../worlds/tel-mora';

const FIXED_ANCHOR = '2025-01-01T14:00:00Z';

describe('Tel Mora world module', () => {
  it('creates the authored world state and startup kit', () => {
    const world = createTelMoraWorldVNext({ anchorIso: FIXED_ANCHOR });

    assert.equal(telMoraWorldModule.id, 'tel-mora');
    assert.equal(telMoraWorldModule.displayName, 'Tel Mora — The Dead Junction');
    assert.equal(world.meta.worldId, 'tel-mora');
    assert.equal(world.meta.seed, 'tel-mora-dead-junction');
    assert.equal(world.meta.turn, 0);

    assert.deepEqual(Object.keys(world.locations).sort(), [
      'the-assessors-shade',
      'the-cut',
      'the-kiln-shelf',
      'the-seep',
      'the-silted-lock',
      'the-sluice',
    ]);

    assert.equal(world.locations['the-sluice']?.anchor.z, 12);
    assert.equal(world.locations['the-cut']?.anchor.y, 120);
    assert.equal(world.locations['the-assessors-shade']?.anchor.x, 60);
    assert.equal(world.locations['the-seep']?.description.includes('water supply'), true);
    assert.equal(world.locations['the-silted-lock']?.description.includes('entire political argument'), true);

    assert.deepEqual(Object.keys(world.actors).sort(), [
      'deshur',
      'lugal-ane',
      'nesh',
      'old-kesh',
      'player-1',
      'rana-tuq',
      'siduri',
    ]);

    assert.equal(world.actors['player-1']?.pos.x, 60);
    assert.equal(world.actors['deshur']?.persona?.voice, 'Measured, careful, asks questions that sound idle but are not.');
    assert.equal(world.actors['rana-tuq']?.tags?.includes('engineer'), true);
    assert.equal(world.actors['old-kesh']?.persona?.goals.includes('not be erased a second time'), true);
    assert.equal(world.actors['siduri']?.persona?.background.includes('most informed person in Tel Mora'), true);

    assert.equal(world.meta.openingSpec?.focalActorId, 'deshur');
    assert.equal(world.meta.openingSpec?.focusLocationId, 'the-assessors-shade');
    assert.equal(world.meta.openingSpec?.playerQuestion, 'What will the Assessor recommend, and can you shape it before he decides?');
    assert.equal(world.meta.openingSpec?.hookText.includes('Rana Tuq has asked the player'), true);

    assert.equal(world.directorState.scene.currentFocus, 'The day before the preliminary recommendation');
    assert.equal(world.directorState.scene.pressures.length, 3);
    assert.equal(world.directorState.world.activeThreads.includes('The Assessor\'s report'), true);
    assert.equal(world.directorState.world.escalationHooks.some(text => text.includes('rationing disputes')), true);
    assert.equal(world.directorState.activeThreads[0]?.status, 'rising');
    assert.equal(world.directorState.activeThreads[1]?.domain, 'water');

    assert.equal(world.systems.timeConfig.anchorIso, '2025-01-01T06:00:00.000Z');
    assert.equal(world.systems.timeConfig.startHour, 6);
    assert.equal(world.systems.tideConfig.cycleMinutes, 1440);
    assert.equal(world.systems.weatherConfig.climate, 'desert');
    assert.equal(world.systems.weatherConfig.seed, 'tel-mora');
    assert.equal(world.systems.weatherConfig.cadenceMinutes, 45);
    assert.deepEqual(world.systems.economyConfig?.goods, {
      copper: 'scarce',
      'reed-cloth': 'abundant',
      'dried-fish': 'abundant',
      'clean-water': 'scarce',
      clay: 'abundant',
      mudbrick: 'abundant',
    });

    assert.equal(world.actors['player-1']?.inventory.includes('surveyors-rod'), true);
    assert.equal(world.actors['player-1']?.inventory.includes('survey-kit'), true);
    assert.equal(world.actors['deshur']?.inventory.includes('deshur-tablet'), true);
    assert.equal(world.actors['deshur']?.inventory.includes('deshur-stylus'), true);

    assert.deepEqual(getItemPlacement(world.spine, 'surveyors-rod'), { type: 'carried_by', actorId: 'player-1' });
    assert.deepEqual(getItemPlacement(world.spine, 'survey-kit'), { type: 'carried_by', actorId: 'player-1' });
    assert.deepEqual(getItemPlacement(world.spine, 'wax-tablet'), { type: 'inside', containerId: 'survey-kit' });
    assert.deepEqual(getItemPlacement(world.spine, 'stylus'), { type: 'inside', containerId: 'survey-kit' });
    assert.deepEqual(getItemPlacement(world.spine, 'chalk-stick'), { type: 'inside', containerId: 'survey-kit' });
    assert.deepEqual(getItemPlacement(world.spine, 'measuring-cord'), { type: 'inside', containerId: 'survey-kit' });
    assert.deepEqual(getItemPlacement(world.spine, 'deshur-tablet'), { type: 'carried_by', actorId: 'deshur' });
    assert.deepEqual(getItemPlacement(world.spine, 'deshur-stylus'), { type: 'carried_by', actorId: 'deshur' });

    assert.equal(world.spine.entities['survey-kit']?.components.container?.capacityL, 1.2);
    assert.equal(world.spine.entities['survey-kit']?.components.container?.sealed, false);
    assert.equal(world.spine.entities['surveyors-rod']?.components.physical?.lengthCm, 180);
    assert.equal(world.spine.entities['surveyors-rod']?.components.material?.primary, 'reedwood');

    assert.equal(world.ledger.length >= 5, true);
    assert.equal(world.ledger.some(entry => entry.text.includes('preliminary recommendation')), true);
    assert.equal(world.ledger.some(entry => entry.text.includes("surveyor's rod carried to the Silted Lock")), true);
    assert.equal(world.ledger.some(entry => entry.text.includes('Old Kesh wants the Cut walked')), true);
    assert.equal(world.ledger.some(entry => entry.tags?.includes('water')), true);

    assert.equal(world.knowledge['player-1']?.seenLocations['the-assessors-shade'], true);
    assert.equal(world.knowledge['player-1']?.seenActors['deshur'], true);
    assert.equal(world.knowledge['player-1']?.seenItems['survey-kit'], true);
  });
});
