import type { GameState } from '../../engine/types';
import type { Beliefs } from '../ismcts';
import { checkpointFs } from './checkpoint';
import { MAX_SEATS } from './contracts';
import { Net } from './net';
import { deserializeWeights, type WeightsMeta } from './serialize';
import { encodeShared, GLOBAL_INPUT, SEAT_INPUT, seatOrder, SHARED_INPUT } from './seatfeatures';

/**
 * Turns a trained hidden-hand model into the weights `determinize` deals by.
 *
 * The model reads one seat's visible block plus the table block and returns a
 * distribution over the thirteen ranks: how likely that seat is to be holding
 * each one. Measured on held-out data it beats the uniform-over-unseen prior
 * the search uses today by 22.5% of cross-entropy, which is the whole premise.
 *
 * The viewer's OWN face-down cards are left uniform. Nothing about their own
 * play tells them what is under their own cards - the information a model could
 * exploit is what OTHER players' choices reveal.
 */
export function createBeliefProvider(
  net: Net,
  temperature = 1,
): (s: GameState, viewer: number) => Beliefs {
  const input = new Float32Array(SEAT_INPUT + GLOBAL_INPUT);
  const shared = new Float32Array(SHARED_INPUT);

  return (s: GameState, viewer: number): Beliefs => {
    encodeShared(s, viewer, shared, false);
    const order = seatOrder(viewer, s.players.length);
    const beliefs: (number[] | undefined)[] = new Array(s.players.length).fill(undefined);

    for (let offset = 0; offset < MAX_SEATS; offset++) {
      const seat = order[offset];
      if (seat < 0 || seat === viewer) continue;
      input.set(shared.subarray(offset * SEAT_INPUT, (offset + 1) * SEAT_INPUT), 0);
      input.set(shared.subarray(MAX_SEATS * SEAT_INPUT), SEAT_INPUT);
      const p = net.forward(input).policy;
      // Indexed by rank, so index 0 is unused and rank r reads at r.
      // Tempered: w^t interpolates between a flat prior at t=0 and the model's
      // full confidence at t=1. The model beats uniform by 22.5% of
      // cross-entropy, which is real but not a lot, and a belief held more
      // confidently than it deserves is worse than no belief - the search stops
      // hedging over worlds it should still be hedging over.
      const weight = new Array<number>(14).fill(0);
      for (let r = 1; r <= 13; r++) {
        weight[r] = temperature === 1 ? p[r - 1] : Math.pow(Math.max(1e-9, p[r - 1]), temperature);
      }
      beliefs[seat] = weight;
    }
    return beliefs;
  };
}

export async function loadBeliefProvider(
  path = 'training/inference/hidden-hand.bin',
  temperature = 1,
): Promise<(s: GameState, viewer: number) => Beliefs> {
  const fs = await checkpointFs();
  const meta = JSON.parse(
    new TextDecoder().decode(fs.readFileSync(path.replace(/\.bin$/, '.meta.json'))),
  ) as WeightsMeta;
  return createBeliefProvider(deserializeWeights(fs.readFileSync(path), meta), temperature);
}
