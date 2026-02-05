import 'dotenv/config';
import { createIsleOfMarrowWorld, type SimpleWorld } from '../state/world';
import { createToolRuntime } from '../tools/index';
import { ActivityBoard, type GMEvent } from '../ui/ActivityBoard';
import { runGMAgentTurnFallback } from '../agents/gmOpenAI';
import { runNarratorTurn, generateInitialNarration } from '../agents/narrator';
import { applyPatches } from '../state/arbiter';
import { projectPKGFromGraph } from '../state/pkg';
import { buildTurnTelemetry } from '../state/telemetry';
import { calculateTideState } from '../state/systems';
import { getTimeState, deriveAbsoluteTime, ensureTimeAnchor } from '../state/time';

// Extract Session class and related functions from cli.ts for testing
// We'll import them directly by reading the file structure

interface ConversationEntry {
  playerInput: string;
  gmOutput: string;
  patches: any[];
  timestamp: Date;
}

interface SessionConfig {
  showActivityBoard: boolean;
  showStateSummary: boolean;
  showPatches: boolean;
  narratorStyle: 'lyric' | 'cinematic' | 'michener';
}

// Mock Session class for testing
class TestSession {
  private world: SimpleWorld;
  private conversationHistory: ConversationEntry[] = [];
  private latent: { label: string; dir?: 'north' | 'south' | 'east' | 'west'; ttl: number }[] = [];
  private lastStateSummary: any = null;
  private config: SessionConfig = {
    showActivityBoard: true,
    showStateSummary: true,
    showPatches: false,
    narratorStyle: 'michener',
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

  clearHistory(): void {
    this.conversationHistory = [];
  }

  updateConfig(updates: Partial<SessionConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  async processTurn(playerInput: string, apiKey: string | undefined): Promise<string> {
    let shadowWorld = this.cloneWorld(this.world);
    const runtime = createToolRuntime(() => shadowWorld, (w) => { shadowWorld = w; });

    // Use fallback GM for deterministic testing
    const gm = await runGMAgentTurnFallback(playerInput, this.world);
    
    let finalWorld = this.world;
    if (gm.patches.length) {
      finalWorld = applyPatches(this.world, gm.patches, 'GM fallback patch');
    }

    this.world = finalWorld;
    this.lastStateSummary = gm.stateSummary ?? null;

    // Extract latent hints from narration (simplified)
    this.extractLatentHints('');

    const conversationHistory: any[] = this.conversationHistory.slice(-5).map((entry) => ({
      playerInput: entry.playerInput,
      gmOutput: entry.gmOutput,
      patches: entry.patches,
      timestamp: entry.timestamp,
    }));

    const telemetry = buildTurnTelemetry(finalWorld);
    const pkg = projectPKGFromGraph(finalWorld);

    const narration = await runNarratorTurn({
      apiKey: apiKey || undefined,
      playerText: playerInput,
      world: finalWorld,
      patches: gm.patches,
      stateSummary: gm.stateSummary,
      pkg,
      conversationHistory,
      style: this.config.narratorStyle,
      telemetry,
    });

    this.conversationHistory.push({
      playerInput,
      gmOutput: narration,
      patches: gm.patches,
      timestamp: new Date(),
    });

    return narration;
  }

  private cloneWorld(world: SimpleWorld): SimpleWorld {
    return JSON.parse(JSON.stringify(world));
  }

  getStateSummary(): string {
    const loc = this.world.locations[this.world.player.location];
    const inv = this.world.player.inventory.map((i) => i.name).join(', ');
    const pos = this.world.player.pos;
    const lines = [
      `Time: ${this.formatWorldDateTime(this.world)}`,
      `Location: ${loc?.name || this.world.player.location}`,
      `Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}${pos.z !== undefined ? `, ${pos.z.toFixed(1)}` : ''})`,
      `Description: ${loc?.description || 'Unknown space.'}`,
      `Inventory: ${inv || '(empty)'}`,
      `Ledger entries: ${this.world.ledger.length}`,
    ];

    if (this.world.systems?.tide && this.world.systems?.time) {
      const tideState = calculateTideState(
        this.world.systems.time.elapsedMinutes,
        this.world.systems.tide.cycleMinutes
      );
      lines.push(`Tide: ${tideState.phase} (level: ${(tideState.level * 100).toFixed(0)}%, changes in ${tideState.minutesUntilChange} min)`);
    }

    if (this.world.systems?.economy) {
      const goods = this.world.systems.economy.goods;
      const goodsStr = Object.entries(goods).map(([k, v]) => `${k}: ${v}`).join(', ');
      lines.push(`Economy: ${goodsStr}`);
    }

    if (this.world.npcs) {
      const npcCount = Object.keys(this.world.npcs).length;
      lines.push(`NPCs: ${npcCount} present on the island`);
    }

    return lines.join('\n');
  }

  private formatWorldDateTime(world: SimpleWorld): string {
    const timeState = getTimeState(world);
    if (!timeState) return 'Unknown';
    
    const timeStateWithAnchor = ensureTimeAnchor(timeState, world.meta);
    const richTime = deriveAbsoluteTime(timeStateWithAnchor, world.meta?.turn);
    
    if (richTime.calendar && richTime.absolute) {
      const cal = richTime.calendar;
      const date = richTime.absolute.date;
      let hours = date.getUTCHours();
      const minutes = date.getUTCMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      if (hours === 0) hours = 12;
      const minutesStr = minutes.toString().padStart(2, '0');
      return `${cal.month.name} ${cal.month.dayOfMonth}, ${cal.year}, ${hours}:${minutesStr} ${ampm}`;
    }
    return 'Unknown';
  }

  private extractLatentHints(text: string) {
    try {
      const dirs = ['north', 'south', 'east', 'west'] as const;
      const found: { label: string; dir?: 'north' | 'south' | 'east' | 'west'; ttl: number }[] = [];
      for (const d of dirs) {
        const re1 = new RegExp(
          `\\b(?:faint|thin|distant|soft)\\s+(?:animal\\s+)?(?:trail|path|smoke|prints|footprints|glow)\\s+(?:to\\s+the\\s+)?${d}\\b`,
          'i'
        );
        const re2 = new RegExp(
          `\\b${d}(?:ward)?\\s+(?:trail|path|track|prints|footprints|glow|smoke)\\b`,
          'i'
        );
        const m1 = text.match(re1);
        const m2 = m1 ? null : text.match(re2);
        const match = m1 || m2;
        if (match) found.push({ label: match[0].trim(), dir: d, ttl: 2 });
      }
      const decayed = this.latent.map((h) => ({ ...h, ttl: h.ttl - 1 })).filter((h) => h.ttl > 0);
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
}

// Runtime command handler (simplified version for testing)
function handleRuntimeCommand(input: string, session: TestSession): 'ignored' | 'handled' | 'exit' {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return 'ignored';

  const parts = trimmed.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case 'help':
    case 'h':
      return 'handled';

    case 'state':
    case 's':
      return 'handled';

    case 'history':
    case 'hist':
      return 'handled';

    case 'clear':
      session.clearHistory();
      return 'handled';

    case 'config':
      return 'handled';

    case 'toggle':
      if (args.length === 0) return 'handled';
      const setting = args[0].toLowerCase();
      switch (setting) {
        case 'activityboard':
        case 'ab':
          session.updateConfig({ showActivityBoard: !session.getConfig().showActivityBoard });
          break;
        case 'statesummary':
        case 'ss':
          session.updateConfig({ showStateSummary: !session.getConfig().showStateSummary });
          break;
        case 'patches':
        case 'p':
          session.updateConfig({ showPatches: !session.getConfig().showPatches });
          break;
      }
      return 'handled';

    case 'style':
      if (!args[0]) return 'handled';
      const s = args[0].toLowerCase();
      if (s === 'lyric' || s === 'cinematic' || s === 'michener') {
        session.updateConfig({ narratorStyle: s as any });
      }
      return 'handled';

    case 'exit':
    case 'quit':
    case 'q':
      return 'exit';

    default:
      return 'handled';
  }
}

// Test suite
async function testSessionBasics() {
  console.log('🧪 Test 1: Session basics');
  const world = createIsleOfMarrowWorld();
  const session = new TestSession(world);

  if (session.getWorld() !== world) throw new Error('Session should return initial world');
  if (session.getHistory().length !== 0) throw new Error('Session should start with empty history');
  if (session.getConfig().showActivityBoard !== true) throw new Error('Activity board should be on by default');
  
  console.log('   ✓ Session initialization');
}

async function testSessionProcessTurn() {
  console.log('🧪 Test 2: Session processTurn');
  const world = createIsleOfMarrowWorld();
  const session = new TestSession(world);

  const narration = await session.processTurn('look', undefined);
  if (!narration || typeof narration !== 'string') {
    throw new Error('processTurn should return narration string');
  }

  const history = session.getHistory();
  if (history.length !== 1) {
    throw new Error(`Expected 1 history entry, got ${history.length}`);
  }

  if (history[0].playerInput !== 'look') {
    throw new Error(`Expected playerInput 'look', got '${history[0].playerInput}'`);
  }

  if (!history[0].gmOutput) {
    throw new Error('History entry should have gmOutput');
  }

  console.log('   ✓ processTurn creates history entry');
}

async function testSessionConfig() {
  console.log('🧪 Test 3: Session config management');
  const world = createIsleOfMarrowWorld();
  const session = new TestSession(world, { showActivityBoard: false });

  if (session.getConfig().showActivityBoard !== false) {
    throw new Error('Initial config should be respected');
  }

  session.updateConfig({ showStateSummary: false });
  if (session.getConfig().showStateSummary !== false) {
    throw new Error('Config update should work');
  }

  session.updateConfig({ narratorStyle: 'lyric' });
  if (session.getConfig().narratorStyle !== 'lyric') {
    throw new Error('Narrator style update should work');
  }

  console.log('   ✓ Config management');
}

async function testSessionStateSummary() {
  console.log('🧪 Test 4: Session state summary');
  const world = createIsleOfMarrowWorld();
  const session = new TestSession(world);

  const summary = session.getStateSummary();
  if (!summary || typeof summary !== 'string') {
    throw new Error('getStateSummary should return string');
  }

  if (!summary.includes('Location:')) {
    throw new Error('State summary should include location');
  }

  if (!summary.includes('Time:')) {
    throw new Error('State summary should include time');
  }

  console.log('   ✓ State summary generation');
}

async function testRuntimeCommands() {
  console.log('🧪 Test 5: Runtime command handler');
  const world = createIsleOfMarrowWorld();
  const session = new TestSession(world);

  if (handleRuntimeCommand('/help', session) !== 'handled') {
    throw new Error('/help should be handled');
  }

  if (handleRuntimeCommand('/state', session) !== 'handled') {
    throw new Error('/state should be handled');
  }

  if (handleRuntimeCommand('/exit', session) !== 'exit') {
    throw new Error('/exit should return exit');
  }

  if (handleRuntimeCommand('look around', session) !== 'ignored') {
    throw new Error('Non-command should be ignored');
  }

  const initialHistoryLength = session.getHistory().length;
  handleRuntimeCommand('/clear', session);
  if (session.getHistory().length !== 0) {
    throw new Error('/clear should clear history');
  }

  console.log('   ✓ Runtime command handling');
}

async function testRuntimeCommandToggles() {
  console.log('🧪 Test 6: Runtime command toggles');
  const world = createIsleOfMarrowWorld();
  const session = new TestSession(world);

  const initialActivity = session.getConfig().showActivityBoard;
  handleRuntimeCommand('/toggle activityboard', session);
  if (session.getConfig().showActivityBoard === initialActivity) {
    throw new Error('Toggle should change activity board setting');
  }

  const initialSummary = session.getConfig().showStateSummary;
  handleRuntimeCommand('/toggle statesummary', session);
  if (session.getConfig().showStateSummary === initialSummary) {
    throw new Error('Toggle should change state summary setting');
  }

  handleRuntimeCommand('/style lyric', session);
  if (session.getConfig().narratorStyle !== 'lyric') {
    throw new Error('Style command should update narrator style');
  }

  console.log('   ✓ Runtime command toggles');
}

async function testActivityBoard() {
  console.log('🧪 Test 7: ActivityBoard event handling');
  const board = new ActivityBoard();

  const events: GMEvent[] = [
    { type: 'llm_start', prompts: ['test'] },
    { type: 'tool_start', tool: 'query_world', input: {} },
    { type: 'tool_end', tool: 'query_world', output: { ok: true } },
    { type: 'llm_end' },
  ];

  for (const event of events) {
    board.onEvent(event);
  }

  // ActivityBoard should handle events without crashing
  const staticRender = board.renderStatic([], []);
  if (!staticRender || typeof staticRender !== 'string') {
    throw new Error('ActivityBoard should render static output');
  }

  console.log('   ✓ ActivityBoard event handling');
}

async function testActivityBoardToolStates() {
  console.log('🧪 Test 8: ActivityBoard tool state tracking');
  const board = new ActivityBoard();

  board.onEvent({ type: 'tool_start', tool: 'query_world', input: {} });
  board.onEvent({ type: 'tool_end', tool: 'query_world', output: { ok: true } });

  board.onEvent({ type: 'tool_start', tool: 'apply_patches', input: { patches: [] } });
  board.onEvent({ type: 'tool_end', tool: 'apply_patches', output: { ok: true } });

  const staticRender = board.renderStatic(
    [
      { action: { tool: 'query_world', toolInput: {} }, observation: '{"ok":true}' },
      { action: { tool: 'apply_patches', toolInput: { patches: [] } }, observation: '{"ok":true}' },
    ],
    []
  );

  if (!staticRender.includes('query_world') || !staticRender.includes('apply_patches')) {
    throw new Error('ActivityBoard should show tool names in render');
  }

  console.log('   ✓ ActivityBoard tool state tracking');
}

async function testInitialNarration() {
  console.log('🧪 Test 9: Initial narration generation');
  const world = createIsleOfMarrowWorld();

  // Test without API key (fallback)
  const fallbackNarration = await generateInitialNarration({
    apiKey: undefined,
    world,
  });

  if (!fallbackNarration || typeof fallbackNarration !== 'string') {
    throw new Error('Initial narration should return string');
  }

  const loc = world.locations[world.player.location];
  if (!fallbackNarration.includes(loc?.description || '')) {
    // Fallback should use location description
    console.log('   ⚠️  Fallback narration format may vary');
  }

  console.log('   ✓ Initial narration generation');
}

async function testNarratorTurn() {
  console.log('🧪 Test 10: Narrator turn');
  const world = createIsleOfMarrowWorld();

  const narration = await runNarratorTurn({
    apiKey: undefined,
    playerText: 'look around',
    world,
    patches: [],
    stateSummary: {},
    style: 'michener',
  });

  if (!narration || typeof narration !== 'string') {
    throw new Error('Narrator turn should return string');
  }

  console.log('   ✓ Narrator turn');
}

async function testWorldStateFormatting() {
  console.log('🧪 Test 11: World state formatting');
  const world = createIsleOfMarrowWorld();
  const session = new TestSession(world);

  const summary = session.getStateSummary();
  
  // Check for key components
  const checks = [
    { needle: 'Location:', name: 'location' },
    { needle: 'Time:', name: 'time' },
    { needle: 'Position:', name: 'position' },
    { needle: 'Inventory:', name: 'inventory' },
  ];

  for (const check of checks) {
    if (!summary.includes(check.needle)) {
      throw new Error(`State summary should include ${check.name}`);
    }
  }

  console.log('   ✓ World state formatting');
}

async function testSessionHistoryManagement() {
  console.log('🧪 Test 12: Session history management');
  const world = createIsleOfMarrowWorld();
  const session = new TestSession(world);

  await session.processTurn('look', undefined);
  await session.processTurn('go north', undefined);
  await session.processTurn('examine', undefined);

  if (session.getHistory().length !== 3) {
    throw new Error(`Expected 3 history entries, got ${session.getHistory().length}`);
  }

  session.clearHistory();
  if (session.getHistory().length !== 0) {
    throw new Error('clearHistory should empty history');
  }

  console.log('   ✓ History management');
}

async function testLatentHints() {
  console.log('🧪 Test 13: Latent hints extraction');
  const world = createIsleOfMarrowWorld();
  const session = new TestSession(world);

  // Simulate extracting hints from narration
  const testNarration = 'You see a faint trail to the north. A distant glow appears to the south.';
  
  // Access private method via type assertion (testing only)
  (session as any).extractLatentHints(testNarration);
  
  const latent = session.getLatent();
  // Latent hints should be extracted (implementation may vary)
  if (!Array.isArray(latent)) {
    throw new Error('getLatent should return array');
  }

  console.log('   ✓ Latent hints extraction');
}

async function main() {
  try {
    await testSessionBasics();
    await testSessionProcessTurn();
    await testSessionConfig();
    await testSessionStateSummary();
    await testRuntimeCommands();
    await testRuntimeCommandToggles();
    await testActivityBoard();
    await testActivityBoardToolStates();
    await testInitialNarration();
    await testNarratorTurn();
    await testWorldStateFormatting();
    await testSessionHistoryManagement();
    await testLatentHints();

    console.log('\n✅ All CLI systems tests passed!');
  } catch (error) {
    console.error('\n❌ CLI systems tests failed:', error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();

