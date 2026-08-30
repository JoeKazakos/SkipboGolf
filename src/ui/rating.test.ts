import { describe, expect, it } from 'vitest';
import { fitRating, nearestTier, ratingHistory, type PlayedGame } from './rating';
import { profileById } from '../ai/roster';

const at = '2026-08-30T00:00:00.000Z';

/** A round against the given opponents, with the human placing as told. */
function game(seats: string[], humanScore: number, theirScores: number[]): PlayedGame {
  return { at, seats, scores: [humanScore, ...theirScores] };
}

describe('fitRating', () => {
  it('has nothing to say with no games', () => {
    const r = fitRating([]);
    expect(r.rating).toBeNull();
    expect(r.comparisons).toBe(0);
  });

  it('counts one comparison per opponent, not one per game', () => {
    const r = fitRating([game(['pip', 'nel', 'ada'], 5, [10, 20, 30])]);
    expect(r.games).toBe(1);
    expect(r.comparisons).toBe(3);
  });

  it('rates a player who beats a strong field above that field', () => {
    const sage = profileById('sage').elo!;
    const games = Array.from({ length: 10 }, () =>
      game(['sage', 'rook', 'ada'], -5, [10, 12, 14]),
    );
    const r = fitRating(games);
    expect(r.rating).toBeGreaterThan(sage);
  });

  it('rates a player who loses to a weak field below it', () => {
    const pip = profileById('pip').elo!;
    const games = Array.from({ length: 10 }, () => game(['pip', 'pip', 'pip'], 90, [10, 12, 14]));
    const r = fitRating(games);
    expect(r.rating).toBeLessThan(pip);
  });

  it('puts an even record against one opponent near that opponent', () => {
    const nel = profileById('nel').elo!;
    const games: PlayedGame[] = [];
    for (let i = 0; i < 20; i++) {
      games.push(i % 2 === 0 ? game(['nel'], 5, [10]) : game(['nel'], 10, [5]));
    }
    const r = fitRating(games);
    expect(Math.abs(r.rating! - nel)).toBeLessThan(60);
  });

  it('reports a large error early and a smaller one later', () => {
    const few = fitRating([game(['nel', 'ada'], 5, [10, 20])]);
    const many = fitRating(
      Array.from({ length: 60 }, (_, i) =>
        i % 2 === 0 ? game(['nel', 'ada'], 5, [10, 20]) : game(['nel', 'ada'], 30, [10, 20]),
      ),
    );
    expect(few.error).toBeGreaterThan(many.error!);
  });

  it('is provisional until enough games are played', () => {
    expect(fitRating([game(['nel'], 1, [2])]).provisional).toBe(true);
    const many = Array.from({ length: 25 }, (_, i) =>
      i % 2 === 0 ? game(['nel'], 1, [2]) : game(['nel'], 3, [2]),
    );
    expect(fitRating(many).provisional).toBe(false);
  });

  it('ignores an opponent that carries no rating', () => {
    const r = fitRating([{ at, seats: ['nobody-at-all'], scores: [1, 2] }]);
    expect(r.comparisons).toBe(0);
    expect(r.rating).toBeNull();
  });

  it('does not run away to infinity on a perfect record', () => {
    const games = Array.from({ length: 30 }, () => game(['pip'], -20, [50]));
    const r = fitRating(games);
    expect(Number.isFinite(r.rating!)).toBe(true);
  });

  it('treats a tie as half a win', () => {
    const tied = fitRating(Array.from({ length: 20 }, () => game(['nel'], 7, [7])));
    const nel = profileById('nel').elo!;
    expect(Math.abs(tied.rating! - nel)).toBeLessThan(60);
  });
});

describe('nearestTier', () => {
  it('names the closest opponent by rating', () => {
    expect(nearestTier(profileById('pip').elo!)).toBe('Pip');
    expect(nearestTier(profileById('sage').elo! + 500)).toBe('Sage');
    expect(nearestTier(profileById('nel').elo!)).toBe('Nel');
  });
});

describe('ratingHistory', () => {
  it('gives one point per game played', () => {
    const games = Array.from({ length: 5 }, () => game(['nel'], 5, [9]));
    const h = ratingHistory(games);
    expect(h).toHaveLength(5);
    expect(h[0].games).toBe(1);
    expect(h[4].games).toBe(5);
  });
});
