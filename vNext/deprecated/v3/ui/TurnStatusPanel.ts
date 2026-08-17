import chalk from 'chalk';
import logUpdate from 'log-update';
import type { GMEvent } from '../agents/gm';

export type VerbosityLevel = 0 | 1 | 2;

type TurnPhase = 'idle' | 'gm_llm' | 'gm_tools' | 'narrator' | 'error';

interface ToolRun {
  name: string;
  status: 'running' | 'done' | 'error';
  input?: unknown;
  output?: unknown;
  startedAt?: number;
  elapsedMs?: number;
}

interface TurnUIState {
  phase: TurnPhase;
  gmThinking: boolean;
  currentTool?: ToolRun;
  toolsRun: ToolRun[];
  errors: string[];
  tokenCount: number;
  lastAgentNote?: string;
  tokenTail: string;
}

const FRAMES = ['◐', '◓', '◑', '◒'];

export class TurnStatusPanel {
  private state: TurnUIState = {
    phase: 'idle',
    gmThinking: false,
    toolsRun: [],
    errors: [],
    tokenCount: 0,
    tokenTail: '',
  };

  private frame = 0;
  private ticker?: NodeJS.Timeout;
  private active = false;
  private verbosity: VerbosityLevel;

  constructor(initialVerbosity: VerbosityLevel) {
    this.verbosity = initialVerbosity;
  }

  setVerbosity(level: VerbosityLevel) {
    this.verbosity = level;
  }

  start() {
    if (this.verbosity === 0 || this.active) return;
    this.active = true;
    this.render();
    this.ticker = setInterval(() => this.render(), 120);
  }

  stop() {
    if (!this.active) return;
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
    this.active = false;
    logUpdate.clear();
    logUpdate.done();
  }

  onEvent(event: GMEvent) {
    if (!this.active || this.verbosity === 0) return;

    switch (event.type) {
      case 'llm_start':
        this.state.phase = 'gm_llm';
        this.state.gmThinking = true;
        this.state.tokenCount = 0;
        this.state.tokenTail = '';
        this.state.toolsRun = [];
        this.state.currentTool = undefined;
        this.state.errors = [];
        this.state.lastAgentNote = undefined;
        break;
      case 'llm_token':
        this.state.tokenCount += 1;
        this.state.tokenTail = (this.state.tokenTail + event.token)
          .replace(/\s+/g, ' ')
          .slice(-80);
        break;
      case 'llm_end':
        this.state.gmThinking = false;
        break;
      case 'tool_start':
        this.state.phase = 'gm_tools';
        const toolStartTime = Date.now();
        this.state.currentTool = {
          name: event.tool,
          status: 'running',
          input: event.input,
          startedAt: toolStartTime,
        };
        // Also add to toolsRun list for history
        const existingRunning = this.state.toolsRun.find((t) => t.name === event.tool && t.status === 'running');
        if (!existingRunning) {
          this.state.toolsRun.push({
            name: event.tool,
            status: 'running',
            input: event.input,
            startedAt: toolStartTime,
          });
        }
        break;
      case 'tool_end': {
        const toolEndTime = Date.now();
        const existing = this.state.toolsRun.find((t) => t.name === event.tool);
        if (existing) {
          existing.status = 'done';
          existing.output = event.output;
          if (existing.startedAt) {
            existing.elapsedMs = toolEndTime - existing.startedAt;
          }
        } else {
          this.state.toolsRun.push({
            name: event.tool,
            status: 'done',
            output: event.output,
            startedAt: toolEndTime,
            elapsedMs: 0,
          });
        }
        if (this.state.currentTool && this.state.currentTool.name === event.tool) {
          this.state.currentTool.status = 'done';
          this.state.currentTool.output = event.output;
          if (this.state.currentTool.startedAt) {
            this.state.currentTool.elapsedMs = toolEndTime - this.state.currentTool.startedAt;
          }
          // Keep currentTool visible briefly, then clear it
          setTimeout(() => {
            if (this.state.currentTool?.name === event.tool) {
              this.state.currentTool = undefined;
              this.render();
            }
          }, 500);
        }
        break;
      }
      case 'agent_action':
        if (this.verbosity >= 2) {
          try {
            const tool = (event.action as any)?.tool;
            if (tool) {
              this.state.lastAgentNote = `Planning to use ${String(tool)}`;
            }
          } catch {
            // ignore malformed action
          }
        }
        break;
      case 'error':
        this.state.phase = 'error';
        this.state.errors.push(event.message);
        break;
      default:
        break;
    }

    this.render();
  }

