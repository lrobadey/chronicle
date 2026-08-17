#!/usr/bin/env tsx
// full-system-interactive.ts - Interactive Chronicle V2 systems sandbox
// ====================================================================

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';

import { createPagusClanisGTWG, createPagusClanisQueryAdapter } from '../data/PagusClanis.js';
import { createEmptyCanonLedger } from '../data/CanonLedger.js';
import {
  createRunTravelSystemTool,
  createApplyPatchesTool,
  createCalcTravelTool,
  createAdvanceTimeTool,
  createDiscoverEntityTool,
  createProjectPKGTool,
  createConversationHistoryTool,
} from '../agent/tools.js';
import { createAgentExecutor, runAgentTurn } from '../agent/AgentOrchestrator.js';
import type { PatchLike } from '../agent/types.js';

type HistoryEntry = { role: 'player' | 'agent'; text: string };

interface DemoState {
  gtwg: any;
  ledger: any;
  tick: number;
  pkg: any;
  history: HistoryEntry[];
}

const PLAYER_ID = 'player-1';

function buildInitialState(): DemoState {
  const iso = new Date().toISOString();
  return {
    gtwg: createPagusClanisGTWG(),
    ledger: createEmptyCanonLedger(),
    tick: 0,
    pkg: {
      discoveredFacts: [
        { entityId: 'villa-aelia', discoveredAt: iso, source: 'demo-seed' },
        { entityId: 'mansio-vallis', discoveredAt: iso, source: 'demo-seed' },
        { entityId: 'gaius-aelius-secundus', discoveredAt: iso, source: 'demo-seed' },
      ],
      rumors: [],
      metadata: { version: '1.0.0', createdAt: iso, lastModified: iso, playerId: PLAYER_ID },
    },
    history: [],
  };
}

function resolveEntityId(state: DemoState, query: string): { id: string; name: string } | null {
  const q = query.trim().toLowerCase();
  const byId = state.gtwg.entities.find((e: any) => e.id.toLowerCase() === q);
  if (byId) return { id: byId.id, name: byId.name || byId.id };
  const byName = state.gtwg.entities
    .map((e: any) => ({ entity: e, score: e.name ? similarityScore(e.name.toLowerCase(), q) : 0 }))
    .filter((r: any) => r.score > 0)
    .sort((a: any, b: any) => b.score - a.score);
  if (byName.length > 0) {
    const entity = byName[0].entity;
    return { id: entity.id, name: entity.name || entity.id };
  }
  return null;
}

function similarityScore(text: string, query: string): number {
  if (text === query) return 100;
  if (text.includes(query)) return query.length * 2;
  const tokens = query.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const t of tokens) {
    if (text.includes(t)) score += t.length;
  }
  return score;
}

function currentLocation(state: DemoState): { id: string | null; name: string } {
  const player = state.gtwg.entities.find((e: any) => e.id === PLAYER_ID);
  const locId = player?.properties?.current_location ?? null;
  if (!locId) return { id: null, name: 'unknown' };
  const entity = state.gtwg.entities.find((e: any) => e.id === locId);
  return { id: locId, name: entity?.name || locId };
}

