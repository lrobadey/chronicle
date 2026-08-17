import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatWorldTitle } from '../../web/App';

describe('web app world chrome', () => {
  it('renders the chosen world display name in the header title', () => {
    assert.equal(formatWorldTitle({
      id: 'tel-mora',
      displayName: 'Tel Mora — The Dead Junction',
    }), 'Tel Mora — The Dead Junction');
  });

  it('uses a neutral loading label before init completes', () => {
    assert.equal(formatWorldTitle(null), 'Loading world…');
  });
});
