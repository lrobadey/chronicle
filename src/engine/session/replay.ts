import type { WorldState } from '../../sim/state';
import type { WorldEvent } from '../../sim/events';
import { applyEvents } from '../../sim/reducer';

export function replayFromLog(base: WorldState | null, lines: string[]): WorldState {
  if (!base) throw new Error('Missing base state for replay');
  let state = base;
  for (const line of lines) {
    const record = JSON.parse(line) as { acceptedEvents?: WorldEvent[]; turn?: number };
    if (record.turn != null) {
      state.meta.turn = record.turn;
    }
    if (record.acceptedEvents?.length) {
      state = applyEvents(state, record.acceptedEvents);
    }
  }
  return state;
}
