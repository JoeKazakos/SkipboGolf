import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUNDS,
  isMatchOver,
  matchWinners,
  newMatch,
  recordRound,
  roundLabel,
} from './match';

describe('match', () => {
  it('starts empty and not over', () => {
    const m = newMatch(3, 4);
    expect(m.totals).toEqual([0, 0, 0, 0]);
    expect(m.played).toBe(0);
    expect(isMatchOver(m)).toBe(false);
  });

  it('accumulates round scores without mutating', () => {
    const m = newMatch(2, 3);
    const after = recordRound(m, [5, -2, 10]);
    expect(after.totals).toEqual([5, -2, 10]);
    expect(m.totals).toEqual([0, 0, 0]); // original untouched
    const after2 = recordRound(after, [1, 1, -20]);
    expect(after2.totals).toEqual([6, -1, -10]);
    expect(after2.history).toEqual([[5, -2, 10], [1, 1, -20]]);
  });

  it('is over once every round is played', () => {
    let m = newMatch(2, 2);
    m = recordRound(m, [1, 2]);
    expect(isMatchOver(m)).toBe(false);
    m = recordRound(m, [1, 2]);
    expect(isMatchOver(m)).toBe(true);
  });

  it('picks the lowest total, and allows a tie', () => {
    let m = newMatch(1, 3);
    m = recordRound(m, [7, 7, 9]);
    expect(matchWinners(m)).toEqual([0, 1]);
  });

  it('rejects a round whose player count does not match', () => {
    const m = newMatch(1, 4);
    expect(() => recordRound(m, [1, 2, 3])).toThrow(/4 players/);
  });

  it('labels rounds only when there is more than one', () => {
    expect(roundLabel(newMatch(1, 2))).toBeNull();
    const m = newMatch(9, 2);
    expect(roundLabel(m)).toBe('Round 1 of 9');
    expect(roundLabel(recordRound(m, [0, 0]))).toBe('Round 2 of 9');
  });

  it('does not label past the last round', () => {
    let m = newMatch(2, 2);
    m = recordRound(m, [0, 0]);
    m = recordRound(m, [0, 0]);
    expect(roundLabel(m)).toBe('Round 2 of 2');
  });

  it('defaults to the single round the rules describe', () => {
    expect(DEFAULT_ROUNDS).toBe(1);
  });
});
