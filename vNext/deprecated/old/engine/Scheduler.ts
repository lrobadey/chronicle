// Scheduler.ts – Tick manager for Chronicle V2 Kernel
// ====================================================
// The Scheduler decides *when* each registered system should run based
// on its `tickRate`.  This first implementation is intentionally simple:
//  • per_action systems run every player action
//  • hourly systems run when game time crosses an hour boundary
//  • daily systems run when game time crosses a day boundary
// A more sophisticated scheduler (supporting variable rates, pausing,
// cron-like rules) can replace this later without changing the Kernel API.

import { SystemSpec, TickRate, getAllSystems } from './SystemSpec';

export interface TickContext {
  tick: number;       // Global tick counter (increments per action)
  hours: number;      // In-game hours elapsed (derived)
  days: number;       // In-game days elapsed (derived)
}

export function createInitialTickContext(): TickContext {
  return { tick: 0, hours: 0, days: 0 };
}

export class Scheduler {
  private ctx: TickContext;

  constructor(initial?: TickContext) {
    this.ctx = initial ?? createInitialTickContext();
  }

  /**
   * Advance the scheduler by one player action and return systems that
   * should run for this tick.
   */
  public advance(): { ctx: TickContext; due: SystemSpec[] } {
    // Increment tick counter first
    this.ctx = { ...this.ctx, tick: this.ctx.tick + 1 };

    // Derive hours & days (simplified: 1 action = 1 minute of game time)
    const minutesElapsed = this.ctx.tick;
    const hours = Math.floor(minutesElapsed / 60);
    const days = Math.floor(hours / 24);
    const crossedHour = hours > this.ctx.hours;
    const crossedDay = days > this.ctx.days;
    this.ctx = { ...this.ctx, hours, days };

    // Decide which systems are due
    const due: SystemSpec[] = [];
    for (const sys of getAllSystems()) {
      if (sys.tickRate === 'per_action') {
        due.push(sys);
      } else if (sys.tickRate === 'hourly' && crossedHour) {
        due.push(sys);
      } else if (sys.tickRate === 'daily' && crossedDay) {
        due.push(sys);
      }
    }

    return { ctx: this.ctx, due };
  }

  /**
   * Manually set the tick context – useful for tests & replay.
   */
  public setContext(ctx: TickContext) {
    this.ctx = ctx;
  }

  public getContext(): TickContext {
    return this.ctx;
  }
}
