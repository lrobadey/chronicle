/**
 * Chronicle v4 - Orchestrator
 * 
 * The central nervous system of the game.
 * Coordinates the GM Loop: Input -> Context -> GM -> Patches -> System -> Narrator -> Output
 */

import { runGMTurn, createGMRuntime, type GMEvent } from '../gm';
import { narrate, type NarratorStyle, buildNarratorContext } from '../narrator';
import { applyPatches, computeSystemPatches, type Patch } from './arbiter';
import { buildTelemetry } from './systems';
import type { World } from './world';
import { ContextManager } from './context';
import { HistoryManager } from './history';

export interface OrchestratorEvents {
  onPhaseChange?: (phase: 'idle' | 'planning' | 'acting' | 'narrating') => void;
  onThought?: (token: string) => void;
  onLog?: (msg: string) => void;
  onError?: (err: string) => void;
}

export interface OrchestratorConfig {
  apiKey?: string;
  initialWorld: World;
  narratorStyle?: NarratorStyle;
}

export interface TurnResult {
  narration: string;
  patches: Patch[];
  world: World;
}

export class Orchestrator {
  private history: HistoryManager;
  private apiKey?: string;
  private style: NarratorStyle;
  private events: OrchestratorEvents;

  constructor(config: OrchestratorConfig, events: OrchestratorEvents = {}) {
    this.history = new HistoryManager(config.initialWorld);
    this.apiKey = config.apiKey;
    this.style = config.narratorStyle || 'michener';
    this.events = events;
  }

  get world(): World {
    return this.history.current;
  }

  set world(w: World) {
    this.history.push(w);
  }

  get canUndo() { return this.history.canUndo; }
  get canRedo() { return this.history.canRedo; }

  undo() { 
    const w = this.history.undo();
    if (w) this.events.onLog?.('Undid last turn.');
    return w;
  }

  redo() {
    const w = this.history.redo();
    if (w) this.events.onLog?.('Redid turn.');
    return w;
  }

  async processTurn(playerInput: string): Promise<TurnResult> {
    this.events.onPhaseChange?.('planning');
    
    // 1. Context Selection
    const context = ContextManager.build(this.world, playerInput);
    this.events.onLog?.(`Context built (${context.split('\n').length} lines)`);

    // 2. GM Execution
    const { runtime, getWorld } = createGMRuntime(this.world);
    
    this.events.onPhaseChange?.('acting');
    const gm = await runGMTurn({
      apiKey: this.apiKey,
      world: this.world,
      playerText: playerInput,
      runtime,
      onEvent: (e) => this.handleGMEvent(e),
    });

    if (gm.usedFallback) {
      this.events.onLog?.('GM used fallback logic.');
    }

    // 3. System Reactivity
    let finalWorld = getWorld(); // GM applied patches internally to this copy
    const gmPatches = gm.result.patches as Patch[]; // Cast to compatible type

    const systemPatches = computeSystemPatches(finalWorld, gmPatches);
    let allPatches = [...gmPatches, ...systemPatches];

    if (systemPatches.length > 0) {
      this.events.onLog?.(`System applied ${systemPatches.length} reactive patches.`);
      finalWorld = applyPatches(finalWorld, systemPatches, 'System reaction');
    }

    // 4. Commit State
    this.world = finalWorld;

    // 5. Narration
    this.events.onPhaseChange?.('narrating');
    const telemetry = buildTelemetry(finalWorld);
    
    const narration = await narrate({
      apiKey: this.apiKey,
      world: finalWorld,
      playerText: playerInput,
      patches: allPatches,
      style: this.style,
      telemetry,
    });

    this.events.onPhaseChange?.('idle');

    return {
      narration,
      patches: allPatches,
      world: finalWorld,
    };
  }

  private handleGMEvent(e: GMEvent) {
    if (e.type === 'llm_thought') {
      this.events.onThought?.(e.token);
      return;
    }

    if (this.events.onLog) {
       // Log everything for now to debug hang
       if (e.type === 'llm_token') {
         // suppress token spam
       } else {
         this.events.onLog(`[GM Event] ${e.type}: ${JSON.stringify('tool' in e ? e.tool : '')}`);
       }
    }

    if (e.type === 'tool_start') {
      this.events.onLog?.(`GM Tool: ${e.tool}`);
    } else if (e.type === 'error') {
      this.events.onError?.(e.message);
    }
  }

  setStyle(style: NarratorStyle) {
    this.style = style;
  }
}