async function main() {
  console.clear();
  console.log(chalk.bold.cyan('Chronicle V2 — Interactive Systems CLI'));
  console.log(chalk.gray('Commands: help, status, calc <dest>, travel <dest>, wait <minutes>, discover <entity>,'),
              chalk.gray('agent <message>, conversation, ledger, pkg, quit'));
  console.log();

  const state = buildInitialState();

  const runtime = {
    getGTWG: () => state.gtwg,
    setGTWG: (g: any) => {
      state.gtwg = g;
    },
    getLedger: () => state.ledger,
    setLedger: (l: any) => {
      state.ledger = l;
    },
    getTick: () => state.tick,
    getPKG: () => state.pkg,
    setPKG: (pkg: any) => {
      state.pkg = pkg;
    },
    getConversation: async (n: number) => state.history.slice(-n).map((m) => `${m.role === 'player' ? 'Player' : 'Agent'}: ${m.text}`),
    getPlayerId: () => PLAYER_ID,
    projectPKG: async ({ playerId, gtwg: _ }: { playerId: string; gtwg: any }) => {
      state.pkg.metadata.playerId = playerId;
      state.pkg.metadata.lastModified = new Date().toISOString();
      return { pkg: state.pkg };
    },
    queryGTWG: async (query: Record<string, any>) => {
      const adapter = createPagusClanisQueryAdapter(state.gtwg);
      return adapter(query);
    },
    queryPKG: async () => ({ entities: state.pkg.discoveredFacts }),
  };

  const calcTool = createCalcTravelTool(runtime as any);
  const travelTool = createRunTravelSystemTool(runtime as any);
  const applyTool = createApplyPatchesTool(runtime as any);
  const advanceTool = createAdvanceTimeTool(runtime as any);
  const discoverTool = createDiscoverEntityTool(runtime as any);
  const projectTool = createProjectPKGTool(runtime as any);
  const conversationTool = createConversationHistoryTool(runtime as any);

  let executor: Awaited<ReturnType<typeof createAgentExecutor>> | null = null;
  if (process.env.OPENAI_API_KEY) {
    try {
      executor = await createAgentExecutor(runtime as any, { maxIterations: 10 });
      console.log(chalk.green('Agent ready (OPENAI_API_KEY detected). Type'), chalk.white('agent <message>'), chalk.green('to talk.'));
    } catch (err) {
      console.log(chalk.red('Failed to initialize agent executor:'), err);
      executor = null;
    }
  } else {
    console.log(chalk.yellow('Agent disabled — set OPENAI_API_KEY to enable live interaction.'));
  }
  console.log();

  const rl = readline.createInterface({ input, output });

  async function showStatus() {
    const loc = currentLocation(state);
    console.log(chalk.bold('Status:'));
    console.log('  Location:', chalk.white(loc.name));
    console.log('  World time:', chalk.white(state.gtwg.metadata?.worldTime || 'unknown'));
    console.log('  Ledger entries:', chalk.white(state.ledger.entries.length));
    console.log('  Known entities:', chalk.white(state.pkg.discoveredFacts.length));
    console.log();
  }

  function listHelp() {
    console.log(chalk.bold('Commands'));
    console.log('  help                 Show this help');
    console.log('  status               Show current location, time, ledger info');
    console.log('  calc <dest>          Preview distance/ETA from current location');
    console.log('  travel <dest>        Execute travel system and apply patches');
    console.log('  wait <minutes>       Advance time by minutes (positive integer) or short form (e.g., 1h30m)');
    console.log('  discover <entity>    Add entity to PKG via discover tool');
    console.log('  agent <message>      Talk to the agent (requires OPENAI_API_KEY)');
    console.log('  conversation         Show last 10 conversation lines');
    console.log('  ledger               Show ledger entry count and newest entry');
    console.log('  pkg                  List known entities in PKG');
    console.log('  quit / exit          Leave the CLI');
    console.log();
  }

  async function handleCalc(args: string[]) {
    if (args.length === 0) {
      console.log(chalk.red('Usage: calc <destination>'));
      return;
    }
    const destQuery = args.join(' ');
    const dest = resolveEntityId(state, destQuery);
    if (!dest) {
      console.log(chalk.red('Could not resolve destination:'), destQuery);
      return;
    }
    const loc = currentLocation(state);
    if (!loc.id) {
      console.log(chalk.red('Player location unknown — cannot calculate route.'));
      return;
    }
    const res = await calcTool.call({ fromLocationId: loc.id, toLocationId: dest.id });
    if (res.ok === false) {
      console.log(chalk.red('calc_travel failed:'), res.error);
      return;
    }
    console.log(chalk.green('Distance:'), `${Math.round(res.distanceMeters ?? 0)} m`);
    console.log(chalk.green('ETA:'), `${res.etaMinutes ?? 0} minutes`);
    console.log();
  }

  async function handleTravel(args: string[]) {
    if (args.length === 0) {
      console.log(chalk.red('Usage: travel <destination>'));
      return;
    }
    const destQuery = args.join(' ');
    const dest = resolveEntityId(state, destQuery);
    if (!dest) {
      console.log(chalk.red('Could not resolve destination:'), destQuery);
      return;
    }
    const loc = currentLocation(state);
    if (!loc.id) {
      console.log(chalk.red('Player location unknown — cannot travel.'));
      return;
    }
    const spinner = ora({ text: `Traveling to ${dest.name}...`, color: 'cyan' }).start();
    try {
      const result = await travelTool.call({ fromLocationId: loc.id, toLocationId: dest.id });
      if (!result.success) {
        spinner.fail(`Travel failed: ${result.error}`);
        return;
      }
      await applyTool.call({ patches: result.patches as PatchLike[] });
      state.tick += 1;
      spinner.succeed(`Arrived at ${dest.name} — ETA ${result.route?.etaMinutes} minutes.`);
      console.log(chalk.gray('New world time:'), result.route?.newWorldTime || 'unknown');
      console.log();
    } catch (err) {
      spinner.fail(`Travel error: ${err}`);
    }
  }

  function parseDuration(input: string): number | null {
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    const regex = /(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?/i;
    const m = trimmed.match(regex);
    if (!m) return null;
    const days = m[1] ? parseInt(m[1], 10) : 0;
    const hours = m[2] ? parseInt(m[2], 10) : 0;
    const mins = m[3] ? parseInt(m[3], 10) : 0;
    const total = days * 24 * 60 + hours * 60 + mins;
    return total > 0 ? total : null;
  }

  async function handleWait(args: string[]) {
    if (args.length === 0) {
      console.log(chalk.red('Usage: wait <minutes or duration string, e.g., 45 or 1h30m>'));
      return;
    }
    const minutes = parseDuration(args.join(' '));
    if (!minutes) {
      console.log(chalk.red('Unable to parse duration.'));
      return;
    }
    const spinner = ora({ text: `Advancing time by ${minutes} minutes...`, color: 'cyan' }).start();
    try {
      const res = await advanceTool.call({ minutes, reason: 'interactive wait' });
      if (!res.success) {
        spinner.fail(`advance_time failed: ${res.error}`);
        return;
      }
      await applyTool.call({ patches: res.patches as PatchLike[] });
      state.tick += 1;
      spinner.succeed(`Time advanced to ${res.timeAdvanced.newTime}`);
      console.log(chalk.gray(res.narrative));
      console.log();
    } catch (err) {
      spinner.fail(`advance_time error: ${err}`);
    }
  }

  async function handleDiscover(args: string[]) {
    if (args.length === 0) {
      console.log(chalk.red('Usage: discover <entity>'));
      return;
    }
    const query = args.join(' ');
    const entity = resolveEntityId(state, query);
    if (!entity) {
      console.log(chalk.red('Could not resolve entity:'), query);
      return;
    }
    const res = await discoverTool.call({ entityId: entity.id });
    if (res.ok) {
      console.log(chalk.green(`Discovery recorded for ${entity.name}`));
    } else {
      console.log(chalk.red('Discovery failed:'), res.error || 'unknown');
    }
    console.log();
  }

  async function handleAgent(args: string[]) {
    if (!executor) {
      console.log(chalk.yellow('Agent unavailable — set OPENAI_API_KEY and restart.'));
      return;
    }
    if (args.length === 0) {
      console.log(chalk.red('Usage: agent <message>'));
      return;
    }
    const message = args.join(' ');
    const spinner = ora({ text: 'Agent thinking...', color: 'cyan' }).start();
    try {
      const conversation = await runtime.getConversation(10);
      const context = {
        playerId: PLAYER_ID,
        tick: state.tick,
        conversation,
        pkg: state.pkg,
        gtwg: state.gtwg,
      };
      state.history.push({ role: 'player', text: message });
      const exec = executor;
      if (!exec) throw new Error('Agent executor missing.');
      const result = await runAgentTurn(exec, { playerInput: message, context });
      state.tick += 1;
      const narrative = result.narrative;
      state.history.push({ role: 'agent', text: narrative });
      spinner.stop();
      console.log();
      console.log(chalk.green('Agent:'), narrative);
      console.log();
      if (result.intermediateSteps) {
        console.log(chalk.gray('Intermediate steps available in result.raw.intermediateSteps.'));
      }
      await projectTool.call({ playerId: PLAYER_ID, gtwg: state.gtwg });
    } catch (err) {
      spinner.fail(`Agent error: ${err}`);
    }
  }

  async function handleConversation() {
    const convo = await conversationTool.call({ n: 10 });
    if (!convo.messages.length) {
      console.log(chalk.gray('No conversation yet.'));
    } else {
      convo.messages.forEach((line) => console.log(' ', line));
    }
    console.log();
  }

  function handleLedger() {
    console.log(chalk.bold('Ledger entries:'), state.ledger.entries.length);
    const latest = state.ledger.entries[state.ledger.entries.length - 1];
    if (latest) {
      console.log('  Latest tick:', latest.tick);
      console.log('  Proposer:', latest.proposer);
      console.log('  Patch count:', latest.patches.length);
    }
    console.log();
  }

  function handlePkg() {
    console.log(chalk.bold('Known entities:'));
    state.pkg.discoveredFacts.forEach((f: any) => {
      const entity = state.gtwg.entities.find((e: any) => e.id === f.entityId);
      console.log(' ', entity?.name || f.entityId);
    });
    console.log();
  }

  await showStatus();

  for await (const line of rl) {
    const inputLine = line.trim();
    if (!inputLine) continue;
    const [command, ...args] = inputLine.split(/\s+/);
    const normalized = command.toLowerCase();

    try {
      if (normalized === 'help' || normalized === '?') {
        listHelp();
      } else if (normalized === 'status') {
        await showStatus();
      } else if (normalized === 'calc') {
        await handleCalc(args);
      } else if (normalized === 'travel') {
        await handleTravel(args);
      } else if (normalized === 'wait') {
        await handleWait(args);
      } else if (normalized === 'discover') {
        await handleDiscover(args);
      } else if (normalized === 'agent') {
        await handleAgent(args);
      } else if (normalized === 'conversation' || normalized === 'history') {
        await handleConversation();
      } else if (normalized === 'ledger') {
        handleLedger();
      } else if (normalized === 'pkg') {
        handlePkg();
      } else if (normalized === 'quit' || normalized === 'exit') {
        console.log(chalk.gray('Exiting Chronicle CLI. Vale!'));
        break;
      } else {
        console.log(chalk.red('Unknown command. Type "help" for options.'));
      }
    } catch (err) {
      console.log(chalk.red('Command error:'), err);
    }
  }

  await rl.close();
}

main().catch((error) => {
  console.error(chalk.red('Interactive CLI failed:'), error);
  process.exit(1);
});
