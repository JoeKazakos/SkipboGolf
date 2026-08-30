import type { GameState } from '../engine/types';
import { DECK_SIZE, GRID_SIZE } from '../engine/cards';
import type { MatchState } from './match';

/**
 * Saving the game in progress, so a refresh, a back gesture or a phone
 * reclaiming the tab does not lose the round.
 *
 * GameState is plain data - cards are `{ rank, id }` and rngState is a number -
 * so it serialises as-is with no custom encoder.
 */

const STORAGE_KEY = 'skipbo-golf.game.v1';

/**
 * Bumped whenever the saved shape changes. A blob from an older version is
 * discarded rather than restored: the shape has already changed twice in this
 * project (seat names became data, and held cards gained a publicity flag),
 * and half-restoring into new code is worse than dealing a fresh round.
 */
const SAVE_VERSION = 1;

export interface SavedGame {
  version: number;
  /** Roster profile ids, one per opponent seat. */
  seats: string[];
  seed: number;
  game: GameState;
  match: MatchState;
  savedAt: number;
}

/**
 * A structural check, not a full validation.
 *
 * The aim is to reject anything that would crash the app or produce an
 * illegal position, while staying cheap. The engine's own invariants are the
 * real guarantee; this only has to keep obvious rubbish out.
 */
export function isRestorable(value: unknown): value is SavedGame {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SavedGame>;
  if (v.version !== SAVE_VERSION) return false;
  if (!Array.isArray(v.seats) || v.seats.some((s) => typeof s !== 'string')) return false;
  if (typeof v.seed !== 'number') return false;

  const g = v.game as GameState | undefined;
  if (typeof g !== 'object' || g === null) return false;
  if (!Array.isArray(g.players) || g.players.length < 2) return false;
  // One seat per opponent, plus the human.
  if (g.players.length !== v.seats.length + 1) return false;
  for (const p of g.players) {
    if (!Array.isArray(p.grid) || p.grid.length !== GRID_SIZE) return false;
    if (!Array.isArray(p.discard)) return false;
    for (const slot of p.grid) {
      if (typeof slot?.card?.rank !== 'number' || typeof slot?.faceUp !== 'boolean') return false;
    }
  }
  if (!Array.isArray(g.drawPile)) return false;
  if (!Array.isArray(g.locked) || g.locked.length !== GRID_SIZE) return false;
  if (typeof g.current !== 'number' || g.current >= g.players.length) return false;
  if (g.phase !== 'draw' && g.phase !== 'act') return false;
  if (typeof g.heldIsPublic !== 'boolean') return false;

  // Every card must still be accounted for, or the position is not playable.
  const counted =
    g.players.reduce((n, p) => n + p.grid.length + p.discard.length, 0) +
    g.drawPile.length +
    (g.centerCard ? 1 : 0) +
    (g.held ? 1 : 0);
  if (counted !== DECK_SIZE) return false;

  const m = v.match as MatchState | undefined;
  if (typeof m !== 'object' || m === null) return false;
  if (typeof m.rounds !== 'number' || typeof m.played !== 'number') return false;
  if (!Array.isArray(m.totals) || m.totals.length !== g.players.length) return false;

  return true;
}

export function saveGame(save: Omit<SavedGame, 'version' | 'savedAt'>): void {
  try {
    const blob: SavedGame = { ...save, version: SAVE_VERSION, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // Storage full or unavailable. Not worth interrupting play over.
  }
}

export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRestorable(parsed)) {
      clearGame();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearGame(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
