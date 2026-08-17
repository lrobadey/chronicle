// pagus-demo.ts - Interactive CLI for Pagus Clanis using full agent toolset
// ========================================================================

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as fsSync from 'node:fs';

import { createAgentExecutor } from '../agent/AgentOrchestrator.js';
import { createEmptyCanonLedger } from '../data/CanonLedger.js';
import { createPagusClanisGTWG, createPagusClanisQueryAdapter } from '../data/PagusClanis.js';
import { formatIsoForDisplay, getSeason, getTimeOfDay } from '../engine/WorldTime.js';

async function main() {
  console.clear();
  console.log(chalk.bold.cyan('Pagus Clanis — Interactive Demo'));
  console.log(chalk.gray('Type'), chalk.white('help'), chalk.gray('for commands.'));
  console.log();

  // In-memory world state
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

  // Runtime deps
  const runtime = {
    getGTWG: () => gtwg,
    setGTWG: (g: any) => { gtwg = g; },
    getLedger: () => ledger,
    setLedger: (l: any) => { ledger = l; },
    getTick: () => tick,
    getPKG: () => pkg,
    setPKG: (p: any) => { pkg = p; },
    projectPKG: async ({ playerId, gtwg: _ }: { playerId: string; gtwg: any }) => {
      if (pkg?.metadata) {
        pkg.metadata.playerId = playerId;
        pkg.metadata.lastModified = new Date().toISOString();
      }
      return { pkg };
    },
    queryGTWG: createPagusClanisQueryAdapter(gtwg),
    queryPKG: async (query: Record<string, any>): Promise<any> => {
      const requestedType = typeof query === 'object' && (query as any)?.type ? (query as any).type : 'any';
      const discoveredEntities = (pkg.discoveredFacts || [])
        .map((f: any) => (gtwg.entities as any[]).find(e => e.id === f.entityId))
        .filter(Boolean);
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
    console.log('  ', chalk.white('explore'), chalk.gray('— ask agent to explore and update knowledge'));
    console.log('  ', chalk.white('routes <to> | routes <from> <to>'), chalk.gray('— ask agent to preview distance/ETA'));
    console.log('  ', chalk.white('go <to> | go <from> <to>'), chalk.gray('— ask agent to travel and apply patches'));
    console.log('  ', chalk.white('sanity'), chalk.gray('— run adapter sanity checks'));
    console.log('  ', chalk.white('save [file]'), chalk.gray('— save world to file (default .agent_state.json)'));
    console.log('  ', chalk.white('load [file]'), chalk.gray('— load world from file'));
    console.log('  ', chalk.white('clear'), chalk.gray('— clear conversation history'));
    console.log('  ', chalk.white('help'), chalk.gray('— show this help'));
    console.log('  ', chalk.white('exit'), chalk.gray('— quit'));
    console.log();
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
        const tool = (s as any)?.action?.tool as string | undefined;
        const rawObs = (s as any)?.observation;
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
          const count = Array.isArray((s as any)?.action?.toolInput?.patches) ? (s as any).action.toolInput.patches.length : undefined;
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

  async function handleSanity() {
    const adapter = createPagusClanisQueryAdapter(gtwg);
    console.log();
    console.log(chalk.bold.cyan('Adapter Sanity Checks'));
    console.log('All regions:', (await adapter({ type: 'entities_by_type', entityType: 'region' })).map((e: any) => e.name));
    console.log('All characters:', (await adapter({ type: 'entities_by_type', entityType: 'character' })).map((e: any) => e.name));
    console.log('Villa relations out (trades_with):', await adapter({ type: 'connected', id: 'villa-aelia', relationType: 'trades_with', direction: 'out' }));
    console.log();
  }

  function getCurrentLocationId(): string | null {
    const player = (gtwg.entities as any[]).find(e => e.id === 'player-1');
    return player?.properties?.current_location || null;
  }

  async function resolveLocationId(input: string | undefined): Promise<string | null> {
    if (!input || input.trim().length === 0 || input.trim().toLowerCase() === 'here') {
      return getCurrentLocationId();
    }
    const text = input.trim();
    const byId = (gtwg.entities as any[]).find(e => e.id === text);
    if (byId && byId.type === 'region') return byId.id;
    const byName = (gtwg.entities as any[]).find(e => String(e.name).toLowerCase() === text.toLowerCase());
    if (byName && byName.type === 'region') return byName.id;
    // Defer fuzzy resolution to agent; return raw text when not resolved.
    return text;
  }

  async function handleRoutes(args: string[]) {
    if (!executor) {
      console.log(chalk.red('Agent unavailable: set OPENAI_API_KEY to use this command.'));
      console.log();
      return;
    }
    let fromArg: string | undefined;
    let toArg: string | undefined;
    if (args.length >= 2) {
      fromArg = args[0];
      toArg = args.slice(1).join(' ');
    } else if (args.length === 1) {
      fromArg = 'here';
      toArg = args[0];
    } else {
      console.log(chalk.red('Usage: routes <to> OR routes <from> <to>'));
      console.log();
      return;
    }
    const fromResolved = await resolveLocationId(fromArg);
    const toResolved = await resolveLocationId(toArg);
    const fromText = fromResolved || String(fromArg);
    const toText = toResolved || String(toArg);
    const spinner = ora({ text: 'Agent calculating route preview...', color: 'cyan' }).start();
    try {
      history.push({ role: 'player', text: `routes ${fromText} ${toText}` });
      const ctx = { playerId: 'player-1', tick, conversation: [], pkg } as any;
      const prompt = `Preview travel from "${fromText}" to "${toText}". Do not change world state. Return estimated walking distance in meters and ETA in minutes.`;
      const res = await executor.invoke({ input: prompt, context: ctx } as any);
      spinner.stop();
      const text = typeof (res as any)?.output === 'string' ? (res as any).output : JSON.stringify(res);
      console.log(chalk.green('Agent:'), text);
      console.log();
      history.push({ role: 'agent', text });
    } catch (e: any) {
      spinner.stop();
      console.log(chalk.red('Route preview failed:'), e?.message || String(e));
      console.log();
    }
  }

  async function handleGo(args: string[]) {
    if (!executor) {
      console.log(chalk.red('Agent unavailable: set OPENAI_API_KEY to use this command.'));
      console.log();
      return;
    }
    let fromArg: string | undefined;
    let toArg: string | undefined;
    if (args.length >= 2) {
      fromArg = args[0];
      toArg = args.slice(1).join(' ');
    } else if (args.length === 1) {
      fromArg = 'here';
      toArg = args[0];
    } else {
      console.log(chalk.red('Usage: go <to> OR go <from> <to>'));
      console.log();
      return;
    }

    const fromResolved = await resolveLocationId(fromArg);
    const toResolved = await resolveLocationId(toArg);
    const fromText = fromResolved || String(fromArg);
    const toText = toResolved || String(toArg);

    const spinner = ora({ text: `Agent executing travel to ${toText}...`, color: 'yellow' });
    spinner.start();
    try {
      history.push({ role: 'player', text: `go ${fromText} ${toText}` });
      const ctx = { playerId: 'player-1', tick, conversation: [], pkg } as any;
      const prompt = `Travel from "${fromText}" to "${toText}" now. Use the travel system and apply patches as needed. Then report arrival and new world time.`;
      const res = await executor.invoke({ input: prompt, context: ctx } as any);
      spinner.stop();
      const text = typeof (res as any)?.output === 'string' ? (res as any).output : JSON.stringify(res);
      console.log(chalk.green('Agent:'), text);
      console.log();
      history.push({ role: 'agent', text });
      showTimeContext();
      whereAmI();
      console.log();
    } catch (e: any) {
      spinner.stop();
      console.log(chalk.red('Travel failed:'), e?.message || String(e));
      console.log();
    }
  }

  async function handleExplore() {
    if (!executor) {
      console.log(chalk.red('Agent unavailable: set OPENAI_API_KEY to use this command.'));
      console.log();
      return;
    }
    const spinner = ora({ text: 'Agent exploring the surroundings...', color: 'cyan' });
    spinner.start();
    try {
      const ctx = { playerId: 'player-1', tick, conversation: [], pkg } as any;
      const prompt = 'Explore the surroundings from my current location. Use advance_time (15–60 minutes), query_gtwg locally, and discover_entity for 2–4 salient entities I plausibly learn about (skip duplicates). Summarize new knowledge.';
      const res = await executor.invoke({ input: prompt, context: ctx } as any);
      spinner.stop();
      const text = typeof (res as any)?.output === 'string' ? (res as any).output : JSON.stringify(res);
      console.log(chalk.green('Agent:'), text);
      console.log();
      showTimeContext();
      whereAmI();
      console.log();
    } catch (e: any) {
      spinner.stop();
      console.log(chalk.red('Explore failed:'), e?.message || String(e));
      console.log();
    }
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
    if (cmd === 'sanity') { await handleSanity(); continue; }
    if (cmd === 'explore') { await handleExplore(); continue; }
    if (cmd === 'routes') { await handleRoutes(rest); continue; }
    if (cmd === 'go') { await handleGo(rest); continue; }

    if (cmd === 'ask') {
      if (!arg) { console.log(chalk.red('Usage: ask <message>')); continue; }
      await handleAsk(arg);
      continue;
    }

    // Default: treat input as a natural-language turn to the agent
    await handleAsk(line);
    tick += 1;
  }

  console.log();
  console.log(chalk.green('Goodbye!'));
  process.exit(0);
}

main().catch((e) => {
  console.error(chalk.red('CLI crashed:'), e);
  process.exit(1);
});

