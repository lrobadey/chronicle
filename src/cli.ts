/**
 * Chronicle vNext - CLI
 */

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { TurnEngine } from './engine/turnEngine';

async function main() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;

  if (!input.isTTY) {
    console.error('Error: CLI requires an interactive terminal.');
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });
  const engine = new TurnEngine();

  console.log('\n=== Chronicle vNext - Isle of Marrow ===\n');
  if (!apiKey) console.log('(No API key - running in fallback mode)\n');

  const init = await engine.initSession({ apiKey });
  let sessionId = init.sessionId;
  let narratorStyle: 'lyric' | 'cinematic' | 'michener' = 'michener';

  console.log(init.opening);
  console.log('\nType /help for commands, or enter your action.\n');

  try {
    while (true) {
      const line = (await rl.question('> ')).trim();
      if (!line) continue;

      if (line.startsWith('/')) {
        const [cmd, ...args] = line.slice(1).split(' ');
        switch ((cmd || '').toLowerCase()) {
          case 'help':
          case 'h':
            console.log('\nCommands:');
            console.log('  /help      - Show this help');
            console.log('  /state     - Show current state');
            console.log('  /style     - Set narrator style (lyric|cinematic|michener)');
            console.log('  /exit      - Exit\n');
            break;
          case 'style': {
            const style = (args[0] || '').toLowerCase();
            if (['lyric', 'cinematic', 'michener'].includes(style)) {
              narratorStyle = style as typeof narratorStyle;
              console.log(`\nNarrator style: ${style}\n`);
            } else {
              console.log('\nUsage: /style <lyric|cinematic|michener>\n');
            }
            break;
          }
          case 'state':
          case 's': {
            const telemetry = await engine.getTelemetry(sessionId, 'player-1');
            console.log(`\nLocation: ${telemetry.location.name}`);
            console.log(`Position: (${telemetry.player.pos.x}, ${telemetry.player.pos.y})`);
            console.log(`Time: Day ${telemetry.time.currentDay}, Hour ${telemetry.time.currentHour}`);
            console.log(`Inventory: ${telemetry.player.inventory.map(i => i.name).join(', ') || '(empty)'}`);
            console.log(`Turn: ${telemetry.turn}\n`);
            break;
          }
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

      const result = await engine.runTurn({
        sessionId,
        playerId: 'player-1',
        playerText: line,
        apiKey,
        narratorStyle,
      });
      sessionId = result.sessionId;
      console.log(`\n${result.narration}\n`);
    }
  } finally {
    rl.close();
    console.log('Goodbye!');
  }
}

main().catch(console.error);
