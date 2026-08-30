import { ROSTER, profileById } from '../ai/roster';

/**
 * Rating the human against the AI roster.
 *
 * The opponents already carry ratings measured by self-play, so the player is
 * fitted against those as FIXED anchors rather than everyone being refitted
 * together. That is far more stable: one player's handful of games cannot drag
 * the whole ladder around, and the anchors were measured over hundreds of
 * games rather than a dozen.
 */

/** One finished round, as it matters for rating. */
export interface PlayedGame {
  /** ISO timestamp. */
  at: string;
  /** Roster profile ids of the opponents, in seat order after the human. */
  seats: string[];
  /** Final scores, index 0 being the human. Lower is better. */
  scores: number[];
}

export interface RatingResult {
  /** Fitted rating, or null when there is nothing to fit. */
  rating: number | null;
  /** Standard error, in Elo. Large early on, and honestly reported. */
  error: number | null;
  /** Head-to-head comparisons the fit is based on. */
  comparisons: number;
  games: number;
  /** Below this many games the number is not worth quoting on its own. */
  provisional: boolean;
}

/** Games below which a rating is shown as a band rather than a number. */
export const PROVISIONAL_GAMES = 20;

const SCALE = 400 / Math.LN10; // ~173.7, converts a log-odds slope to Elo

/** Expected score for a player rated `r` against one rated `opponent`. */
function expected(r: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - r) / 400));
}

/**
 * Every pairwise result between the human and a rated opponent.
 *
 * A six-player round yields five comparisons, not one, which is why a useful
 * rating needs far fewer rounds here than in a two-player game.
 */
function comparisons(games: readonly PlayedGame[]): { anchor: number; outcome: number }[] {
  const out: { anchor: number; outcome: number }[] = [];
  for (const game of games) {
    const mine = game.scores[0];
    if (typeof mine !== 'number') continue;
    for (let i = 0; i < game.seats.length; i++) {
      const seat = game.seats[i];
      let anchor: number | null = null;
      try {
        anchor = profileById(seat).elo;
      } catch {
        anchor = null; // an opponent that no longer exists cannot anchor anything
      }
      if (anchor == null) continue;
      const theirs = game.scores[i + 1];
      if (typeof theirs !== 'number') continue;
      // Lower score wins.
      const outcome = mine < theirs ? 1 : mine > theirs ? 0 : 0.5;
      out.push({ anchor, outcome });
    }
  }
  return out;
}

/**
 * Fits a rating by maximum likelihood over the pairwise results.
 *
 * Solved by bisection on the score gradient, which is monotonic in the rating,
 * so this converges without tuning a step size.
 */
export function fitRating(games: readonly PlayedGame[]): RatingResult {
  const pairs = comparisons(games);
  if (pairs.length === 0) {
    return { rating: null, error: null, comparisons: 0, games: games.length, provisional: true };
  }

  const wins = pairs.reduce((n, p) => n + p.outcome, 0);
  const anchors = pairs.map((p) => p.anchor);
  const lo = Math.min(...anchors) - 1200;
  const hi = Math.max(...anchors) + 1200;

  // Beating everyone, or losing to everyone, has no finite maximum; peg it to
  // the edge of the searched range rather than reporting an infinity.
  const gradient = (r: number) => wins - pairs.reduce((s, p) => s + expected(r, p.anchor), 0);

  let a = lo;
  let b = hi;
  if (gradient(a) < 0) return summarise(a, pairs, games.length);
  if (gradient(b) > 0) return summarise(b, pairs, games.length);
  for (let i = 0; i < 80; i++) {
    const mid = (a + b) / 2;
    if (gradient(mid) > 0) a = mid;
    else b = mid;
  }
  return summarise((a + b) / 2, pairs, games.length);
}

function summarise(
  rating: number,
  pairs: { anchor: number; outcome: number }[],
  games: number,
): RatingResult {
  // Fisher information for the logistic model: sum of p(1-p), scaled to Elo.
  let information = 0;
  for (const p of pairs) {
    const e = expected(rating, p.anchor);
    information += e * (1 - e);
  }
  const error = information > 0 ? SCALE / Math.sqrt(information) : null;
  return {
    rating: Math.round(rating),
    error: error == null ? null : Math.round(error),
    comparisons: pairs.length,
    games,
    provisional: games < PROVISIONAL_GAMES,
  };
}

/**
 * The roster tier a rating sits in, which is what to show while a rating is
 * still provisional: "about as strong as Nel" says more than a noisy number.
 */
export function nearestTier(rating: number): string {
  let best = ROSTER[0];
  let bestGap = Infinity;
  for (const p of ROSTER) {
    if (p.elo == null) continue;
    const gap = Math.abs(p.elo - rating);
    if (gap < bestGap) {
      bestGap = gap;
      best = p;
    }
  }
  return best.name;
}

/** The rating after each game, for a progress chart. */
export function ratingHistory(games: readonly PlayedGame[]): RatingResult[] {
  return games.map((_, i) => fitRating(games.slice(0, i + 1)));
}
