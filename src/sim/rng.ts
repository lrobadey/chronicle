export interface RNGState {
  seed: string;
  counter: number;
}

export function seededRandom(state: RNGState): number {
  const str = `${state.seed}:${state.counter}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  state.counter += 1;
  const n = Math.abs(hash) % 2147483647;
  return n / 2147483647;
}
