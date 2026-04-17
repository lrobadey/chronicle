import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { TurnEngine } from '../../engine/turnEngine';
import { JsonlSessionStore } from '../../engine/session/jsonlStore';
import { runOperatorCli } from '../../cli/operatorCli';
import { ScriptedTerminal } from './scriptedTerminal';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0, roots.length)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

class AnimatedTerminal extends ScriptedTerminal {
  readonly transientEvents: string[] = [];

  override supportsTransientStatus(): boolean {
    return true;
  }

  override renderTransientStatus(text: string): void {
    this.transientEvents.push(`render:${text}`);
  }

  override clearTransientStatus(): void {
    this.transientEvents.push('clear');
  }
}

async function createEngine() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chronicle-operator-cli-'));
  roots.push(rootDir);
  const store = new JsonlSessionStore(rootDir);
  const engine = new TurnEngine({ store });
  return { engine, store };
}

describe('operator CLI play mode', () => {
  it('prompts for a world before starting play mode', async () => {
    const { engine, store } = await createEngine();
    const terminal = new AnimatedTerminal(['2', ':exit']);

    const exitCode = await runOperatorCli({
      argv: [],
      env: { CHRONICLE_API_MODE: 'fallback' },
      engine,
      store,
      playTerminal: terminal,
    });

    assert.equal(exitCode, 0);
    assert.equal(terminal.prompts[0], 'world> ');
    const output = terminal.output();
    assert.ok(output.includes('Choose a world:'));
    assert.ok(output.includes('Starting in Tel Mora — The Dead Junction.'));
    assert.ok(output.includes('## Chronicle Play'));
    assert.ok(output.includes('world=Tel Mora — The Dead Junction'));
  });

  it('shows transient thinking phases while a turn runs', async () => {
    const { engine, store } = await createEngine();
    const terminal = new AnimatedTerminal(['1', 'look around', ':exit']);

    const exitCode = await runOperatorCli({
      argv: [],
      env: { CHRONICLE_API_MODE: 'fallback' },
      engine,
      store,
      playTerminal: terminal,
    });

    assert.equal(exitCode, 0);
    assert.ok(terminal.transientEvents.some(event => event.includes('sounding the tide')));
    assert.ok(terminal.transientEvents.some(event => event.includes('the marrow listens')));
    assert.ok(terminal.transientEvents.some(event => event.includes('a voice gathers')));
    assert.equal(terminal.transientEvents.at(-1), 'clear');

    const output = terminal.output();
    assert.ok(output.includes('[route]'));
    assert.ok(output.includes('[state]'));
    assert.ok(output.includes('Hint: :inspect trace --view full | :inspect council | :inspect route'));
  });
});
