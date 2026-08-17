#!/usr/bin/env tsx
// interactive-agent-cli.ts - Full multi-turn ReAct agent CLI with time + travel
// ============================================================================

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as fsSync from 'node:fs';

import { createAgentExecutor } from '../agent/AgentOrchestrator.js';
import { createPagusClanisGTWG, createPagusClanisQueryAdapter } from '../data/PagusClanis.js';
import { createEmptyCanonLedger } from '../data/CanonLedger.js';
import { formatIsoForDisplay, getSeason, getTimeOfDay } from '../engine/WorldTime.js';

async function main() {
  console.clear();
  console.log(chalk.bold.cyan('Chronicle V2 — Interactive Agent CLI'));
  console.log(chalk.gray('Type'), chalk.white('help'), chalk.gray('for commands.'));
  console.log();

  // World + runtime wiring
  let gtwg = createPagusClanisGTWG();
  let ledger = createEmptyCanonLedger();
  let tick = 0;
  let pkg: any = {
    discoveredFacts: [
      { entityId: 'gaius-aelius-secundus', discoveredAt: new Date().toISOString(), source: 'backstory' },
      { entityId: 'villa-aelia', discoveredAt: new Date().toISOString(), source: 'map' },
      { entityId: 'mansio-vallis', discoveredAt: new Date().toISOString(), source: 'map' },
    ],
    rumors: [],
    metadata: { version: '1.0.0', createdAt: new Date().toISOString(), lastModified: new Date().toISOString(), playerId: 'player-1' },
  };
  const history: { role: 'player' | 'agent'; text: string }[] = [];
  const runtime = {
    getGTWG: () => gtwg,
    setGTWG: (g: any) => { gtwg = g; },
    getLedger: () => ledger,
    setLedger: (l: any) => { ledger = l; },
    getTick: () => tick,
    // Provide real adapters for tools
    projectPKG: async ({ playerId, gtwg: _ }: { playerId: string; gtwg: any }) => {
      if (pkg?.metadata) {
        pkg.metadata.playerId = playerId;
        pkg.metadata.lastModified = new Date().toISOString();
      }
      return { pkg };
    },
    queryGTWG: createPagusClanisQueryAdapter(gtwg),
    queryPKG: async (query: Record<string, any>): Promise<any> => {
      const requestedType = typeof query === 'object' && query?.type ? query.type : 'any';
      const discoveredEntities = pkg.discoveredFacts.map((f: any) => (gtwg.entities as any[]).find(e => e.id === f.entityId)).filter(Boolean);
      let filtered = discoveredEntities;
      if (requestedType !== 'any') {
        if (requestedType === 'location' || requestedType === 'region') filtered = discoveredEntities.filter((e: any) => e.type === 'region');
        else if (requestedType === 'character' || requestedType === 'person') filtered = discoveredEntities.filter((e: any) => e.type === 'character');
      }
      return { data: { entities: filtered } };
    },
    getConversation: async (n: number) =>
      history.slice(-n).map((m) => `${m.role === 'player' ? 'Player' : 'Agent'}: ${m.text}`),
    getPlayerId: () => 'player-1',
  } as any;

  if (!process.env.OPENAI_API_KEY) {
    console.log(chalk.yellow('Note: OPENAI_API_KEY not set; the agent will not run LLM calls.'));
  }
  const executor = process.env.OPENAI_API_KEY ? await createAgentExecutor(runtime, { maxIterations: 12 }) : null as any;

  // Prefer real TTY for input so the REPL stays open even if stdin was piped
  let rlInput: any = input;
  try {
    if (process.env.FORCE_TTY !== '0' && fsSync.existsSync('/dev/tty')) {
      rlInput = fsSync.createReadStream('/dev/tty');
    }
  } catch {}
  const rl = readline.createInterface({ input: rlInput, output, terminal: true });

  function now(): string {
    return (gtwg as any)?.metadata?.worldTime || new Date().toISOString();
  }

  function showTimeContext() {
    const iso = now();
    const season = getSeason(iso);
    const tod = getTimeOfDay(iso);
    console.log(chalk.gray('Time:'), chalk.white(formatIsoForDisplay(iso)), chalk.gray('—'), chalk.white(`${season}, ${tod}`));
  }

  function whereAmI() {
    const player = (gtwg.entities as any[]).find(e => e.id === 'player-1');
    const locId = player?.properties?.current_location;
    const loc = (gtwg.entities as any[]).find(e => e.id === locId);
    console.log(chalk.gray('Location:'), chalk.white(loc?.name || locId || 'unknown'));
  }

  async function help() {
    console.log(chalk.bold('Commands:'));
    console.log('  ', chalk.white('<anything>'), chalk.gray('— send natural language to agent (multi-turn)'));
    console.log('  ', chalk.white('ask <message>'), chalk.gray('— explicit send to agent'));
    console.log('  ', chalk.white('time'), chalk.gray('— show world time context'));
    console.log('  ', chalk.white('where'), chalk.gray('— show current location'));
    console.log('  ', chalk.white('pkg'), chalk.gray('— list known entities in PKG'));
    console.log('  ', chalk.white('save [file]'), chalk.gray('— save world to file (default .agent_state.json)'));
    console.log('  ', chalk.white('load [file]'), chalk.gray('— load world from file'));
    console.log('  ', chalk.white('clear'), chalk.gray('— clear conversation history'));
    console.log('  ', chalk.white('help'), chalk.gray('— show this help'));
    console.log('  ', chalk.white('exit'), chalk.gray('— quit'));
    console.log();
  }

  console.log(chalk.gray('Starting world time:'), chalk.white(formatIsoForDisplay(now())));
  whereAmI();
  console.log();
  await help();

  // Optional: allow an initial message via CLI args, then continue REPL
  const initialMessage = process.argv.slice(2).join(' ').trim();
  if (initialMessage) {
    await handleAsk(initialMessage);
  }

  async function handleAsk(message: string) {
    if (!executor) {
      console.log(chalk.red('Agent unavailable: set OPENAI_API_KEY to use the agent.'));
      return;
    }
    const spinner = ora({ text: 'Agent thinking...', color: 'cyan' }).start();
    const conversation = await runtime.getConversation(10);
    const context = { playerId: runtime.getPlayerId(), tick, conversation, pkg } as any;
    const transcript = conversation.join('\n');
    const composed = transcript ? `${transcript}\nPlayer: ${message}` : message;
    let res: any;
    try {
      history.push({ role: 'player', text: message });
      res = await executor.invoke({ input: composed, context } as any);
    } finally {
      spinner.stop();
    }
    const text = typeof res?.output === 'string' ? res.output : JSON.stringify(res);
    console.log();
    console.log(chalk.green('Agent:'), text);
    console.log();
    history.push({ role: 'agent', text });

    // Visual system activity panel (reactive summary of tools used this turn)
    const steps = Array.isArray(res?.intermediateSteps) ? res.intermediateSteps : [];
    if (steps.length) {
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.bold.cyan('System Activity'));
      for (const s of steps) {
        const tool = s?.action?.tool as string | undefined;
        const rawObs = s?.observation;
        let obs: any = undefined;
        if (typeof rawObs === 'string') {
          try { obs = JSON.parse(rawObs); } catch { /* ignore */ }
        } else if (rawObs && typeof rawObs === 'object') {
          obs = rawObs;
        }
        if (tool === 'calc_travel') {
          const meters = obs?.distanceMeters ?? obs?.distance ?? undefined;
          const eta = obs?.etaMinutes ?? undefined;
          console.log(' ', chalk.blue('calc_travel'), meters != null ? chalk.white(`${Math.round(meters)} m`) : '', eta != null ? chalk.gray(`(${eta} min)`) : '');
        } else if (tool === 'run_travel_system') {
          const eta = obs?.route?.etaMinutes;
          const to = obs?.route?.to;
          const newT = obs?.route?.newWorldTime;
          const spin = ora({ text: `Travel system → ${to || ''} ${eta != null ? `(${eta} min)` : ''}`, color: 'yellow' });
          spin.start();
          await new Promise(r => setTimeout(r, 150));
          spin.succeed(`Travel system complete → ${to || ''} ${eta != null ? `(${eta} min)` : ''}${newT ? chalk.gray(` @ ${formatIsoForDisplay(newT)}`) : ''}`);
        } else if (tool === 'advance_time') {
          const adv = obs?.timeAdvanced;
          const human = adv?.timeDescription || (adv?.minutes ? `${adv.minutes}m` : '');
          const crosses = adv?.boundaries;
          const crossed: string[] = [];
          if (crosses?.hour) crossed.push('hour');
          if (crosses?.day) crossed.push('day');
          if (crosses?.month) crossed.push('month');
          if (crosses?.year) crossed.push('year');
          const spin = ora({ text: `Advancing time ${human}${crossed.length ? ` [${crossed.join('/')}]` : ''}`, color: 'cyan' });
          spin.start();
          await new Promise(r => setTimeout(r, 120));
          spin.succeed(`Time advanced ${human}${crossed.length ? ` [${crossed.join('/')}]` : ''}`);
        } else if (tool === 'apply_patches') {
          const count = Array.isArray(s?.action?.toolInput?.patches) ? s.action.toolInput.patches.length : undefined;
          console.log(' ', chalk.magenta('apply_patches'), count != null ? chalk.white(`${count} patch(es)`) : '');
        } else if (tool === 'project_pkg') {
          console.log(' ', chalk.green('project_pkg'));
        } else if (tool === 'query_pkg' || tool === 'query_gtwg') {
          console.log(' ', chalk.gray(tool));
        } else if (typeof tool === 'string') {
          console.log(' ', tool);
        }
      }
      console.log(chalk.gray('─'.repeat(60)));
      console.log();
    }

    showTimeContext();
    whereAmI();
    console.log();
  }

  const defaultSavePath = path.resolve(process.cwd(), '.agent_state.json');
  async function handleSave(file?: string) {
    const p = file ? path.resolve(process.cwd(), file) : defaultSavePath;
    const state = { gtwg, ledger, pkg, tick };
    await fs.writeFile(p, JSON.stringify(state, null, 2), 'utf-8');
    console.log(chalk.green('Saved state to:'), chalk.white(p));
    console.log();
  }

  async function handleLoad(file?: string) {
    const p = file ? path.resolve(process.cwd(), file) : defaultSavePath;
    try {
      const raw = await fs.readFile(p, 'utf-8');
      const state = JSON.parse(raw);
      if (!state?.gtwg) throw new Error('Missing gtwg');
      gtwg = state.gtwg;
      ledger = state.ledger || ledger;
      pkg = state.pkg || pkg;
      tick = typeof state.tick === 'number' ? state.tick : tick;
      console.log(chalk.green('Loaded state from:'), chalk.white(p));
      showTimeContext();
      whereAmI();
      console.log();
    } catch (e: any) {
      console.log(chalk.red('Failed to load state:'), e?.message || String(e));
      console.log();
    }
  }

  while (true) {
    const line = (await rl.question(chalk.bold('> '))).trim();
    if (!line) continue;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');

    if (cmd === 'exit' || cmd === 'quit') break;
    if (cmd === 'help') { await help(); continue; }
    if (cmd === 'time') { showTimeContext(); console.log(); continue; }
    if (cmd === 'where') { whereAmI(); console.log(); continue; }
    if (cmd === 'pkg') {
      const names = (pkg.discoveredFacts || []).map((f: any) => (gtwg.entities as any[]).find(e => e.id === f.entityId)?.name || f.entityId);
      console.log(chalk.gray('PKG known:'), chalk.white(names.join(', ')) || chalk.white('(none)'));
      console.log();
      continue;
    }
    if (cmd === 'save') { await handleSave(arg || undefined); continue; }
    if (cmd === 'load') { await handleLoad(arg || undefined); continue; }
    if (cmd === 'clear') { history.length = 0; console.log(chalk.gray('Conversation cleared.')); console.log(); continue; }

    if (cmd === 'ask') {
      if (!arg) { console.log(chalk.red('Usage: ask <message>')); continue; }
      await handleAsk(arg);
      continue;
    }

    // Default: treat input as a natural-language turn to the agent
    await handleAsk(line);
  }

  console.log();
  console.log(chalk.green('Goodbye!'));
  process.exit(0);
}

main().catch((e) => {
  console.error(chalk.red('CLI crashed:'), e);
  process.exit(1);
});

