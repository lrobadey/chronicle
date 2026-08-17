#!/usr/bin/env tsx
// full-system-check.ts - Unified CLI to exercise Chronicle V2 subsystems
// =====================================================================

import 'dotenv/config';
import chalk from 'chalk';

import { createPagusClanisGTWG } from '../data/PagusClanis.js';
import { createEmptyCanonLedger } from '../data/CanonLedger.js';
import {
  createRunTravelSystemTool,
  createCalcTravelTool,
  createApplyPatchesTool,
  createAdvanceTimeTool,
  createProjectPKGTool,
  createDiscoverEntityTool,
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

function buildInitialState(): DemoState {
  const nowIso = new Date().toISOString();
  return {
    gtwg: createPagusClanisGTWG(),
    ledger: createEmptyCanonLedger(),
    tick: 0,
    pkg: {
      discoveredFacts: [
        { entityId: 'villa-aelia', discoveredAt: nowIso, source: 'demo-seed' },
        { entityId: 'mansio-vallis', discoveredAt: nowIso, source: 'demo-seed' },
        { entityId: 'gaius-aelius-secundus', discoveredAt: nowIso, source: 'demo-seed' },
      ],
      rumors: [],
      metadata: { version: '1.0.0', createdAt: nowIso, lastModified: nowIso, playerId: 'player-1' },
    },
    history: [
      { role: 'player', text: 'I review my surroundings at Villa Aelia.' },
      { role: 'agent', text: 'You stand amid the estate, the air scented with olive pressings.' },
    ],
  };
}

async function main() {
  console.clear();
  console.log(chalk.bold.cyan('Chronicle V2 — Full System Check'));
  console.log(chalk.gray('This CLI exercises core travel, time, PKG, discovery, conversation, and agent wiring.'));
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
    projectPKG: async ({ playerId }: { playerId: string }) => {
      state.pkg.metadata.playerId = playerId;
      state.pkg.metadata.lastModified = new Date().toISOString();
      return { pkg: state.pkg };
    },
    queryGTWG: async () => ({ entities: state.gtwg.entities }),
    queryPKG: async () => ({ entities: state.pkg.discoveredFacts }),
    getPKG: () => state.pkg,
    setPKG: (pkg: any) => {
      state.pkg = pkg;
    },
    getConversation: async (n: number) => state.history.slice(-n).map((m) => `${m.role === 'player' ? 'Player' : 'Agent'}: ${m.text}`),
    getPlayerId: () => 'player-1',
  };

  const calcTool = createCalcTravelTool(runtime as any);
  const travelTool = createRunTravelSystemTool(runtime as any);
  const applyTool = createApplyPatchesTool(runtime as any);
  const advanceTool = createAdvanceTimeTool(runtime as any);
  const projectTool = createProjectPKGTool(runtime as any);
  const discoverTool = createDiscoverEntityTool(runtime as any);
  const conversationTool = createConversationHistoryTool(runtime as any);

  console.log(chalk.bold('Step 1 — Travel preview'));
  const preview = await calcTool.call({ fromLocationId: 'villa-aelia', toLocationId: 'mansio-vallis' });
  if (preview.ok === false) {
    throw new Error(`calc_travel failed: ${preview.error}`);
  }
  console.log(chalk.green('✓'), `Distance ~${preview.distanceMeters?.toFixed(0)} m, ETA ~${preview.etaMinutes} min`);
  console.log();

  console.log(chalk.bold('Step 2 — Run travel system & apply patches'));
  const travelResult = await travelTool.call({ fromLocationId: 'villa-aelia', toLocationId: 'mansio-vallis' });
  if (!travelResult.success) {
    throw new Error(`run_travel_system failed: ${travelResult.error}`);
  }
  await applyTool.call({ patches: travelResult.patches as PatchLike[] });
  console.log(chalk.green('✓'), `Player moved to ${travelResult.route?.to}, new world time ${travelResult.route?.newWorldTime}`);
  console.log();

  console.log(chalk.bold('Step 3 — Advance time for scouting'));
  const advanceResult = await advanceTool.call({ minutes: 30, reason: 'post-travel scouting' });
  if (!advanceResult.success) {
    throw new Error(`advance_time failed: ${advanceResult.error}`);
  }
  await applyTool.call({ patches: advanceResult.patches as PatchLike[] });
  console.log(chalk.green('✓'), `Time advanced by ${advanceResult.timeAdvanced.timeDescription}`);
  console.log();

  console.log(chalk.bold('Step 4 — Project PKG'));
  const projection = await projectTool.call({ playerId: runtime.getPlayerId(), gtwg: state.gtwg });
  console.log(chalk.green('✓'), `PKG fact count: ${projection.pkg.discoveredFacts.length}`);
  console.log();

  console.log(chalk.bold('Step 5 — Discover nearby entity'));
  const discover = await discoverTool.call({ entityId: 'figlinae-clanis' });
  console.log(chalk.green('✓'), discover.persisted ? 'Discovery persisted to PKG' : 'Discovery available but not persisted');
  console.log();

  console.log(chalk.bold('Step 6 — Conversation history sample'));
  state.history.push({ role: 'player', text: 'Where should I head next?' });
  state.history.push({ role: 'agent', text: 'Consider the clay pits at Figlinae Clanis.' });
  const conversation = await conversationTool.call({ n: 4 });
  console.log(chalk.green('✓'), 'Recent messages:');
  conversation.messages.forEach((line) => console.log('  ', line));
  console.log();

  const shouldRunAgent = Boolean(process.env.OPENAI_API_KEY);
  if (shouldRunAgent) {
    console.log(chalk.bold('Step 7 — Live agent turn (OPENAI_API_KEY detected)'));
    const executor = await createAgentExecutor(runtime as any, { maxIterations: 8 });
    const agentInputs = {
      playerInput: 'Give me a next action from my current position.',
      context: {
        playerId: runtime.getPlayerId(),
        tick: state.tick,
        conversation: await runtime.getConversation(10),
        pkg: state.pkg,
        gtwg: state.gtwg,
      },
    };
    const agentOutput = await runAgentTurn(executor, agentInputs);
    console.log(chalk.green('✓'), 'Agent narrative:');
    console.log(agentOutput.narrative);
    if (agentOutput.intermediateSteps) {
      console.log(chalk.gray('Intermediate steps available in output.raw.intermediateSteps.'));
    }
    state.history.push({ role: 'player', text: agentInputs.playerInput });
    state.history.push({ role: 'agent', text: agentOutput.narrative });
  } else {
    console.log(chalk.yellow('Skipping live agent turn — set OPENAI_API_KEY to enable LLM interaction.'));
  }
  console.log();

  console.log(chalk.bold('Final snapshot'));
  const player = state.gtwg.entities.find((e: any) => e.id === 'player-1');
  console.log(' • Current location:', player?.properties?.current_location);
  console.log(' • World time:', state.gtwg.metadata?.worldTime);
  console.log(' • Ledger entries:', state.ledger.entries.length);
  console.log(' • Known entities:', state.pkg.discoveredFacts.length);
  console.log();
  console.log(chalk.bold.green('Full system check complete.'));
}

main().catch((error) => {
  console.error(chalk.red('Full system check failed:'), error);
  process.exit(1);
});

