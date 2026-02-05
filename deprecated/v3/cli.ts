import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { createIsleOfMarrowWorld, type SimpleWorld } from './state/world';
import { createToolRuntime } from './tools/index';
import type { Patch } from './tools/types';
import { applyPatches } from './state/arbiter';
import { runGMAgentTurn } from './agents/gm';
import { runNarratorTurn, type ConversationHistoryEntry, generateInitialNarration } from './agents/narrator';
import { projectPKGFromGraph } from './state/pkg';
import { buildTurnTelemetry } from './state/telemetry';
import { NARRATOR_DEFAULT_STYLE } from './config';
import { ActivityBoard } from './ui/ActivityBoard';
import { TurnStatusPanel, type VerbosityLevel } from './ui/TurnStatusPanel';
import { calculateTideState, formatGameTime, getGameDay } from './state/systems';
import { getTimeState, deriveAbsoluteTime, ensureTimeAnchor } from './state/time';
import { registerCoreSystems } from './state/systems/core';

// Initialize systems - moved to top level to ensure they're registered before any world operations
registerCoreSystems();

// Helper function to format world date and time from telemetry
// Returns format like "May 14, 1825, 2:01 PM"
function formatWorldDateTime(world: SimpleWorld): string {
  const timeState = getTimeState(world);
  if (!timeState) {
    return 'Unknown';
  }
  
  const timeStateWithAnchor = ensureTimeAnchor(timeState, world.meta);
  const richTime = deriveAbsoluteTime(timeStateWithAnchor, world.meta?.turn);
  
  if (richTime.calendar && richTime.absolute) {
    const cal = richTime.calendar;
    const date = richTime.absolute.date;
    
    // Convert to 12-hour format
    let hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12; // 0 should be 12 for 12-hour format
    
    const minutesStr = minutes.toString().padStart(2, '0');
    
    return `${cal.month.name} ${cal.month.dayOfMonth}, ${cal.year}, ${hours}:${minutesStr} ${ampm}`;
  }
  
  // Fallback if calendar data not available
  return 'Unknown';
}

interface ConversationEntry {
  playerInput: string;
  gmOutput: string;
  patches: Patch[];
  timestamp: Date;
}

interface SessionConfig {
  showActivityBoard: boolean;
  showStateSummary: boolean;
  showPatches: boolean;
  narratorStyle: 'lyric' | 'cinematic' | 'michener';
  verbosity: VerbosityLevel;
}

function envBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

const ENV_DEFAULT_CONFIG: Partial<SessionConfig> = {
  showActivityBoard: envBoolean('CHRONICLE_CLI_ACTIVITY', true),
  showStateSummary: envBoolean('CHRONICLE_CLI_SUMMARY', true),
  showPatches: envBoolean('CHRONICLE_CLI_PATCHES', false),
  verbosity: 1,
};

const envNarratorStyle = (process.env.CHRONICLE_CLI_STYLE || '').trim().toLowerCase();
if (envNarratorStyle && ['lyric', 'cinematic', 'michener'].includes(envNarratorStyle)) {
  ENV_DEFAULT_CONFIG.narratorStyle = envNarratorStyle as SessionConfig['narratorStyle'];
}

class Session {
  private world: SimpleWorld;
  private conversationHistory: ConversationEntry[] = [];
  private latent: { label: string; dir?: 'north' | 'south' | 'east' | 'west'; ttl: number }[] = [];
  private lastStateSummary: any = null;
  private lastGMSummary: string | null = null;
  private config: SessionConfig = {
    showActivityBoard: true,
    showStateSummary: true,
    showPatches: false,
    narratorStyle: NARRATOR_DEFAULT_STYLE,
    verbosity: 1,
  };

  constructor(initialWorld: SimpleWorld, initialConfig?: Partial<SessionConfig>) {
    this.world = initialWorld;
    if (initialConfig) {
      this.updateConfig(initialConfig);
    }
  }

  getWorld(): SimpleWorld {
    return this.world;
  }

  getHistory(): readonly ConversationEntry[] {
    return this.conversationHistory;
  }

  getConfig(): SessionConfig {
    return this.config;
  }

