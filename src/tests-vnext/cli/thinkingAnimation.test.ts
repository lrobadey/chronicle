import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ThinkingAnimation, phaseLabel, renderThinkingFrame } from '../../cli/thinkingAnimation';

class FakeTerminal {
  readonly events: string[] = [];

  supportsTransientStatus(): boolean {
    return true;
  }

  renderTransientStatus(text: string): void {
    this.events.push(`render:${text}`);
  }

  clearTransientStatus(): void {
    this.events.push('clear');
  }
}

class FakeClock {
  callback: (() => void) | undefined;
  cleared = false;

  setInterval(callback: () => void, _delayMs: number) {
    this.callback = callback;
    return 'timer';
  }

  clearInterval(_handle: unknown) {
    this.cleared = true;
    this.callback = undefined;
  }

  tick() {
    this.callback?.();
  }
}

describe('thinkingAnimation', () => {
  it('maps phases to the marrow pulse copy', () => {
    assert.equal(phaseLabel('opening'), 'sounding the tide');
    assert.equal(phaseLabel('thinking'), 'the marrow listens');
    assert.equal(phaseLabel('narrating'), 'a voice gathers');
    assert.equal(renderThinkingFrame(0, 'thinking', false), '◐ the marrow listens');
  });

  it('rotates frames while active', () => {
    const terminal = new FakeTerminal();
    const clock = new FakeClock();
    const animation = new ThinkingAnimation({
      terminal,
      clock,
      intervalMs: 100,
    });

    animation.start('thinking');
    clock.tick();
    clock.tick();

    assert.deepEqual(terminal.events, [
      'render:◐ the marrow listens',
      'render:◓ the marrow listens',
      'render:◑ the marrow listens',
    ]);
  });

  it('clears before durable writes, resumes after, and clears on stop', () => {
    const terminal = new FakeTerminal();
    const clock = new FakeClock();
    const animation = new ThinkingAnimation({
      terminal,
      clock,
      intervalMs: 100,
    });

    animation.start('opening');
    animation.beforeWrite();
    animation.afterWrite();
    animation.setPhase('narrating');
    animation.stop();

    assert.deepEqual(terminal.events, [
      'render:◐ sounding the tide',
      'clear',
      'render:◐ sounding the tide',
      'render:◐ a voice gathers',
      'clear',
    ]);
    assert.equal(clock.cleared, true);
  });
});
