import { describe, expect, it } from 'vitest';
import { scoreBreakdown, scoreGrid } from './scoring';
import type { Rank } from './cards';

const g = (row1: number[], row2: number[]) => [...row1, ...row2] as Rank[];

describe('scoreBreakdown', () => {
  it('shows the working for worked example 1 from section 12', () => {
    // Row 1: 5 5 7 8 8 / Row 2: 5 5 4 8 8  ->  base 4, two squares, -16.
    const b = scoreBreakdown(g([5, 5, 7, 8, 8], [5, 5, 4, 8, 8]));
    expect(b.valid).toBe(true);
    expect(b.columns.map((c) => c.points)).toEqual([0, 0, 4, 0, 0]);
    expect(b.columns[0].cancelled).toBe(true);
    expect(b.columns[2].cancelled).toBe(false);
    expect(b.columns[2].topIsZero).toBe(true); // the 7
    expect(b.columns[2].bottomIsZero).toBe(false); // the 4
    expect(b.base).toBe(4);
    expect(b.squares.map((s) => s.leftCol)).toEqual([0, 3]);
    expect(b.squareBonus).toBe(-20);
    expect(b.total).toBe(-16);
  });

  it('shows the overlap rule for worked example 2', () => {
    // Three columns of 9s: only the leftmost square counts, then the 2s.
    const b = scoreBreakdown(g([9, 9, 9, 2, 2], [9, 9, 9, 2, 2]));
    expect(b.base).toBe(0);
    expect(b.squares.map((s) => s.leftCol)).toEqual([0, 3]);
    expect(b.total).toBe(-20);
  });

  it('reports an invalid hand without inventing columns', () => {
    const b = scoreBreakdown([1, 2, 3] as Rank[]);
    expect(b.valid).toBe(false);
    expect(b.columns).toEqual([]);
    expect(b.total).toBe(9999);
  });

  it('counts a square of special ranks, which still score zero per column', () => {
    const b = scoreBreakdown(g([7, 7, 1, 2, 3], [7, 7, 1, 2, 3]));
    expect(b.columns[0].points).toBe(0);
    expect(b.squares.map((s) => s.rank)).toEqual([7]);
    expect(b.total).toBe(-10);
  });

  it('always agrees with scoreGrid', () => {
    // Random hands: the explanation must never contradict the score awarded.
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 13) + 1;
    for (let i = 0; i < 400; i++) {
      const grid = Array.from({ length: 10 }, rnd) as Rank[];
      const b = scoreBreakdown(grid);
      expect(b.base + b.squareBonus).toBe(b.total);
      expect(scoreGrid(grid)).toBe(b.total);
    }
  });
});
