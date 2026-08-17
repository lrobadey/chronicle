/**
 * Chronicle v4 - History Manager
 * 
 * Manages state history and undo/redo functionality using immutable snapshots.
 * (Optimized for simplicity: storing full world snapshots for now, diffs usually premature optimization for text adventures)
 */

import type { World } from './world';

export class HistoryManager {
  private history: World[] = [];
  private future: World[] = [];
  private readonly maxHistory = 50;

  constructor(initialWorld: World) {
    this.history.push(JSON.parse(JSON.stringify(initialWorld)));
  }

  /**
   * Push a new state onto the history stack.
   * Clears any 'redo' future.
   */
  push(world: World): void {
    // Deep copy to ensure immutability of history
    this.history.push(JSON.parse(JSON.stringify(world)));
    
    // Limit history size
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    
    // Clear future on new branch
    this.future = [];
  }

  /**
   * Undo to the previous state.
   * Returns null if no history available.
   */
  undo(): World | null {
    if (this.history.length <= 1) return null;

    const current = this.history.pop()!;
    this.future.push(current);

    // Return the new 'current' (now top of stack)
    return JSON.parse(JSON.stringify(this.history[this.history.length - 1]));
  }

  /**
   * Redo to the next state in the future stack.
   * Returns null if no future available.
   */
  redo(): World | null {
    if (this.future.length === 0) return null;

    const next = this.future.pop()!;
    this.history.push(next);

    return JSON.parse(JSON.stringify(next));
  }

  get current(): World {
    return JSON.parse(JSON.stringify(this.history[this.history.length - 1]));
  }

  get canUndo(): boolean {
    return this.history.length > 1;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
