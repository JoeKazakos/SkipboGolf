/**
 * One shard of a parallel self-play run.
 *
 * Plays the games belonging to a shard and writes them to
 * `training/genNNN/shards/shard-NN.bin`. Because every game's seed and table
 * size derive from its index alone, and the search is stopped by a fixed
 * iteration count rather than a clock, a shard reproduces exactly the games a
 * serial run would have played - so sharding changes the wall clock and
 * nothing else.
 *
 * A shard already on disk is read back rather than replayed, which is what
 * makes an interrupted generation resumable.
 *
 * Driven by scripts/selfplay-parallel.mjs; not meant to be run by hand.
 */
import { DEFAULT_SELFPLAY, runShard, type SelfPlayConfig } from './selfplay';

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
  const config: SelfPlayConfig = {
    generation: Number(env.SP_GENERATION ?? DEFAULT_SELFPLAY.generation),
    games: Number(env.SP_GAMES ?? DEFAULT_SELFPLAY.games),
    iterations: Number(env.SP_ITERATIONS ?? DEFAULT_SELFPLAY.iterations),
    playerCounts: env.SP_PLAYERS
      ? env.SP_PLAYERS.split(',').map(Number)
      : DEFAULT_SELFPLAY.playerCounts,
    seed: Number(env.SP_SEED ?? DEFAULT_SELFPLAY.seed),
    // Generation 1 onward plays with the previous generation's network.
    ...(env.SP_WEIGHTS ? { weightsPath: env.SP_WEIGHTS } : {}),
    ...(env.SP_SCALE ? { valueScale: Number(env.SP_SCALE) } : {}),
    ...(env.SP_CENTER ? { valueCenter: Number(env.SP_CENTER) } : {}),
  };
  const shard = Number(env.SP_SHARD ?? 0);
  const shards = Number(env.SP_SHARDS ?? 1);
  const root = env.SP_ROOT ?? 'training';

  const started = Date.now();
  const result = await runShard(config, shard, shards, root, (done, of) => {
    // Progress on stderr so stdout stays a single parseable JSON line.
    if (done % 4 === 0 || done === of) {
      // eslint-disable-next-line no-console
      console.error(`  shard ${shard}: ${done}/${of} games`);
    }
  });

  const line = JSON.stringify({
    shard,
    samples: result.samples,
    skipped: result.skipped,
    seconds: (Date.now() - started) / 1000,
  });
  // The same marker convention arena-shard uses: the driver reads everything
  // after it, so incidental stdout from a dependency cannot corrupt the result.
  const marked = `__SHARD_RESULT__${line}`;
  if (typeof process !== 'undefined' && process?.stdout) process.stdout.write(`${marked}\n`);
  else console.log(marked);
}

void main();
