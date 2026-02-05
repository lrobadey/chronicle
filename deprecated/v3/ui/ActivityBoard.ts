import chalk from 'chalk';
import boxen from 'boxen';
import wrapAnsi from 'wrap-ansi';
import logUpdate from 'log-update';
import type { Patch } from '../tools/types';

export type GMEvent =
  | { type: 'llm_start'; prompts: string[] }
  | { type: 'llm_token'; token: string }
  | { type: 'llm_end' }
  | { type: 'tool_start'; tool: string; input: unknown }
  | { type: 'tool_end'; tool: string; output: unknown }
  | { type: 'agent_action'; action: unknown }
  | { type: 'error'; message: string };

type ToolId =
  | 'query_world'
  | 'apply_patches'
  | 'project_pkg'
  | 'create_entity'
  | 'create_relation'
  | 'move_to_position'
  | 'travel_to_location'
  | 'estimate_travel';

type ToolState = { status: 'idle' | 'active' | 'done' | 'error'; lastInfo?: string; startedAt?: number; elapsedMs?: number };

const TOOL_COLORS: Record<ToolId, (s: string) => string> = {
  query_world: chalk.cyan,
  apply_patches: chalk.magenta,
  project_pkg: chalk.green,
  create_entity: chalk.yellow,
  create_relation: chalk.blue,
};

function termWidth(): number {
  return Math.max(60, Math.min(120, process.stdout.columns || 80));
}

function panel(title: string, content: string, color: (s: string) => string): string {
  const width = termWidth();
  const wrapped = wrapAnsi(content, Math.min(width - 6, 100));
  return boxen(`${chalk.bold(color(title))}\n${wrapped}`, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: color === chalk.cyan ? 'cyan' : color === chalk.magenta ? 'magenta' : 'gray'
  });
}

const FRAMES = ['◐', '◓', '◑', '◒'];

export class ActivityBoard {
  private tools: Record<ToolId, ToolState>;
  private thoughts: string[];
  private tokenTail: string;
  private frame = 0;
  private ticker?: NodeJS.Timeout;
  private visible = false;
  private timeline: { at: number; text: string }[] = [];
  private contractViolations: string[] = [];
  private planLines: string[] = [];
  private metricsLine?: string;

  constructor() {
    this.tools = {
      query_world: { status: 'idle' },
      apply_patches: { status: 'idle' },
      project_pkg: { status: 'idle' },
      create_entity: { status: 'idle' },
      create_relation: { status: 'idle' }
    };
    this.thoughts = [];
    this.tokenTail = '';
  }

  start() {
    this.visible = true;
    this.draw(); // Initial render
    this.ticker = setInterval(() => this.draw(), 100);
  }

