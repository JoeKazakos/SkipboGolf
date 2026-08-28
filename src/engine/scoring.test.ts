import { describe, expect, it } from 'vitest';
import { INVALID_HAND_SCORE, scoreGrid } from './scoring';
import type { Rank } from './cards';

const g = (...ranks: number[]) => ranks as Rank[];

describe('scoreGrid - worked examples from game-description.md section 12', () => {
  it('example 1: pairs cancel and two squares score -10 each', () => {
    // Row 1: 5 5 7 8 8
    // Row 2: 5 5 4 8 8
    expect(scoreGrid(g(5, 5, 7, 8, 8, 5, 5, 4, 8, 8))).toBe(-16);
  });

  it('example 2: overlapping squares are counted left to right without reusing a column', () => {
    // Row 1: 9 9 9 2 2
    // Row 2: 9 9 9 2 2
    expect(scoreGrid(g(9, 9, 9, 2, 2, 9, 9, 9, 2, 2))).toBe(-20);
  });

  it('example 3: a malformed hand scores 9999', () => {
    expect(scoreGrid([5, 5, 7, 8, 8, 5, 5, 4, 8, null])).toBe(INVALID_HAND_SCORE);
    expect(scoreGrid(g(5, 5, 7, 8, 8, 5, 5, 4, 8))).toBe(INVALID_HAND_SCORE);
  });
});

describe('scoreGrid - column rules', () => {
  // These fixtures deliberately vary rank between adjacent columns so that no
  // incidental 2x2 square forms; square behaviour is covered separately below.

  it('counts 7, 11 and 13 as zero', () => {
    expect(scoreGrid(g(7, 11, 13, 1, 2, 7, 11, 13, 1, 2))).toBe(0);
  });

  it('does not cancel a matching pair of special rank, but both count as zero anyway', () => {
    expect(scoreGrid(g(7, 1, 2, 3, 4, 7, 1, 2, 3, 4))).toBe(0);
  });

  it('adds both values when a column does not match', () => {
    // Column 1 is 2 and 3, everything else cancels.
    expect(scoreGrid(g(2, 1, 2, 3, 4, 3, 1, 2, 3, 4))).toBe(5);
  });

  it('mixes a special with a plain card correctly', () => {
    // Column 1 is 7 and 4: the 7 counts 0, so the column scores 4.
    expect(scoreGrid(g(7, 1, 2, 3, 4, 4, 1, 2, 3, 4))).toBe(4);
  });
});

describe('scoreGrid - square rules', () => {
  it('awards a square of special ranks', () => {
    // A 2x2 of 7s scores 0 for the columns and -10 for the square.
    expect(scoreGrid(g(7, 7, 1, 2, 3, 7, 7, 1, 2, 3))).toBe(-10);
  });

  it('does not award a square when the four ranks differ', () => {
    expect(scoreGrid(g(5, 5, 1, 2, 3, 5, 6, 1, 2, 3))).toBe(11);
  });

  it('counts at most two squares across five columns', () => {
    // All ten cards are 4s: columns 1-2 and 3-4 form squares, column 5 is left over.
    expect(scoreGrid(g(4, 4, 4, 4, 4, 4, 4, 4, 4, 4))).toBe(-20);
  });
});
