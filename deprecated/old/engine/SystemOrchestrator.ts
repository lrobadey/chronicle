// SystemOrchestrator.ts – High-level kernel loop for Chronicle V2
// ================================================================
// This orchestrator ties together:
//  • Scheduler – when systems should execute
//  • SystemSpec registry – what systems exist
//  • Arbiter – validation / commit of patches
//  • CanonLedger – append-only history
//  • GTWG – immutable world state
//
// For now the orchestrator runs synchronously on the main thread.  A
// future enhancement will move each system reducer into a Web Worker for
// true parallelism, but the orchestration logic will remain largely the
// same.

import { Scheduler } from './Scheduler';
import { getAllSystems, SystemSpec } from './SystemSpec';
import { commitPatchSet } from './Arbiter';
import { createEmptyCanonLedger, CanonLedger } from '../data/CanonLedger';
import { PatchSet } from './PressurePatch';
import { GTWG } from '../types/GTWGTypes.js';

export interface OrchestratorConfig {
  parallel?: boolean; // When true, each system may run in a Web Worker (future)
}

export class SystemOrchestrator {
  private gtwg: GTWG;
  private ledger: CanonLedger;
  private scheduler: Scheduler;
  private config: OrchestratorConfig;

  constructor(initialGTWG: GTWG, config: OrchestratorConfig = {}) {
    this.gtwg = initialGTWG;
    this.ledger = createEmptyCanonLedger();
    this.scheduler = new Scheduler();
    this.config = config;
  }

  /**
   * Main entry point: process one player action.
   */
  processAction(action: unknown): { gtwg: GTWG; ledger: CanonLedger; patches: PatchSet } {
    // Determine which systems need to run this tick
    const { ctx, due } = this.scheduler.advance();

    let collected: PatchSet = [];

    // (Future) When parallel=true, run reducers in workers; for now sync loop
    for (const sys of due) {
      try {
        const patches = sys.reducer(this.gtwg, action, []);
        if (patches && patches.length) collected = collected.concat(patches);
      } catch (err) {
        console.error(`[Orchestrator] System '${sys.id}' threw error`, err);
      }
    }

    if (collected.length === 0) {
      // Nothing changed – return unchanged state/ledger
      return { gtwg: this.gtwg, ledger: this.ledger, patches: [] };
    }

    // Commit via Arbiter (proposer='orchestrator' for now)
    const result = commitPatchSet(this.gtwg, this.ledger, collected, ctx.tick, 'orchestrator', action);
    if (result.ok) {
      this.gtwg = result.gtwg;
      this.ledger = result.ledger;
    } else {
      console.warn('[Orchestrator] PatchSet rejected', result.rejected);
    }

    return { gtwg: this.gtwg, ledger: this.ledger, patches: collected };
  }

  getWorld(): GTWG {
    return this.gtwg;
  }

  getLedger(): CanonLedger {
    return this.ledger;
  }
}
