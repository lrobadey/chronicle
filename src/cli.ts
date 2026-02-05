/**
 * Chronicle v4 - CLI
 * 
 * Simplified command-line interface using the Orchestrator.
 */

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { createIsleOfMarrowWorld } from './worlds/isle-of-marrow';
import { Orchestrator } from './core/orchestrator';
import { generateInitialNarration, type NarratorStyle } from './narrator';
import { formatGameTime } from './core/systems';

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;

  if (!input.isTTY) {
    console.error('Error: CLI requires an interactive terminal.');
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });

  console.log('\n=== Chronicle v4 - Isle of Marrow ===\n');

  if (!apiKey) {
    console.log('(No API key - running in fallback mode)');
  }

  // Initialize Orchestrator
  const orchestrator = new Orchestrator({
    apiKey,
    initialWorld: createIsleOfMarrowWorld(),
  }, {
    onThought: (token) => {
      // Use dimmed style for thinking (some terminals support this, others might ignore)
      process.stdout.write(`\x1b[2m${token}\x1b[0m`);
    },
    onLog: (msg) => console.log(`  [sys] ${msg}`),
    onError: (err) => console.error(`  [err] ${err}`),
  });

  // Initial Narration
  console.log('Loading...\n');
  const initialNarration = await generateInitialNarration({
    apiKey,
    world: orchestrator.world,
  });
  console.log(initialNarration);
  console.log('\nType /help for commands, or enter your action.\n');

  try {
    while (true) {
      const line = (await rl.question('> ')).trim();
      if (!line) continue;

      // Handle slash commands
      if (line.startsWith('/')) {
        const cmd = line.slice(1).toLowerCase().split(' ')[0];
        const args = line.slice(1).split(' ').slice(1);

        switch (cmd) {
          case 'help':
          case 'h':
            console.log('\nCommands:');
            console.log('  /help      - Show this help');
            console.log('  /state     - Show current state');
            console.log('  /style     - Set narrator style (lyric|cinematic|michener)');
            console.log('  /undo      - Undo last turn');
            console.log('  /redo      - Redo last turn');
            console.log('  /exit      - Exit\n');
            break;

          case 'state':
          case 's':
            const w = orchestrator.world;
            const loc = w.locations[w.player.location];
            const time = w.systems?.time?.elapsedMinutes ?? 0;
            console.log(`\nLocation: ${loc?.name || w.player.location}`);
            console.log(`Position: (${w.player.pos.x.toFixed(0)}, ${w.player.pos.y.toFixed(0)})`);
            console.log(`Time: ${formatGameTime(time, w.systems?.time?.startHour || 8)}`);
            console.log(`Inventory: ${w.player.inventory.map(i => i.name).join(', ') || '(empty)'}`);
            console.log(`Turn: ${w.meta?.turn || 0}\n`);
            break;

          case 'style':
            const style = args[0]?.toLowerCase();
            if (['lyric', 'cinematic', 'michener'].includes(style)) {
              orchestrator.setStyle(style as NarratorStyle);
              console.log(`\nNarrator style: ${style}\n`);
            } else {
              console.log('\nUsage: /style <lyric|cinematic|michener>\n');
            }
            break;

          case 'undo':
            if (orchestrator.undo()) {
              console.log('\nUndid last action.\n');
            } else {
              console.log('\nNothing to undo.\n');
            }
            break;

          case 'redo':
            if (orchestrator.redo()) {
              console.log('\nRedid action.\n');
            } else {
              console.log('\nNothing to redo.\n');
            }
            break;

          case 'exit':
          case 'quit':
          case 'q':
            rl.close();
            return;

          default:
            console.log(`\nUnknown command: /${cmd}\n`);
        }
        continue;
      }

      // Process Turn
      try {
        const result = await orchestrator.processTurn(line);
        console.log(`\n${result.narration}\n`);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    }
  } finally {
    rl.close();
    console.log('Goodbye!');
  }
}

main().catch(console.error);

