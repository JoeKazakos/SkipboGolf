import { applyAction, createInitialState, isTerminal, returns } from '../engine/state';
import { gridView, expectedScore, DEFAULT_HIDDEN_EV, DEFAULT_P_MATCH } from './heuristic';
import type { Rank } from '../engine/cards';
import type { Agent } from './agent';

/**
 * Fitting the evaluation to real outcomes instead of guessing it.
 *
 * `expectedScore` claims to predict a player's final score from a partial
 * grid, which makes it a regression with a well-defined target: play games,
 * record each player's grid as they saw it, and pair that with the score they
 * actually finished on.
 *
 * Only two values are free. Complete squares and fully-known columns are
 * exact arithmetic; everything uncertain flows through HIDDEN_EV (what an
 * unseen card is worth) and P_MATCH (how often an unseen card cancels a known
 * one). Those are the two numbers this fits.
 */

export interface Sample {
  /** The player's grid as they could see it: null where a card was face down. */
  view: (Rank | null)[];
  /** The score that player actually finished the round on. */
  finalScore: number;
}

/**
 * Plays self-play games, sampling every player's grid at the start of each
 * turn and pairing it with their eventual score.
 *
 * Sampling all players rather than only the mover keeps the data from being
 * biased toward positions that happen to be somebody's turn.
 */
export async function collectSamples(
  agent: Agent,
  options: { games: number; seed?: number; numPlayers?: number } = { games: 50 },
): Promise<Sample[]> {
  const samples: Sample[] = [];
  const baseSeed = options.seed ?? 1;

  for (let g = 0; g < options.games; g++) {
    let s = createInitialState(baseSeed + g * 104729, options.numPlayers ?? 6);
    const perPlayer: (Rank | null)[][][] = s.players.map(() => []);
    let guard = 0;

    while (!isTerminal(s)) {
      if (guard++ > 20000) throw new Error('game failed to terminate');
      if (s.phase === 'draw') {
        for (let p = 0; p < s.players.length; p++) {
          perPlayer[p].push(gridView(s.players[p].grid));
        }
      }
      const action = await agent.chooseAction(s, s.current);
      s = applyAction(s, action);
    }

    const finals = returns(s);
    for (let p = 0; p < perPlayer.length; p++) {
      for (const view of perPlayer[p]) samples.push({ view, finalScore: finals[p] });
    }
  }
  return samples;
}

/** Mean squared error of the evaluation against the outcomes, for given parameters. */
export function meanSquaredError(
  samples: readonly Sample[],
  hiddenEv: number,
  pMatch: number,
): number {
  if (samples.length === 0) return 0;
  let total = 0;
  for (const s of samples) {
    const predicted = expectedScore(s.view, hiddenEv, pMatch);
    const error = predicted - s.finalScore;
    total += error * error;
  }
  return total / samples.length;
}

export interface FitResult {
  hiddenEv: number;
  pMatch: number;
  mse: number;
  baselineMse: number;
  /** Percentage reduction in mean squared error against the hand-set values. */
  improvement: number;
  samples: number;
}

/**
 * Coarse-to-fine grid search over the two parameters.
 *
 * A grid rather than a gradient step: there are only two dimensions, the
 * surface is smooth, and a search cannot diverge or need a learning rate.
 */
export function fitParameters(
  samples: readonly Sample[],
  options: { rounds?: number; steps?: number } = {},
): FitResult {
  const rounds = options.rounds ?? 4;
  const steps = options.steps ?? 12;

  // Wide enough that the optimum cannot sit on a boundary; the first fit put
  // P_MATCH just outside a narrower range, which is exactly how a search gets
  // silently truncated.
  let loEv = 0;
  let hiEv = 14;
  let loP = 0;
  let hiP = 0.95;

  let best = { hiddenEv: DEFAULT_HIDDEN_EV, pMatch: DEFAULT_P_MATCH, mse: Infinity };

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i <= steps; i++) {
      const ev = loEv + ((hiEv - loEv) * i) / steps;
      for (let j = 0; j <= steps; j++) {
        const pm = loP + ((hiP - loP) * j) / steps;
        const mse = meanSquaredError(samples, ev, pm);
        if (mse < best.mse) best = { hiddenEv: ev, pMatch: pm, mse };
      }
    }
    // Narrow the window around the best point for the next pass.
    const evSpan = (hiEv - loEv) / steps;
    const pSpan = (hiP - loP) / steps;
    loEv = Math.max(0, best.hiddenEv - evSpan);
    hiEv = best.hiddenEv + evSpan;
    loP = Math.max(0, best.pMatch - pSpan);
    hiP = Math.min(1, best.pMatch + pSpan);
  }

  const baselineMse = meanSquaredError(samples, DEFAULT_HIDDEN_EV, DEFAULT_P_MATCH);
  return {
    hiddenEv: best.hiddenEv,
    pMatch: best.pMatch,
    mse: best.mse,
    baselineMse,
    improvement: baselineMse > 0 ? (1 - best.mse / baselineMse) * 100 : 0,
    samples: samples.length,
  };
}