  onNarratorStart() {
    if (!this.active || this.verbosity === 0) return;
    this.state.phase = 'narrator';
    this.render();
  }

  onNarratorEnd() {
    if (!this.active || this.verbosity === 0) return;
    this.state.phase = 'idle';
    this.render();
  }

  private render() {
    if (!this.active || this.verbosity === 0) return;

    this.frame = (this.frame + 1) % FRAMES.length;
    const lines: string[] = [];

    lines.push(this.renderGMLine());

    if (this.verbosity >= 1) {
      const toolsLine = this.renderToolsLine();
      if (toolsLine) lines.push(toolsLine);
    }

    if (this.verbosity >= 2) {
      const debugLine = this.renderDebugLine();
      if (debugLine) lines.push(debugLine);
    }

    logUpdate(lines.join('\n'));
  }

  private renderGMLine(): string {
    const frame = FRAMES[this.frame];
    let phaseLabel = 'Idle';
    if (this.state.phase === 'gm_llm') phaseLabel = 'GM thinking';
    else if (this.state.phase === 'gm_tools') phaseLabel = 'GM using tools';
    else if (this.state.phase === 'narrator') phaseLabel = 'Narrator composing';
    else if (this.state.phase === 'error') phaseLabel = 'Error';

    const parts: string[] = [];
    parts.push(`${chalk.cyan(`[${frame}] ${phaseLabel}`)}`);

    if (this.state.phase === 'gm_llm' && this.verbosity >= 2) {
      parts.push(chalk.dim(`tokens: ${this.state.tokenCount}`));
    }

    if (this.state.phase === 'gm_llm' && this.state.tokenTail) {
      parts.push(chalk.dim(this.state.tokenTail));
    }

    if (this.state.errors.length) {
      const last = this.state.errors[this.state.errors.length - 1];
      parts.push(chalk.red(`⚠ ${last}`));
    }

    return parts.join('  ');
  }

  private renderToolsLine(): string | null {
    const items: string[] = [];

    // Show currently running tool with details
    if (this.state.currentTool && this.state.currentTool.status === 'running') {
      const toolInfo = this.describeToolCall(this.state.currentTool.name, this.state.currentTool.input);
      items.push(chalk.white(`→ ${this.state.currentTool.name}${toolInfo ? ` ${chalk.dim(`(${toolInfo})`)}` : ''}`));
    }

    // Show completed tools with summary
    if (this.state.toolsRun.length) {
      const completed = this.state.toolsRun.filter((t) => t.status === 'done');
      if (completed.length > 0) {
        const toolSummaries = completed.map((t, idx) => {
          const info = this.describeToolCall(t.name, t.input, t.output);
          const elapsed = t.elapsedMs ? chalk.dim(` (${t.elapsedMs}ms)`) : '';
          const prefix = this.verbosity >= 2 ? `${idx + 1}. ` : '';
          return `${prefix}${chalk.green('✓')} ${t.name}${info ? chalk.dim(` ${info}`) : ''}${elapsed}`;
        });
        items.push(toolSummaries.join('  '));
      }
    }

    if (!items.length) return null;
    return `Tools: ${items.join('\n      ')}`;
  }

