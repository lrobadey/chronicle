import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_WORLD_ID, listWorldModules, resolveWorldModule } from '../../worlds';

describe('world registry', () => {
  it('lists and resolves both built-in worlds', () => {
    const ids = listWorldModules().map(module => module.id).sort();
    assert.deepEqual(ids, ['isle-of-marrow', 'tel-mora']);
    assert.equal(resolveWorldModule('isle-of-marrow').displayName, 'Isle of Marrow');
    assert.equal(resolveWorldModule('tel-mora').displayName, 'Tel Mora — The Dead Junction');
  });

  it('keeps the default world id stable', () => {
    assert.equal(DEFAULT_WORLD_ID, 'isle-of-marrow');
    assert.equal(resolveWorldModule().id, DEFAULT_WORLD_ID);
  });

  it('rejects unknown world ids deterministically', () => {
    assert.throws(
      () => resolveWorldModule('missing-world'),
      /Unknown world id: missing-world\. Valid worlds: isle-of-marrow, tel-mora/,
    );
  });
});
