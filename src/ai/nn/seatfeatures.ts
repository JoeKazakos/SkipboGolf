import { COLS, GRID_SIZE, SPECIAL_RANKS, type Rank } from '../../engine/cards';
import { knownCards } from '../../engine/state';
import type { GameState } from '../../engine/types';
import { DEFAULT_EVAL_PARAMS, expectedScore } from '../heuristic';
import { MAX_SEATS, toAbsoluteSeat } from './contracts';

/**
 * A feature layout built for a SHARED per-seat encoder.
 *
 * The first encoder had a lopsided view: the viewer's own grid got 140 raw
 * features - ten slots, each a rank one-hot plus a face-down flag - while every
 * opponent got 16 hand-picked summary numbers. So the network could learn to
 * read its own grid and could never learn to read anyone else's; for opponents
 * it saw only the statistics somebody had already decided were the important
 * ones, which makes those choices a ceiling on what it can discover.
 *
 * Here every seat is described identically, by the same block of features, so
 * one sub-network can be applied to each in turn and its output concatenated
 * for a head network. Two things follow. The sub-network is player-count
 * agnostic, because it only ever looks at one seat. And it sees SEVEN grids per
 * position instead of one, so the part of the job that transfers across every
 * table size - reading a play area - gets roughly seven times the training
 * signal per game.
 *
 * The head keeps the seats ORDERED rather than pooling them. Pooling would
 * generalise across table sizes more aggressively, but turn order carries real
 * meaning in this game: the player who acts before you can end the round is not
 * interchangeable with the one who acts after. Seats arrive rotated so the
 * viewer is offset 0, which preserves exactly that.
 */

/** Features describing one seat. Identical shape for every seat. */
export const SEAT_INPUT = 181;
/** Features describing the table rather than any one seat. */
export const GLOBAL_INPUT = 63;

const SQUARES = COLS - 1;

/** Keeps every written feature finite and bounded whatever the arithmetic did. */
const clamp = (v: number): number => (v > 1 ? 1 : v < -1 ? -1 : v === v ? v : 0);

/**
 * Writes one seat's block.
 *
 * `reveal` shows the face-down ranks, which is correct only inside an already
 * determinized search - see the note on `encodeFeatures` in features.ts. With
 * it off the block is invariant to determinization, which is what an agent
 * reasoning about the real position needs.
 */
export function encodeSeat(
  s: GameState,
  seat: number,
  viewer: number,
  out: Float32Array,
  at: number,
  reveal = false,
): void {
  const n = s.players.length;
  const occupied = seat < n;
  out.fill(0, at, at + SEAT_INPUT);
  if (!occupied) {
    return; // Every flag stays zero, including the occupancy flag at the end.
  }

  const player = s.players[seat];
  let k = at;

  // --- the play area, one slot at a time -----------------------------------
  // A rank one-hot rather than a scaled number, because a column cancels and a
  // 2x2 square forms on rank EQUALITY. A scaled rank would make the network
  // rediscover that equality matters, from numbers that also imply an ordering
  // that does not.
  const known: (Rank | null)[] = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    const slot = player.grid[i];
    const rank = slot.faceUp || reveal ? slot.card.rank : null;
    known.push(rank);
    if (rank != null) out[k + rank - 1] = 1;
    out[k + 13] = slot.faceUp ? 0 : 1;
    k += 14;
  }

  // --- per column: is it settled, and does it cancel ------------------------
  for (let col = 0; col < COLS; col++) {
    const top = known[col];
    const bottom = known[col + COLS];
    const bothKnown = top != null && bottom != null;
    out[k++] = bothKnown ? 1 : 0;
    out[k++] = bothKnown && top === bottom && !SPECIAL_RANKS.has(top as Rank) ? 1 : 0;
  }

  // --- 2x2 squares, which subtract ten each --------------------------------
  // "Dead" means two known and different ranks inside it, so the square can no
  // longer form. That is as informative as "complete" and arrives much earlier.
  for (let col = 0; col < SQUARES; col++) {
    const four = [known[col], known[col + 1], known[col + COLS], known[col + COLS + 1]];
    const present = four.filter((r): r is Rank => r != null);
    const complete = present.length === 4 && present.every((r) => r === present[0]);
    const dead = present.length > 1 && present.some((r) => r !== present[0]);
    out[k++] = complete ? 1 : 0;
    out[k++] = dead ? 1 : 0;
  }

  // --- the discard pile this seat owns -------------------------------------
  // Only the top card, one-hot. The two beneath it are visible by the rules but
  // matter far less, and every feature here is paid for seven times over.
  const depth = player.discard.length;
  const top = depth > 0 ? player.discard[depth - 1] : null;
  if (top != null) out[k + top.rank - 1] = 1;
  out[k + 13] = top != null ? 1 : 0;
  k += 14;

  // --- who this seat is, and how the round stands for them -----------------
  let faceUp = 0;
  for (const slot of player.grid) if (slot.faceUp) faceUp += 1;

  out[k++] = 1; // occupancy
  out[k++] = seat === viewer ? 1 : 0;
  out[k++] = seat === s.current ? 1 : 0;
  out[k++] = seat === s.triggerPlayer ? 1 : 0;
  out[k++] = clamp(expectedScore(known, DEFAULT_EVAL_PARAMS.hiddenEv, DEFAULT_EVAL_PARAMS.pMatch) / 40);
  out[k++] = faceUp / GRID_SIZE;
  out[k++] = faceUp === GRID_SIZE ? 1 : 0;
  out[k++] = clamp(depth / 20);
  // Still owed a turn in the final cycle: the difference between a seat that
  // can still improve and one that is finished.
  const offset = (seat - s.current + n) % n;
  out[k++] =
    s.finalTurnsRemaining != null && offset < s.finalTurnsRemaining ? 1 : 0;
}

