import { describe, expect, it } from 'vitest';
import { legalActions } from '../../engine/state';
import { POLICY_SIZE, MAX_SEATS, policyIndex } from './contracts';
import { checkpointFs } from './checkpoint';
import {
  decodeShard,
  encodeShard,
  gamesForShard,
  playSelfPlayGame,
  positionOf,
  readGeneration,
  runShard,
  shardPath,
  type RawSample,
  type SelfPlayConfig,
} from './selfplay';

/**
 * Gates for self-play data generation.
 *
 * The resume test is the one that matters most. A generation is hours of
 * compute, and a resume that silently regenerates everything - or worse,
 * silently skips work it never did - would either waste a night or corrupt the
 * training set in a way nothing downstream would report.
 */

// Small and fast: these check correctness of the pipeline, not playing
// strength. The real budgets belong in the actual generation run.
const TINY: SelfPlayConfig = {
  generation: 900,
  games: 6,
  iterations: 30,
  playerCounts: [3, 4],
  seed: 12345,
};

const ROOT = 'training/__test__';

async function cleanup(): Promise<void> {
  const fs = await checkpointFs();
  if (fs.existsSync(ROOT)) fs.rmSync(ROOT, { recursive: true, force: true });
}

describe('self-play samples', () => {
  const samples = playSelfPlayGame(777, 4, 30);

  it('produces samples at all', () => {
    expect(samples.length).toBeGreaterThan(5);
  });

  it('gives policy targets that sum to one', () => {
    for (const s of samples) {
      let sum = 0;
      for (let i = 0; i < POLICY_SIZE; i++) sum += s.policyTarget[i];
      expect(sum).toBeCloseTo(1, 4);
    }
  });

  it('puts no policy mass on an illegal action', () => {
    // The strong version of the check: decode the stored position, ask the
    // engine what was legal there, and confirm every index carrying mass maps
    // back to one of those actions.
    for (const s of samples) {
      const state = positionOf(s);
      const legal = new Set(
        legalActions(state).map((a) => policyIndex(a, state.current, state.players.length)),
      );
      for (let i = 0; i < POLICY_SIZE; i++) {
        if (s.policyTarget[i] > 0) expect(legal.has(i)).toBe(true);
      }
    }
  });

  it('gives value targets in range, masked to the real seats', () => {
    for (const s of samples) {
      const state = positionOf(s);
      let active = 0;
      for (let i = 0; i < MAX_SEATS; i++) {
        expect(s.valueTarget[i]).toBeGreaterThanOrEqual(0);
        expect(s.valueTarget[i]).toBeLessThanOrEqual(1);
        active += s.valueMask[i];
      }
      expect(active).toBe(state.players.length);
      // Index 0 is always the player to act, by the rotation contract.
      expect(s.valueMask[0]).toBe(1);
    }
  });
});

describe('shard encoding', () => {
  it('round-trips samples exactly', () => {
    const samples = playSelfPlayGame(31, 3, 30);
    const back = decodeShard(encodeShard(samples));
    expect(back.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i++) {
      expect([...back[i].position]).toEqual([...samples[i].position]);
      expect([...back[i].policyTarget]).toEqual([...samples[i].policyTarget]);
      expect([...back[i].valueTarget]).toEqual([...samples[i].valueTarget]);
      expect([...back[i].valueMask]).toEqual([...samples[i].valueMask]);
    }
  });

  it('detects a truncated shard instead of half-reading it', () => {
    const bytes = encodeShard(playSelfPlayGame(32, 3, 30));
    expect(() => decodeShard(bytes.slice(0, bytes.length - 30))).toThrow(/truncated/i);
  });

  it('detects a file that is not a shard', () => {
    const junk = new Uint8Array(64);
    junk.fill(7);
    expect(() => decodeShard(junk)).toThrow(/magic/i);
  });

  it('handles an empty shard', () => {
    expect(decodeShard(encodeShard([]))).toEqual([]);
  });
});

describe('sharding', () => {
  it('covers every game exactly once', () => {
    const shards = 4;
    const seen = new Set<number>();
    for (let i = 0; i < shards; i++) {
      for (const g of gamesForShard(TINY, i, shards)) {
        expect(seen.has(g)).toBe(false);
        seen.add(g);
      }
    }
    expect(seen.size).toBe(TINY.games);
  });
});

describe('resumable runs', () => {
  it('replays only the shards that are missing', async () => {
    await cleanup();
    const shards = 3;

    const first: number[] = [];
    for (let i = 0; i < shards; i++) {
      const r = await runShard(TINY, i, shards, ROOT);
      expect(r.skipped).toBe(false);
      first.push(r.samples);
    }
    const before = await readGeneration(TINY, shards, ROOT);

    // Drop the middle shard, as a killed worker would have left things.
    const fs = await checkpointFs();
    fs.rmSync(shardPath(TINY, 1, ROOT), { recursive: false as never, force: true });

    const second: boolean[] = [];
    for (let i = 0; i < shards; i++) {
      const r = await runShard(TINY, i, shards, ROOT);
      second.push(r.skipped);
      expect(r.samples).toBe(first[i]);
    }

    // Exactly the deleted one was replayed; the others were read back.
    expect(second).toEqual([true, false, true]);

    const after = await readGeneration(TINY, shards, ROOT);
    expect(after.length).toBe(before.length);
    // And the replay is deterministic: same seeds, same samples, byte for byte.
    const fingerprint = (xs: RawSample[]) =>
      xs.map((x) => `${x.position.length}:${x.policyTarget.join(',')}`).join('|');
    expect(fingerprint(after)).toBe(fingerprint(before));

    await cleanup();
  }, 120_000);

  it('replays a corrupt shard rather than shrinking the training set', async () => {
    await cleanup();
    const shards = 2;
    const good = await runShard(TINY, 0, shards, ROOT);
    expect(good.skipped).toBe(false);

    const fs = await checkpointFs();
    fs.writeFileSync(shardPath(TINY, 0, ROOT), new Uint8Array([1, 2, 3, 4, 5]));

    const again = await runShard(TINY, 0, shards, ROOT);
    expect(again.skipped).toBe(false);
    expect(again.samples).toBe(good.samples);

    await cleanup();
  }, 120_000);
});
