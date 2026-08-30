/**
 * One shard of a parallel arena run.
 *
 * Plays a subset of game INDICES and prints them as JSON. Because
 * playIndexedGame derives both the seed and the seating from the index alone,
 * a shard reproduces exactly the games a serial run would have played at those
 * indices - so sharding changes the wall clock and nothing else.
 *
 * Driven by scripts/arena-parallel.mjs; not meant to be run by hand.
 */
import { NUM_PLAYERS, playIndexedGame } from './arena-exports';

declare const process:
  | {
      argv?: string[];
      env?: Record<string, string | undefined>;
      stdout?: { write: (s: string) => void };
      exit?: (code: number) => void;
    }
  | undefined;

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const from = Number(env.SHARD_FROM ?? 0);
  const to = Number(env.SHARD_TO ?? 0); // exclusive
  const baseSeed = Number(env.ARENA_SEED ?? 20260828);
  const budgetMs = env.ARENA_BUDGET_MS ? Number(env.ARENA_BUDGET_MS) : undefined;
  const useRoster = env.ARENA_ROSTER === '1';

  const { rosterLadder, defaultLadder } = await import('./arena-exports');
  const ladder = useRoster ? rosterLadder() : defaultLadder(budgetMs ?? 250);

  const out: unknown[] = [];
  for (let g = from; g < to; g++) {
    out.push(
      await playIndexedGame(ladder, g, {
        seed: baseSeed,
        seatCount: NUM_PLAYERS,
        budgetMs: useRoster ? undefined : budgetMs,
      }),
    );
  }
  const line = `__SHARD_RESULT__${JSON.stringify(out)}`;
  if (typeof process !== 'undefined' && process?.stdout) process.stdout.write(line + '\n');
  else console.log(line);
}

void main();
