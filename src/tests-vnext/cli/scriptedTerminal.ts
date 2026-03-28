import type { CliTerminal } from '../../cli/app';

export class ScriptedTerminal implements CliTerminal {
  readonly prompts: string[] = [];
  readonly writes: string[] = [];
  closed = false;

  constructor(
    private readonly inputs: string[],
    private readonly tty = true,
  ) {}

  isTTY(): boolean {
    return this.tty;
  }

  write(text: string): void {
    this.writes.push(text);
  }

  async readLine(prompt: string): Promise<string | null> {
    this.prompts.push(prompt);
    return this.inputs.length ? this.inputs.shift() ?? null : null;
  }

  close(): void {
    this.closed = true;
  }

  output(): string {
    return this.writes.join('');
  }
}