/** Writes the table-level block: everything that is not about one seat. */
export function encodeGlobals(
  s: GameState,
  viewer: number,
  out: Float32Array,
  at: number,
  unseen: readonly number[],
): void {
  out.fill(0, at, at + GLOBAL_INPUT);
  let k = at;
  const n = s.players.length;

  if (s.centerCard != null) out[k + s.centerCard.rank - 1] = 1;
  out[k + 13] = s.centerCard != null ? 1 : 0;
  k += 14;

  out[k++] = clamp(s.drawPile.length / 162);
  out[k++] = s.drawPile.length === 0 ? 1 : 0;
  out[k++] = s.phase === 'act' ? 1 : 0;

  // The held card, and only when this viewer is entitled to its rank.
  const heldVisible = s.held != null && (s.current === viewer || s.heldIsPublic);
  if (s.held != null && heldVisible) out[k + s.held.rank - 1] = 1;
  out[k + 13] = s.held != null ? 1 : 0;
  out[k + 14] = heldVisible ? 1 : 0;
  k += 15;

  out[k++] = clamp(s.placements / 10);
  for (let i = 0; i < GRID_SIZE; i++) out[k++] = s.locked[i] ? 1 : 0;

  out[k++] = s.triggerPlayer != null ? 1 : 0;
  out[k++] = s.finalTurnsRemaining != null ? 1 : 0;
  out[k++] = s.finalTurnsRemaining != null ? clamp(s.finalTurnsRemaining / MAX_SEATS) : 0;
  out[k++] = s.terminal ? 1 : 0;
  out[k++] = clamp(s.turnCount / 120);
  out[k++] = n / MAX_SEATS;

  // What is left unseen, by rank. This is the shape of a blind draw, and it is
  // the one place the network can learn to count cards.
  let unknownTotal = 0;
  for (let r = 1; r <= 13; r++) unknownTotal += unseen[r];
  for (let r = 1; r <= 13; r++) out[k++] = clamp(unseen[r] / 12);
  out[k++] = clamp(unknownTotal / 162);
}

/** Seats in mover-relative order, so offset 0 is always the viewer. */
export function seatOrder(viewer: number, numPlayers: number): number[] {
  const order: number[] = [];
  for (let offset = 0; offset < MAX_SEATS; offset++) {
    order.push(offset < numPlayers ? toAbsoluteSeat(offset, viewer, numPlayers) : -1);
  }
  return order;
}

/** Total length of the shared-encoder input vector. */
export const SHARED_INPUT = MAX_SEATS * SEAT_INPUT + GLOBAL_INPUT;

const unseenScratch: number[] = new Array<number>(14).fill(0);

/**
 * Assembles the whole input for the shared encoder: seven seat blocks in
 * mover-relative order, then the table block.
 *
 * Seat blocks come first and contiguously because the network slices them by
 * offset - block `i` is `input[i * SEAT_INPUT ...]` - so the layout here and
 * the slicing in sharednet.ts are one decision written in two places.
 */
export function encodeShared(
  s: GameState,
  viewer: number,
  out?: Float32Array,
  reveal = false,
): Float32Array {
  const f = out ?? new Float32Array(SHARED_INPUT);
  const order = seatOrder(viewer, s.players.length);
  for (let offset = 0; offset < MAX_SEATS; offset++) {
    const seat = order[offset];
    if (seat < 0) {
      f.fill(0, offset * SEAT_INPUT, (offset + 1) * SEAT_INPUT);
    } else {
      encodeSeat(s, seat, viewer, f, offset * SEAT_INPUT, reveal);
    }
  }

  // The unseen-rank census, from the authoritative list of what this viewer has
  // been shown. Twelve of each rank, eighteen Skip-Bos.
  unseenScratch.fill(0);
  for (let rank = 1; rank <= 12; rank++) unseenScratch[rank] = 12;
  unseenScratch[13] = 18;
  for (const card of knownCards(s, viewer)) unseenScratch[card.rank] -= 1;

  encodeGlobals(s, viewer, f, MAX_SEATS * SEAT_INPUT, unseenScratch);
  return f;
}
