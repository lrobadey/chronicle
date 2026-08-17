import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCommand } from '../../cli/commandParsing';

describe('CLI command parsing', () => {
  it('normalizes command names and preserves arguments', () => {
    assert.deepEqual(parseCommand('/STYLE lyric cinematic'), {
      name: 'style',
      args: ['lyric', 'cinematic'],
    });
  });

  it('handles commands without arguments', () => {
    assert.deepEqual(parseCommand('/help'), {
      name: 'help',
      args: [],
    });
  });
});