  private describeToolCall(toolName: string, input?: unknown, output?: unknown): string | null {
    try {
      // Describe input
      if (toolName === 'apply_patches') {
        const count = Array.isArray((input as any)?.patches) ? (input as any).patches.length : 0;
        return count > 0 ? `${count} patch${count !== 1 ? 'es' : ''}` : 'empty patches';
      }
      if (toolName === 'query_world') {
        const q = (input as any)?.query;
        return q ? `"${q}"` : 'full state';
      }
      if (toolName === 'create_entity') {
        const type = (input as any)?.type;
        const name = (input as any)?.props?.name;
        if (type && name) return `${type}: ${name}`;
        if (type) return type;
      }
      if (toolName === 'create_relation') {
        const pred = (input as any)?.pred;
        return pred || null;
      }
      if (toolName === 'move_to_position') {
        const to = (input as any)?.to;
        const delta = (input as any)?.delta;
        if (to) return `to (${to.x}, ${to.y})`;
        if (delta) return `delta (${delta.dx || 0}, ${delta.dy || 0})`;
      }
      if (toolName === 'travel_to_location') {
        const locId = (input as any)?.locationId;
        return locId || null;
      }
      if (toolName === 'estimate_travel') {
        const locId = (input as any)?.locationId;
        const to = (input as any)?.to;
        if (locId) return `to ${locId}`;
        if (to) return `to (${to.x}, ${to.y})`;
      }

      // Describe output for some tools
      if (output && toolName === 'query_world') {
        const parsed = this.parseMaybeJson(output);
        const locName = parsed?.currentLocation?.name;
        if (locName) return `→ at ${locName}`;
      }
      if (output && toolName === 'create_entity') {
        const parsed = this.parseMaybeJson(output);
        const id = parsed?.id;
        if (id) return `→ id: ${id}`;
      }

      return null;
    } catch {
      return null;
    }
  }

  private parseMaybeJson(value: unknown): any {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    }
    return value;
  }

  private renderDebugLine(): string | null {
    const lines: string[] = [];
    
    if (this.state.lastAgentNote) {
      lines.push(chalk.gray(`Debug: ${this.state.lastAgentNote}`));
    }

    // Show detailed tool call info at verbosity 2
    if (this.verbosity >= 2 && this.state.toolsRun.length > 0) {
      const detailedTools = this.state.toolsRun
        .filter((t) => t.status === 'done')
        .map((t) => {
          const inputStr = this.formatToolInput(t.name, t.input);
          const outputStr = this.formatToolOutput(t.name, t.output);
          const parts: string[] = [];
          if (inputStr) parts.push(`in: ${chalk.dim(inputStr)}`);
          if (outputStr) parts.push(`out: ${chalk.dim(outputStr)}`);
          return parts.length > 0 ? `${chalk.cyan(t.name)}: ${parts.join(' | ')}` : null;
        })
        .filter((s): s is string => s !== null);
      
      if (detailedTools.length > 0) {
        lines.push(...detailedTools);
      }
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  private formatToolInput(toolName: string, input?: unknown): string {
    if (!input) return '';
    try {
      const str = typeof input === 'string' ? input : JSON.stringify(input);
      // Truncate long inputs
      if (str.length > 100) {
        return str.slice(0, 97) + '...';
      }
      return str;
    } catch {
      return String(input);
    }
  }

  private formatToolOutput(toolName: string, output?: unknown): string {
    if (!output) return '';
    try {
      const parsed = this.parseMaybeJson(output);
      // For query_world, show location name
      if (toolName === 'query_world' && parsed?.currentLocation?.name) {
        return `at ${parsed.currentLocation.name}`;
      }
      // For create_entity, show ID
      if (toolName === 'create_entity' && parsed?.id) {
        return `id: ${parsed.id}`;
      }
      // For apply_patches, show count
      if (toolName === 'apply_patches' && parsed?.ok !== undefined) {
        return parsed.ok ? 'ok' : 'failed';
      }
      // Default: show truncated JSON
      const str = typeof output === 'string' ? output : JSON.stringify(output);
      if (str.length > 80) {
        return str.slice(0, 77) + '...';
      }
      return str;
    } catch {
      return String(output).slice(0, 80);
    }
  }
}


