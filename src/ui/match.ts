/**
 * A match: several rounds of Skip-Bo Golf with a cumulative scorecard.
 *
 * Section 13 of the rules says a full game is one round, and the engine keeps
 * to that. A match is bookkeeping laid on top - it deals a fresh round and adds
 * up `returns()` - so nothing here belongs in the engine. See section 15.13.
 */

export interface MatchState {
  /** Rounds in the whole match. 1 is the game exactly as the rules describe. */
  readonly rounds: number;
  /** How many rounds have been completed. */
  readonly played: number;
  /** Cumulative score per player, lower being better. */
  readonly totals: readonly number[];
  /** Each round's scores, so a scorecard can show the shape of the match. */
  readonly history: readonly (readonly number[])[];
}

/** Round counts offered in setup. Nine and eighteen mirror a round of golf. */
export const ROUND_OPTIONS = [1, 3, 9, 18] as const;
export const DEFAULT_ROUNDS = 1;

export function newMatch(rounds: number, numPlayers: number): MatchState {
  if (rounds < 1) throw new Error('a match needs at least one round');
  return {
    rounds,
    played: 0,
    totals: new Array<number>(numPlayers).fill(0),
    history: [],
  };
}

/** Adds one round's scores. Returns a new state; never mutates. */
export function recordRound(m: MatchState, scores: readonly number[]): MatchState {
  if (scores.length !== m.totals.length) {
    throw new Error(
      `round has ${scores.length} scores but the match has ${m.totals.length} players`,
    );
  }
  return {
    ...m,
    played: m.played + 1,
    totals: m.totals.map((t, i) => t + scores[i]),
    history: [...m.history, [...scores]],
  };
}

export function isMatchOver(m: MatchState): boolean {
  return m.played >= m.rounds;
}

/** Everyone tied on the lowest total. The rules set no tie-break (section 12). */
export function matchWinners(m: MatchState): number[] {
  if (m.totals.length === 0) return [];
  const best = Math.min(...m.totals);
  return m.totals.map((t, i) => (t === best ? i : -1)).filter((i) => i >= 0);
}

/** "Round 2 of 9", or null for a single-round game where it would be noise. */
export function roundLabel(m: MatchState): string | null {
  if (m.rounds === 1) return null;
  return `Round ${Math.min(m.played + 1, m.rounds)} of ${m.rounds}`;
}
