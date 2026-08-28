/**
 * Seeded PRNG (mulberry32). Deterministic so that tests, replays and AI
 * determinizations are all reproducible.
 */
export interface Rng {
  next(): number;
  state: number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    get state() {
      return s;
    },
    set state(v: number) {
      s = v >>> 0;
    },
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Fisher-Yates. Returns a new array; does not mutate the input. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