  stop() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
    this.draw();
    logUpdate.done();
    this.visible = false;
  }

  onEvent(e: GMEvent) {
    if (e.type === 'llm_start') {
      this.tokenTail = '';
      this.planLines = [];
      this.contractViolations = [];
      this.metricsLine = undefined;
      this.pushTimeline('LLM start');
    } else if (e.type === 'llm_token') {
      this.tokenTail = (this.tokenTail + e.token).replace(/\s+/g, ' ').slice(-60);
    } else if (e.type === 'tool_start') {
      const id = this.asToolId(e.tool);
      if (!id) return;
      this.tools[id] = { status: 'active', startedAt: Date.now(), lastInfo: this.describeInput(id, e.input) };
      this.pushThought(this.summarizeStart(id, e.input));
      this.pushTimeline(`▶ ${id}${this.tools[id].lastInfo ? ` — ${this.tools[id].lastInfo}` : ''}`);
    } else if (e.type === 'tool_end') {
      const id = this.asToolId(e.tool);
      if (!id) return;
      const info = this.describeOutput(id, e.output);
      const startedAt = this.tools[id]?.startedAt || Date.now();
      const elapsedMs = Date.now() - startedAt;
      this.tools[id] = { status: 'done', lastInfo: info, startedAt, elapsedMs };
      this.pushThought(this.summarizeEnd(id, e.output));
      this.pushTimeline(`✓ ${id}${info ? ` — ${info}` : ''} (${elapsedMs}ms)`);
      const m = this.deriveMetrics(id, e.output);
      if (m) this.metricsLine = m;
    } else if (e.type === 'agent_action') {
      const t = this.summarizeAgentAction(e.action);
      if (t) this.planLines = [t];
      this.pushThought(t);
      if (t) this.pushTimeline(`Plan — ${t}`);
    } else if (e.type === 'error') {
      const msg = chalk.red(`Error: ${e.message}`);
      this.pushThought(msg);
      this.contractViolations.push(e.message);
      this.pushTimeline(`⚠ ${e.message}`);
    }
  }

  renderStatic(intermediateSteps: any[], patches: Patch[]): string {
    const parts: string[] = [];
    parts.push(this.renderHeader());
    parts.push(this.renderBadges());
    const thoughtLines = this.renderThoughtsFromSteps(intermediateSteps);
    if (thoughtLines) parts.push(thoughtLines);
    const timeline = this.renderTimeline();
    if (timeline) parts.push(timeline);
    if (this.planLines.length) {
      parts.push(panel('Plan', chalk.white(this.planLines.join('\n')), chalk.gray));
    }
    if (this.contractViolations.length) {
      parts.push(panel('Contract', chalk.red(`Retry: ${this.contractViolations.join('; ')}`), chalk.red));
    }
    if (this.metricsLine) {
      parts.push(panel('Metrics', chalk.white(this.metricsLine), chalk.gray));
    }
    if (patches?.length) {
      parts.push(panel('Patches', chalk.white(`${patches.length} patch(es)`), chalk.gray));
    }
    return parts.join('\n');
  }

  private draw() {
    if (!this.visible) return;
    this.frame = (this.frame + 1) % FRAMES.length;
    const parts: string[] = [];
    parts.push(this.renderHeader());
    parts.push(this.renderBadges());
    const timeline = this.renderTimeline();
    if (timeline) parts.push(timeline);
    logUpdate(parts.join('\n'));
  }

  private renderHeader(): string {
    const left = chalk.cyan('GM thinking… ') + chalk.dim(this.tokenTail);
    return panel('Agent', left, chalk.cyan);
  }

  private renderBadges(): string {
    const lines: string[] = [];
    const items: string[] = [];
    (Object.keys(this.tools) as ToolId[]).forEach((id) => {
      items.push(this.renderBadge(id, this.tools[id]));
    });
    lines.push(items.join('  '));
    return panel('Tools', lines.join('\n'), chalk.gray);
  }

  private renderBadge(id: ToolId, state: ToolState): string {
    const color = TOOL_COLORS[id];
    const name = id;
    if (state.status === 'idle') {
      return chalk.dim(`[${name}]`);
    }
    if (state.status === 'active') {
      const frame = FRAMES[this.frame];
      return chalk.black.bgWhite(` ${frame} ${name} `);
    }
    if (state.status === 'error') {
      return chalk.white.bgRed(` ✖ ${name} `);
    }
    const dur = typeof state.elapsedMs === 'number' ? ` ${state.elapsedMs}ms` : '';
    return color(` ✓ ${name}${dur ? ` ${dur}` : ''} `);
  }

  private pushThought(text: string | undefined) {
    if (!text) return;
    this.thoughts.push(text);
    if (this.thoughts.length > 6) this.thoughts.shift();
  }

  private renderThoughtsFromSteps(steps: any[]): string | null {
    const isSteps = Array.isArray(steps) && steps.length > 0;
    const lines = isSteps ? summarizeSteps(steps).slice(-6) : this.thoughts.slice(-6);
    if (!lines.length) return null;
    const title = isSteps ? 'Steps' : 'Thoughts';
    return panel(title, lines.join('\n'), chalk.yellow);
  }

  private asToolId(name: string | undefined): ToolId | null {
    const n = (name || '').toLowerCase();
    if (n in this.tools) return n as ToolId;
    return null;
  }

  private describeInput(id: ToolId, input: unknown): string | undefined {
    try {
      if (id === 'apply_patches') {
        const count = Array.isArray((input as any)?.patches) ? (input as any).patches.length : undefined;
        return count != null ? `${count} patch(es)` : undefined;
      }
      if (id === 'query_world') {
        const q = (input as any)?.query;
        return q ? `query "${q}"` : 'inspect state';
      }
      if (id === 'create_entity') {
        const type = (input as any)?.type;
        const name = (input as any)?.props?.name;
        if (type && name) return `${type}: ${name}`;
        if (type) return type;
        return undefined;
      }
      if (id === 'create_relation') {
        const pred = (input as any)?.pred;
        const direction = (input as any)?.props?.direction;
        return pred ? `${pred}${direction ? ` (${direction})` : ''}` : undefined;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private describeOutput(id: ToolId, output: unknown): string | undefined {
    try {
      const parsed = this.parseMaybeJson(output);
      if (id === 'query_world') {
        const locName = parsed?.currentLocation?.name;
        return locName ? `at ${locName}` : undefined;
      }
      if (id === 'apply_patches') {
        return parsed?.ok ? 'ok' : undefined;
      }
      if (id === 'project_pkg') {
        const exits = parsed?.exits ? Object.keys(parsed.exits).length : undefined;
        return exits != null ? `${exits} exit(s)` : undefined;
      }
      if (id === 'create_entity') {
        return parsed?.note || (parsed?.id ? `id ${parsed.id}` : undefined);
      }
      if (id === 'create_relation') {
        return parsed?.note || (parsed?.id ? `id ${parsed.id}` : undefined);
      }
      return undefined;
    } catch {
      return undefined;
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

  private summarizeStart(id: ToolId, _input: unknown): string | undefined {
    if (id === 'query_world') return 'Inspecting world state…';
    if (id === 'apply_patches') return 'Applying world updates…';
    if (id === 'project_pkg') return 'Projecting PKG…';
    if (id === 'create_entity') return 'Creating entity…';
    if (id === 'create_relation') return 'Linking entities…';
    return undefined;
  }

  private summarizeEnd(id: ToolId, output: unknown): string | undefined {
    const info = this.describeOutput(id, output);
    if (id === 'query_world') return info ? `World inspected: ${info}` : 'World inspected.';
    if (id === 'apply_patches') return 'Patches applied.';
    if (id === 'project_pkg') return info ? `PKG projected (${info})` : 'PKG projected.';
    if (id === 'create_entity') return info ? `Entity created: ${info}` : 'Entity created.';
    if (id === 'create_relation') return info ? `Relation created: ${info}` : 'Relation created.';
    return undefined;
  }

  private summarizeAgentAction(_action: unknown): string | undefined {
    try {
      const a = _action as any;
      const tool = a?.tool;
      if (tool) return `Will use ${String(tool)}`;
    } catch {}
    return undefined;
  }

  private pushTimeline(text: string) {
    this.timeline.push({ at: Date.now(), text });
    if (this.timeline.length > 30) this.timeline.shift();
  }

  private renderTimeline(): string | null {
    if (!this.timeline.length) return null;
    const items = this.timeline.slice(-10).map((e) => {
      const t = new Date(e.at).toLocaleTimeString();
      return `${t}  ${e.text}`;
    });
    return panel('Timeline', items.join('\n'), chalk.gray);
  }

  private deriveMetrics(id: ToolId, output: unknown): string | undefined {
    const parsed = this.parseMaybeJson(output);
    const travel = (parsed?.travel || parsed?.travelResult || parsed?.stateSummary?.travel) as any;
    if (!travel) return undefined;
    const dist = travel.distanceMeters ?? travel.distance ?? travel.meters;
    const mins = travel.travelTimeMinutes ?? travel.minutes ?? travel.time ?? travel.duration;
    const terr = travel.terrainMultiplier ?? travel.multiplier;
    const dest = travel.toName || travel.destinationName || travel.destination || travel.to;
    const parts: string[] = [];
    if (Number.isFinite(dist)) parts.push(`${Math.round(dist)}m`);
    if (Number.isFinite(mins)) parts.push(`${Math.round(mins)} min`);
    if (Number.isFinite(terr)) parts.push(`terrain x${Number(terr).toFixed(2)}`);
    const left = parts.join(' in ');
    return left || dest ? `${left}${dest ? ` → ${dest}` : ''}` : undefined;
  }
}

export function summarizeSteps(steps: any[]): string[] {
  const out: string[] = [];
  const parseMaybeJson = (value: unknown) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    }
    return value;
  };
  for (const s of steps || []) {
    const tool = s?.action?.tool as string | undefined;
    const input = s?.action?.toolInput;
    const obs = s?.observation;
    if (!tool) continue;
    const t = tool.toLowerCase();
    if (t === 'query_world') {
      const parsed = parseMaybeJson(obs);
      const loc = parsed?.currentLocation?.name;
      out.push(`Inspect world${loc ? ` → ${loc}` : ''}`.trim());
    } else if (t === 'apply_patches') {
      const count = Array.isArray(s?.action?.toolInput?.patches) ? s.action.toolInput.patches.length : undefined;
      out.push(`Apply ${count != null ? count : '?'} patch(es)`);
    } else if (t === 'project_pkg') {
      const parsed = parseMaybeJson(obs);
      const exits = parsed?.exits ? Object.keys(parsed.exits).length : undefined;
      out.push(`Project PKG${exits != null ? ` (${exits} exit(s))` : ''}`.trim());
    } else if (t === 'create_entity') {
      const type = (input as any)?.type;
      const name = (input as any)?.props?.name;
      out.push(`Create entity${type ? ` [${type}${name ? `: ${name}` : ''}]` : ''}`.trim());
    } else if (t === 'create_relation') {
      const pred = (input as any)?.pred;
      const dir = (input as any)?.props?.direction;
      const subj = (input as any)?.subj;
      const obj = (input as any)?.obj;
      const details = [pred ? `[${pred}]` : null, dir ? `(${dir})` : null, subj && obj ? `${subj}→${obj}` : null].filter(Boolean).join(' ');
      out.push(`Create relation${details ? ` ${details}` : ''}`.trim());
    } else {
      out.push(`Use ${t}`);
    }
  }
  return out;
}