  getLastStateSummary(): any {
    return this.lastStateSummary;
  }

  getLastGMSummary(): string | null {
    return this.lastGMSummary;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  updateConfig(updates: Partial<SessionConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  async processTurn(playerInput: string, apiKey: string | undefined): Promise<string> {
    let shadowWorld = this.cloneWorld(this.world);
    const runtime = createToolRuntime(() => shadowWorld, (w) => { shadowWorld = w; });
    const priorConversation = this.conversationHistory.slice(-5).map((entry) => ({
      playerInput: entry.playerInput,
      gmOutput: entry.gmOutput,
    }));

    const statusPanel = new TurnStatusPanel(this.config.verbosity);
    statusPanel.start();

    const gm = await runGMAgentTurn({
      apiKey: apiKey || undefined,
      runtime,
      playerText: playerInput,
      world: this.world,
      latent: this.latent.map((h) => ({ label: h.label, dir: h.dir })),
      conversationHistory: priorConversation,
      onEvent: (e) => statusPanel.onEvent(e as any),
    });

    let finalWorld = this.world;
    if (gm.usedFallback) {
      if (gm.result.patches.length) {
        finalWorld = applyPatches(this.world, gm.result.patches as Patch[], 'GM fallback patch');
      }
    } else {
      finalWorld = shadowWorld;
    }

    this.world = finalWorld;
    this.lastStateSummary = gm.result.stateSummary ?? null;
    this.lastGMSummary = this.buildGMSummary(gm.result as any, gm.intermediateSteps);

    // Get last 5 conversation entries for narrator context
    const conversationHistory: ConversationHistoryEntry[] = this.conversationHistory.slice(-5).map((entry) => ({
      playerInput: entry.playerInput,
      gmOutput: entry.gmOutput,
      patches: entry.patches,
      timestamp: entry.timestamp,
    }));

    // Build telemetry - single source of truth for this turn
    const telemetry = buildTurnTelemetry(finalWorld);

    try {
      statusPanel.onNarratorStart();
      const narration = await runNarratorTurn({
        apiKey: apiKey || undefined,
        playerText: playerInput,
        world: finalWorld,
        patches: gm.result.patches as Patch[],
        stateSummary: gm.result.stateSummary,
        pkg: projectPKGFromGraph(finalWorld),
        conversationHistory,
        style: this.config.narratorStyle,
        telemetry, // Pass telemetry for unified context
      });
      this.extractLatentHints(narration);
      
      this.conversationHistory.push({
        playerInput,
        gmOutput: narration,
        patches: gm.result.patches as Patch[],
        timestamp: new Date(),
      });

      return narration;
    } finally {
      statusPanel.onNarratorEnd();
      statusPanel.stop();
    }
  }

  private cloneWorld(world: SimpleWorld): SimpleWorld {
    return JSON.parse(JSON.stringify(world));
  }

  getStateSummary(): string {
    const loc = this.world.locations[this.world.player.location];
    const inv = this.world.player.inventory.map(i => i.name).join(', ');
    const pos = this.world.player.pos;
    const lines = [
      `Time: ${formatWorldDateTime(this.world)}`,
      `Location: ${loc?.name || this.world.player.location}`,
      `Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}${pos.z !== undefined ? `, ${pos.z.toFixed(1)}` : ''})`,
      `Description: ${loc?.description || 'Unknown space.'}`,
      `Inventory: ${inv || '(empty)'}`,
      `Ledger entries: ${this.world.ledger.length}`,
    ];

    // Add system information if present
    if (this.world.systems) {
      
      // Tide system (calculated from time)
      if (this.world.systems.tide && this.world.systems.time) {
        const tideState = calculateTideState(
          this.world.systems.time.elapsedMinutes,
          this.world.systems.tide.cycleMinutes
        );
        lines.push(`Tide: ${tideState.phase} (level: ${(tideState.level * 100).toFixed(0)}%, changes in ${tideState.minutesUntilChange} min)`);
      }
      
      // Economy
      if (this.world.systems.economy) {
        const goods = this.world.systems.economy.goods;
        const goodsStr = Object.entries(goods).map(([k, v]) => `${k}: ${v}`).join(', ');
        lines.push(`Economy: ${goodsStr}`);
      }
    }

    // Add NPC locations if present
    if (this.world.npcs) {
      const npcCount = Object.keys(this.world.npcs).length;
      lines.push(`NPCs: ${npcCount} present on the island`);
    }

    return lines.join('\n');
  }

  private extractLatentHints(text: string) {
    try {
      const dirs = ['north', 'south', 'east', 'west'] as const;
      const found: { label: string; dir?: 'north' | 'south' | 'east' | 'west'; ttl: number }[] = [];
      for (const d of dirs) {
        // Prefer noun + optional adjective, then explicit direction: "faint trail to the south"
        const re1 = new RegExp(
          `\\b(?:faint|thin|distant|soft)\\s+(?:animal\\s+)?(?:trail|path|smoke|prints|footprints|glow)\\s+(?:to\\s+the\\s+)?${d}\\b`,
          'i'
        );
        // Or direction-first forms: "southward trail", "south trail"
        const re2 = new RegExp(
          `\\b${d}(?:ward)?\\s+(?:trail|path|track|prints|footprints|glow|smoke)\\b`,
          'i'
        );
        const m1 = text.match(re1);
        const m2 = m1 ? null : text.match(re2);
        const match = m1 || m2;
        if (match) found.push({ label: match[0].trim(), dir: d, ttl: 2 });
      }
      // decay existing
      const decayed = this.latent.map((h) => ({ ...h, ttl: h.ttl - 1 })).filter((h) => h.ttl > 0);
      // dedupe by dir (prefer newly found)
      const merged: typeof this.latent = [];
      const pushOrReplace = (hint: { label: string; dir?: 'north' | 'south' | 'east' | 'west'; ttl: number }) => {
        const idx = merged.findIndex((h) => h.dir && hint.dir && h.dir === hint.dir);
        if (idx >= 0) merged[idx] = hint; else merged.push(hint);
      };
      for (const h of decayed) pushOrReplace(h);
      for (const h of found) pushOrReplace(h);
      this.latent = merged;
    } catch {
      // ignore extraction errors
    }
  }

  getLatent(): readonly { label: string; dir?: 'north' | 'south' | 'east' | 'west' }[] {
    return this.latent;
  }

  private buildGMSummary(result: any, steps: any[]): string | null {
    try {
      const parts: string[] = [];

      if (Array.isArray(result?.patches) && result.patches.length) {
        const count = result.patches.length;
        parts.push(`applied ${count} patch${count === 1 ? '' : 'es'}`);
      }

      const ss = result?.stateSummary || {};
      const travel = ss.travel || ss.lastTravel || ss.travelResult;
      if (travel) {
        const rawDistance = travel.distanceMeters ?? travel.distance ?? travel.meters ?? null;
        const distanceLabel =
          typeof rawDistance === 'number' && Number.isFinite(rawDistance)
            ? `${Math.round(rawDistance)}m`
            : null;
        const rawMinutes =
          travel.travelTimeMinutes ??
          travel.minutes ??
          travel.time ??
          travel.duration ??
          null;
        const minutesLabel =
          typeof rawMinutes === 'number' && Number.isFinite(rawMinutes)
            ? `${Math.round(rawMinutes)} min`
            : null;
        const destinationName =
          travel.toName ||
          travel.destinationName ||
          travel.destination ||
          travel.to ||
          travel.locationId ||
          null;

        const travelParts: string[] = [];
        if (distanceLabel) travelParts.push(distanceLabel);
        if (minutesLabel) travelParts.push(minutesLabel);
        let travelSummary = travelParts.join(' in ');
        if (destinationName) {
          travelSummary = travelSummary
            ? `${travelSummary} → ${destinationName}`
            : `→ ${destinationName}`;
        }
        if (travelSummary) {
          parts.push(`travel: ${travelSummary}`);
        }
      }

      if (Array.isArray(steps) && steps.length) {
        const tools = Array.from(
          new Set(
            steps
              .map((s: any) => s?.action?.tool as string | undefined)
              .filter((t): t is string => Boolean(t)),
          ),
        ).slice(0, 3);
        if (tools.length) {
          parts.push(`tools: ${tools.join(', ')}`);
        }
      }

      if (!parts.length) return null;
      return `GM summary: ${parts.join(' | ')}`;
    } catch {
      return null;
    }
  }
}

function handleRuntimeCommand(input: string, session: Session): 'ignored' | 'handled' | 'exit' {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return 'ignored';

  const parts = trimmed.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case 'help':
    case 'h':
      console.log('\nRuntime Commands:');
      console.log('  /help, /h              - Show this help');
      console.log('  /state, /s             - Show current world state');
      console.log('  /history, /hist        - Show conversation history');
      console.log('  /clear                 - Clear conversation history');
      console.log('  /config                - Show current configuration');
      console.log('  /toggle <setting>      - Toggle a setting (activityboard, statesummary, patches)');
      console.log('  /style <lyric|cinematic|michener> - Set narrator style');
      console.log('  /verbosity <level>     - Set CLI verbosity (0=quiet, 1=default, 2=debug)');
      console.log('  /exit, /quit, /q      - Exit the session');
      console.log();
      return 'handled';

    case 'state':
    case 's':
      console.log('\n=== Current World State ===');
      console.log(session.getStateSummary());
      console.log();
      return 'handled';

    case 'history':
    case 'hist':
      const history = session.getHistory();
      if (history.length === 0) {
        console.log('\nNo conversation history yet.\n');
      } else {
        console.log('\n=== Conversation History ===');
        const currentWorld = session.getWorld();
        history.forEach((entry, idx) => {
          // For history, we could show both real-world timestamp and approximate world time
          // For now, just show the real-world timestamp when the entry was made
          const entryDateTime = entry.timestamp.getFullYear() + '-' + 
            String(entry.timestamp.getMonth() + 1).padStart(2, '0') + '-' + 
            String(entry.timestamp.getDate()).padStart(2, '0') + ' ' + 
            entry.timestamp.toTimeString().slice(0, 8);
          console.log(`\n[${idx + 1}] ${entryDateTime} (session time)`);
          console.log(`You: ${entry.playerInput}`);
          console.log(`GM: ${entry.gmOutput}`);
          if (entry.patches.length > 0) {
            console.log(`Patches applied: ${entry.patches.length}`);
          }
        });
        console.log();
      }
      return 'handled';

    case 'clear':
      session.clearHistory();
      console.log('\nConversation history cleared.\n');
      return 'handled';

    case 'config':
      const config = session.getConfig();
      console.log('\n=== Session Configuration ===');
      console.log(`Show Activity Board: ${config.showActivityBoard}`);
      console.log(`Show State Summary: ${config.showStateSummary}`);
      console.log(`Show Patches: ${config.showPatches}`);
      console.log(`Narrator Style: ${config.narratorStyle}`);
      console.log(`Verbosity: ${config.verbosity}`);
      console.log();
      return 'handled';

    case 'toggle':
      if (args.length === 0) {
        console.log('\nUsage: /toggle <setting>\nAvailable: activityboard, statesummary, patches\n');
        return 'handled';
      }
      const setting = args[0].toLowerCase();
      switch (setting) {
        case 'activityboard':
        case 'ab':
          session.updateConfig({ showActivityBoard: !session.getConfig().showActivityBoard });
          console.log(`\nActivity Board: ${session.getConfig().showActivityBoard ? 'ON' : 'OFF'}\n`);
          break;
        case 'statesummary':
        case 'ss':
          session.updateConfig({ showStateSummary: !session.getConfig().showStateSummary });
          console.log(`\nState Summary: ${session.getConfig().showStateSummary ? 'ON' : 'OFF'}\n`);
          break;
        case 'patches':
        case 'p':
          session.updateConfig({ showPatches: !session.getConfig().showPatches });
          console.log(`\nPatches Display: ${session.getConfig().showPatches ? 'ON' : 'OFF'}\n`);
          break;
        default:
          console.log(`\nUnknown setting: ${setting}\nAvailable: activityboard, statesummary, patches\n`);
      }
      return 'handled';

    case 'style':
      if (!args[0]) {
        console.log('\nUsage: /style <lyric|cinematic|michener>\n');
        return 'handled';
      }
      {
        const s = args[0].toLowerCase();
        if (s === 'lyric' || s === 'cinematic' || s === 'michener') {
          session.updateConfig({ narratorStyle: s as any });
          console.log(`\nNarrator style: ${s}\n`);
        } else {
          console.log('\nUnknown style. Try: lyric | cinematic | michener\n');
        }
      }
      return 'handled';

    case 'verbosity':
    case 'verb':
    case 'v': {
      const current = session.getConfig().verbosity;
      if (!args[0]) {
        console.log('\nVerbosity levels:');
        console.log('  0 - quiet   (no status panel, just narration + summary)');
        console.log('  1 - default (compact status panel)');
        console.log('  2 - debug   (status panel + extra agent hints)');
        console.log(`\nCurrent verbosity: ${current}\n`);
        return 'handled';
      }

      const raw = args[0].toLowerCase();
      let next: VerbosityLevel | null = null;
      if (raw === '0' || raw === 'quiet') next = 0;
      else if (raw === '1' || raw === 'default') next = 1;
      else if (raw === '2' || raw === 'debug') next = 2;

      if (next === null) {
        console.log('\nUsage: /verbosity <0|1|2|quiet|default|debug>\n');
        return 'handled';
      }

      session.updateConfig({ verbosity: next });
      console.log(`\nVerbosity set to ${next}\n`);
      return 'handled';
    }

    case 'exit':
    case 'quit':
    case 'q':
      return 'exit';

    default:
      console.log(`\nUnknown command: /${cmd}\nType /help for available commands.\n`);
      return 'handled';
  }
}

async function main() {
  const apiKey = (process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const showApiKeyNote = !apiKey;

  console.log('Starting CLI...');
  
  // Check if stdin is a TTY to avoid hanging in non-interactive environments
  if (!input.isTTY) {
    console.error('Error: stdin is not a TTY. The CLI requires an interactive terminal.');
    console.error('Please run this in a terminal, not via a pipe or non-interactive shell.');
    process.exit(1);
  }
  
  const session = new Session(createIsleOfMarrowWorld(), ENV_DEFAULT_CONFIG);
  console.log('Session created');
  const rl = readline.createInterface({ input, output });
  console.log('Readline interface created');

  console.log();
  console.log('Chronicle v3 CLI - Isle of Marrow');
  const initialWorld = session.getWorld();
  console.log(`Time: ${formatWorldDateTime(initialWorld)}`);
  console.log('Chat freely with the GM agent. No hardcoded flows.');
  console.log('Type your actions in natural language.');
  if (showApiKeyNote) {
    console.log('(Tip: set VITE_OPENAI_API_KEY in .env to enable the GM model; otherwise a fallback will run)');
  }
  console.log('Type /help for runtime commands, or /exit to quit.');
  console.log();

  // Generate and display initial world-building paragraph
  console.log('Generating initial narration...');
  try {
    const world = session.getWorld();
    // Only add timeout if we have an API key (otherwise it returns immediately)
    let initialNarration: string;
    if (apiKey) {
      const initialNarrationPromise = generateInitialNarration({
        apiKey,
        world,
        style: session.getConfig().narratorStyle,
      });
      // Use 35 second timeout to allow ChatOpenAI's 30s timeout to complete
      const timeoutPromise = new Promise<string>((_, reject) => 
        setTimeout(() => reject(new Error('Initial narration timeout after 35 seconds')), 35000)
      );
      initialNarration = await Promise.race([initialNarrationPromise, timeoutPromise]);
    } else {
      // No API key - will return immediately with fallback
      initialNarration = await generateInitialNarration({
        apiKey: undefined,
        world,
        style: session.getConfig().narratorStyle,
      });
    }
    console.log(initialNarration);
    console.log();
  } catch (err) {
    // If initial narration fails, continue anyway with fallback
    console.log('Using fallback narration...');
    const world = session.getWorld();
    const loc = world.locations[world.player.location];
    console.log(loc?.description || 'You find yourself in an unfamiliar place.');
    console.log();
    if (err instanceof Error) {
      console.error('(Could not generate initial narration: ' + err.message + ')');
    }
  }

  console.log('Ready! Type your first action or command.');
  console.log();

  try {
    while (true) {
      const line = (await rl.question('> ')).trim();
      if (!line) continue;

    // Handle runtime commands
    const cmdStatus = handleRuntimeCommand(line, session);
    if (cmdStatus === 'exit') break; // exit command
    if (cmdStatus === 'handled') continue; // other command handled

      // Process normal player input
      try {
        const narration = await session.processTurn(line, apiKey);
        console.log(narration);

        const gmSummary = typeof (session as any).getLastGMSummary === 'function'
          ? (session as any).getLastGMSummary()
          : null;
        if (gmSummary) {
          console.log(gmSummary);
        }
        
        if (session.getConfig().showStateSummary) {
          const world = session.getWorld();
          const loc = world.locations[world.player.location];
          const inv = world.player.inventory.map(i => i.name).join(', ');
          const pos = world.player.pos;
          console.log(`\n- Time: ${formatWorldDateTime(world)}`);
          console.log(`- Location: ${loc?.name || world.player.location}`);
          console.log(`- Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}${pos.z !== undefined ? `, ${pos.z.toFixed(1)}` : ''})`);
          console.log(`- Inventory: ${inv || '(empty)'}`);
          
          // Tide display (calculated from time)
          if (world.systems?.tide && world.systems?.time) {
            const tideState = calculateTideState(
              world.systems.time.elapsedMinutes,
              world.systems.tide.cycleMinutes
            );
            console.log(`- Tide: ${tideState.phase} (${(tideState.level * 100).toFixed(0)}%)`);
          }

          // Travel summary (from last GM state summary, if provided)
          const lastSummary = typeof (session as any).getLastStateSummary === 'function' ? (session as any).getLastStateSummary() : undefined;
          const travelInfo = lastSummary?.travel || lastSummary?.lastTravel;
          if (travelInfo) {
            const rawDistance = travelInfo.distanceMeters ?? travelInfo.distance ?? travelInfo.meters ?? null;
            const distanceLabel = typeof rawDistance === 'number' && Number.isFinite(rawDistance)
              ? `${Math.round(rawDistance)}m`
              : null;
            const rawMinutes = travelInfo.travelTimeMinutes ?? travelInfo.minutes ?? travelInfo.time ?? travelInfo.duration ?? null;
            const minutesLabel = typeof rawMinutes === 'number' && Number.isFinite(rawMinutes)
              ? `${Math.round(rawMinutes)} min`
              : null;
            const terrainMultiplier = travelInfo.terrainMultiplier ?? travelInfo.multiplier;
            const terrainLabel = typeof terrainMultiplier === 'number' && Number.isFinite(terrainMultiplier)
              ? `terrain x${terrainMultiplier.toFixed(2)}`
              : null;
            const destinationName = travelInfo.toName || travelInfo.destinationName || travelInfo.destination || travelInfo.to || null;

            const metrics: string[] = [];
            if (distanceLabel) metrics.push(distanceLabel);
            if (minutesLabel) metrics.push(minutesLabel);
            let metricSummary = metrics.join(' in ');
            if (terrainLabel) {
              metricSummary = metricSummary ? `${metricSummary} (${terrainLabel})` : terrainLabel;
            }
            const suffix = destinationName ? ` → ${destinationName}` : '';
            if (metricSummary || suffix) {
              console.log(`- Travel: ${metricSummary || 'n/a'}${suffix}`);
            }
          }
          
          const hint = (session as any).getLatent?.()?.[0];
          if (hint?.label) console.log(`- Hint: ${hint.label}`);
        }
        console.log();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`\nError processing turn: ${message}`);
        if (err instanceof Error && err.stack) {
          console.log(`\nStack trace:\n${err.stack}`);
        }
        console.log('Continuing... You can try again or type /exit to quit.\n');
      }
    }
  } finally {
    await rl.close();
    console.log('Goodbye!');
  }
}

main().catch((e) => {
  console.error('\nCLI crashed:', e);
  if (e instanceof Error && e.stack) {
    console.error('\nStack trace:', e.stack);
  }
  process.exit(1);
});
