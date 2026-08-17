export type ThinkingPhase = 'opening' | 'thinking' | 'narrating';

export interface ThinkingAnimationTerminal {
  supportsTransientStatus(): boolean;
  renderTransientStatus(text: string): void;
  clearTransientStatus(): void;
}

interface ThinkingAnimationClock {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ThinkingAnimationOptions {
  terminal: ThinkingAnimationTerminal;
  ansi?: boolean;
  intervalMs?: number;
  clock?: ThinkingAnimationClock;
}

const FRAMES = ['◐', '◓', '◑', '◒'] as const;

const DEFAULT_CLOCK: ThinkingAnimationClock = {
  setInterval(callback, delayMs) {
    return setInterval(callback, delayMs);
  },
  clearInterval(handle) {
    clearInterval(handle as NodeJS.Timeout);
  },
};

export function phaseLabel(phase: ThinkingPhase): string {
  switch (phase) {
    case 'opening':
      return 'sounding the tide';
    case 'thinking':
      return 'the marrow listens';
    case 'narrating':
      return 'a voice gathers';
  }
}

export function renderThinkingFrame(frameIndex: number, phase: ThinkingPhase, ansi = false): string {
  const frame = FRAMES[((frameIndex % FRAMES.length) + FRAMES.length) % FRAMES.length];
  const label = phaseLabel(phase);
  if (!ansi) return `${frame} ${label}`;
  return `\x1b[2;36m${frame}\x1b[0m \x1b[90m${label}\x1b[0m`;
}

export class ThinkingAnimation {
  private readonly terminal: ThinkingAnimationTerminal;
  private readonly ansi: boolean;
  private readonly intervalMs: number;
  private readonly clock: ThinkingAnimationClock;
  private phase: ThinkingPhase = 'thinking';
  private frameIndex = 0;
  private timer: unknown;
  private active = false;
  private visible = false;
  private suspendDepth = 0;

  constructor(options: ThinkingAnimationOptions) {
    this.terminal = options.terminal;
    this.ansi = Boolean(options.ansi);
    this.intervalMs = options.intervalMs ?? 120;
    this.clock = options.clock ?? DEFAULT_CLOCK;
  }

  start(phase: ThinkingPhase) {
    if (!this.terminal.supportsTransientStatus()) return;
    this.phase = phase;
    this.frameIndex = 0;
    this.active = true;
    this.suspendDepth = 0;
    this.render();
    if (this.timer == null) {
      this.timer = this.clock.setInterval(() => this.tick(), this.intervalMs);
    }
  }

  setPhase(phase: ThinkingPhase) {
    this.phase = phase;
    if (this.active) {
      this.render();
    }
  }

  stop() {
    if (this.timer != null) {
      this.clock.clearInterval(this.timer);
      this.timer = undefined;
    }
    this.active = false;
    this.suspendDepth = 0;
    this.hide();
  }

  beforeWrite() {
    if (!this.active) return;
    this.suspendDepth += 1;
    this.hide();
  }

  afterWrite() {
    if (!this.active || this.suspendDepth === 0) return;
    this.suspendDepth -= 1;
    if (this.suspendDepth === 0) {
      this.render();
    }
  }

  isActive() {
    return this.active;
  }

  private tick() {
    if (!this.active) return;
    this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
    this.render();
  }

  private render() {
    if (!this.active || this.suspendDepth > 0 || !this.terminal.supportsTransientStatus()) return;
    this.terminal.renderTransientStatus(renderThinkingFrame(this.frameIndex, this.phase, this.ansi));
    this.visible = true;
  }

  private hide() {
    if (!this.visible) return;
    this.terminal.clearTransientStatus();
    this.visible = false;
  }
}
