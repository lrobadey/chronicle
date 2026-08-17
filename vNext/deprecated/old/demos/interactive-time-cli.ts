#!/usr/bin/env tsx
// interactive-time-cli.ts - Immersive terminal demo for time advancement
// ======================================================================

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createApplyPatchesTool, createAdvanceTimeTool } from '../agent/tools.js';
import { createPagusClanisGTWG } from '../data/PagusClanis.js';
import { createEmptyCanonLedger } from '../data/CanonLedger.js';
import { getSeason, getTimeOfDay, formatIsoForDisplay, addMinutesToIso } from '../engine/WorldTime.js';

async function main() {
  console.clear();
  const title = chalk.bold.cyan('Chronicle V2 — Time Advancement Interactive Demo');
  console.log(title);
  console.log(chalk.gray('Use commands like:'), chalk.white('time,'), chalk.white('wait 15m,'), chalk.white('forward 1d2h30m,'), chalk.white('back 2h,'), chalk.white('set 2024-04-01T12:00:00Z'));
  console.log(chalk.gray('Type'), chalk.white('help'), chalk.gray('or'), chalk.white('exit'), chalk.gray('at any time.'));
  console.log();

  // World bootstrap
  let gtwg = createPagusClanisGTWG();
  let ledger = createEmptyCanonLedger();
  let tick = 0;

  // Set deterministic initial world time for demo
  gtwg = { ...gtwg, metadata: { ...gtwg.metadata, worldTime: '2024-03-15T08:00:00.000Z' } };

  // Minimal runtime api for tools
  const runtime = {
    getGTWG: () => gtwg,
    setGTWG: (g: any) => { gtwg = g; },
    getLedger: () => ledger,
    setLedger: (l: any) => { ledger = l; },
    getTick: () => tick,
  } as any;

  // Tools
  const advanceTime = createAdvanceTimeTool(runtime);
  const applyPatches = createApplyPatchesTool(runtime);

  const rl = readline.createInterface({ input, output });

  function fmt(iso: string) {
    return formatIsoForDisplay(iso);
  }

  function now(): string {
    return (gtwg as any)?.metadata?.worldTime || new Date().toISOString();
  }

  function banner(text: string) {
    console.log(chalk.gray('─'.repeat(60)));
    console.log(text);
    console.log(chalk.gray('─'.repeat(60)));
  }

  function showContext(beforeIso: string, afterIso?: string, boundaries?: any) {
    const seasonBefore = getSeason(beforeIso);
    const todBefore = getTimeOfDay(beforeIso);
    console.log(chalk.gray('Context:'), chalk.white(`${seasonBefore}, ${todBefore}`), chalk.gray('at'), chalk.white(fmt(beforeIso)));
    if (afterIso) {
      const seasonAfter = getSeason(afterIso);
      const todAfter = getTimeOfDay(afterIso);
      let boundaryStr = '';
      if (boundaries) {
        const parts: string[] = [];
        if (boundaries.hour) parts.push('hour');
        if (boundaries.day) parts.push('day');
        if (boundaries.month) parts.push('month');
        if (boundaries.year) parts.push('year');
        if (parts.length) boundaryStr = chalk.yellow(` [crossed ${parts.join('/')}]`);
      }
      console.log(chalk.gray('→'), chalk.white(`${seasonAfter}, ${todAfter}`), chalk.gray('at'), chalk.white(fmt(afterIso)), boundaryStr);
    }
  }

  async function animatePatches(patches: any[]) {
    const spinner = ora({ text: 'Applying patches', color: 'yellow' }).start();
    await delay(250);
    spinner.text = 'Validating patches';
    await delay(250);
    spinner.text = 'Committing to ledger';
    await delay(250);
    spinner.succeed('World updated');

    for (const p of patches) {
      const op = chalk.magenta(p.op.toUpperCase());
      const ent = chalk.white(p.entity);
      const fld = chalk.gray(p.field);
      if (p.op === 'set') {
        console.log('  ', op, ent, '→', fld, chalk.green(p.value));
      } else {
        console.log('  ', op, ent, '→', fld);
      }
    }
  }

  function parseDuration(arg: string): string | null {
    // Validate strings like 15m, 2h, 1d2h30m
    const ok = /^(\d+d)?(\d+h)?(\d+m)?$/i.test(arg.trim());
    return ok ? arg.trim() : null;
  }

  function minutesFromDuration(dur: string): number {
    const m = dur.match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/i);
    if (!m) return 0;
    const days = m[1] ? parseInt(m[1], 10) : 0;
    const hours = m[2] ? parseInt(m[2], 10) : 0;
    const mins = m[3] ? parseInt(m[3], 10) : 0;
    return days * 24 * 60 + hours * 60 + mins;
  }

  async function handleAdvance(durationStr: string, reason: string) {
    const start = now();
    banner(chalk.bold(`Advancing ${durationStr} — ${reason}`));
    showContext(start);

    const spinner = ora({ text: `Advancing time by ${durationStr}`, color: 'cyan' }).start();
    const result = await advanceTime.call({ duration: durationStr, reason });
    await delay(300);
    spinner.stop();

    if (!result.success) {
      console.log(chalk.red('Failed to advance time:'), result.error);
      console.log();
      return;
    }

    console.log(chalk.cyan('→'), result.narrative);
    showContext(result.timeAdvanced.previousTime, result.timeAdvanced.newTime, result.timeAdvanced.boundaries);
    await animatePatches(result.patches);

    const applySpinner = ora({ text: 'Syncing world state', color: 'green' }).start();
    await applyPatches.call({ patches: result.patches });
    await delay(250);
    applySpinner.succeed('Time advanced');

    console.log(chalk.gray('New time:'), chalk.white(fmt(now())));
    console.log();
  }

  async function handleSet(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      console.log(chalk.red('Invalid ISO datetime. Example: 2024-04-01T12:00:00Z'));
      return;
    }
    const prev = now();
    banner(chalk.bold(`Setting time → ${iso}`));
    showContext(prev);
    const patches = [{
      op: 'set', entity: '__meta__', field: 'worldTime', value: d.toISOString(), proposer: 'time_cli',
      metadata: { reason: 'manual_set', previousTime: prev }
    }];
    await animatePatches(patches);
    const applySpinner = ora({ text: 'Syncing world state', color: 'green' }).start();
    await applyPatches.call({ patches });
    await delay(200);
    applySpinner.succeed('Time set');
    showContext(prev, now(), { hour: true, day: prev.split('T')[0] !== now().split('T')[0] });
    console.log();
  }

  async function handleBack(durationStr: string) {
    const mins = minutesFromDuration(durationStr);
    if (mins <= 0) {
      console.log(chalk.red('Provide a positive duration for back, e.g., back 2h or back 1d2h')); return;
    }
    const start = now();
    banner(chalk.bold(`Rewinding ${durationStr}`));
    showContext(start);
    const newIso = addMinutesToIso(start, -mins);
    const patches = [{ op: 'set', entity: '__meta__', field: 'worldTime', value: newIso, proposer: 'time_cli', metadata: { reason: 'rewind', minutes: -mins, previousTime: start } }];
    await animatePatches(patches);
    const applySpinner = ora({ text: 'Syncing world state', color: 'green' }).start();
    await applyPatches.call({ patches });
    await delay(200);
    applySpinner.succeed('Time rewound');
    showContext(start, now());
    console.log();
  }

  const defaultSavePath = path.resolve(process.cwd(), '.time_state.json');

  async function handleSave(file?: string) {
    const p = file ? path.resolve(process.cwd(), file) : defaultSavePath;
    const state = { worldTime: now(), savedAt: new Date().toISOString() };
    await fs.writeFile(p, JSON.stringify(state, null, 2), 'utf-8');
    console.log(chalk.green('Saved time to:'), chalk.white(p));
    console.log();
  }

  async function handleLoad(file?: string) {
    const p = file ? path.resolve(process.cwd(), file) : defaultSavePath;
    try {
      const raw = await fs.readFile(p, 'utf-8');
      const state = JSON.parse(raw);
      if (!state.worldTime) throw new Error('Missing worldTime in file');
      await handleSet(state.worldTime);
    } catch (e: any) {
      console.log(chalk.red('Failed to load time:'), e?.message || String(e));
      console.log();
    }
  }

  async function help() {
    console.log(chalk.bold('Commands:'));
    console.log('  ', chalk.white('time'), chalk.gray('— show current world time and context'));
    console.log('  ', chalk.white('wait <duration>'), chalk.gray('— advance by duration, e.g., 15m, 4h, 1d2h30m'));
    console.log('  ', chalk.white('forward <duration>'), chalk.gray('— alias of wait'));
    console.log('  ', chalk.white('back <duration>'), chalk.gray('— rewind time by duration (test rollbacks)'));
    console.log('  ', chalk.white('set <ISO>'), chalk.gray('— set world time to a specific ISO datetime'));
    console.log('  ', chalk.white('save [file]'), chalk.gray('— save current time to a file (default .time_state.json)'));
    console.log('  ', chalk.white('load [file]'), chalk.gray('— load time from a file and set it'));
    console.log('  ', chalk.white('help'), chalk.gray('— show this help'));
    console.log('  ', chalk.white('exit'), chalk.gray('— quit demo'));
    console.log();
  }

  console.log(chalk.gray('Starting world time:'), chalk.white(fmt(now())));
  console.log();
  await help();

  while (true) {
    const line = (await rl.question(chalk.bold('> '))).trim();
    if (!line) continue;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');

    if (cmd.toLowerCase() === 'exit' || cmd.toLowerCase() === 'quit') break;
    if (cmd.toLowerCase() === 'help') { await help(); continue; }
    if (cmd.toLowerCase() === 'time') { showContext(now()); console.log(); continue; }

    if (cmd === 'wait' || cmd === 'forward') {
      const dur = parseDuration(arg || '');
      if (!dur) { console.log(chalk.red('Provide a duration, e.g., 15m or 2h or 1d2h30m')); continue; }
      await handleAdvance(dur, cmd === 'wait' ? 'Player wait' : 'Forward');
      continue;
    }

    if (cmd === 'back') {
      const dur = parseDuration(arg || '');
      if (!dur) { console.log(chalk.red('Provide a duration, e.g., back 2h or back 1d2h')); continue; }
      await handleBack(dur);
      continue;
    }

    if (cmd === 'set') {
      if (!arg) { console.log(chalk.red('Provide an ISO datetime, e.g., set 2024-04-01T12:00:00Z')); continue; }
      await handleSet(arg);
      continue;
    }

    if (cmd === 'save') {
      await handleSave(arg || undefined);
      continue;
    }

    if (cmd === 'load') {
      await handleLoad(arg || undefined);
      continue;
    }

    console.log(chalk.red('Unknown command.'), chalk.gray('Type'), chalk.white('help'));
  }

  console.log();
  console.log(chalk.green('Goodbye!'));
  process.exit(0);
}

main().catch((e) => {
  console.error(chalk.red('Demo crashed:'), e);
  process.exit(1);
});
