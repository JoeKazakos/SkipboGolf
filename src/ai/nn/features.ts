import {
  COLS,
  DECK_SIZE,
  GRID_SIZE,
  SPECIAL_RANKS,
  type Rank,
} from '../../engine/cards';
import { knownCards, stillToActInFinalCycle } from '../../engine/state';
import type { GameState, Slot } from '../../engine/types';
import {
  DEFAULT_HIDDEN_EV,
  DEFAULT_P_MATCH,
  cardValue,
  expectedScore,
  type GridView,
} from '../heuristic';
import { MAX_SEATS, toAbsoluteSeat } from './contracts';

/**
 * The information state as a fixed-length vector for the learned evaluator.
 *
 * Two properties govern every decision in this file.
 *
 * **It may read only what `viewer` can see.** The binding test is invariance
 * under determinization: `encodeFeatures(s, viewer)` must be bit-identical to
 * `encodeFeatures(determinize(s, viewer, rng), viewer)`, because determinization
 * keeps every visible card and re-deals every hidden one. So a face-down slot
 * contributes only "face down", a discard pile contributes only its top three
 * (section 4), the draw pile contributes only its length, and an opponent's held
 * card contributes a rank only while `heldIsPublic`. Card ids are never read at
 * all: determinization re-pairs unseen ids with unseen ranks, so an id is a
 * hidden-information channel even though it carries no rule meaning. Neither is
 * `rngState`, which determinization advances.
 *
 * **Everything is rotated so `viewer` sits at offset 0**, and padded to
 * `MAX_SEATS` with an occupancy flag, so a single network serves tables of two
 * to seven players (section 15.12) and a pattern learned in one seat transfers
 * to every other.
 *
 * Values are kept in [-1, 1]; every write goes through `clamp`, which also means
 * no arithmetic surprise can put a NaN or an Infinity into a training batch.
 */

/** Largest a single column can contribute: two 12s, before any cancel or square. */
const MAX_COLUMN_POINTS = 24;

/** A whole play area rarely finishes far above this; it is the scale, not a cap. */
const SCORE_SCALE = 40;

/** Rounds run 50-103 turns, so this maps a round onto roughly the unit interval. */
const TURN_SCALE = 120;

/** Per slot: a 13-way rank one-hot plus a face-down flag. */
const OWN_SLOT_FEATURES = 14;
const OWN_GRID_FEATURES = GRID_SIZE * OWN_SLOT_FEATURES;

/** Per column of the viewer's grid; see the column block below. */
const COLUMN_FEATURES = 6;
const COLUMN_BLOCK = COLS * COLUMN_FEATURES;

/** Per candidate 2x2 square (four overlapping ones across five columns). */
const SQUARE_FEATURES = 3;
const SQUARE_BLOCK = (COLS - 1) * SQUARE_FEATURES;

/** Per seat, at offset 0..6 from the viewer; see the seat block below. */
const SEAT_FEATURES = 16;
const SEAT_BLOCK = MAX_SEATS * SEAT_FEATURES;

/** Unseen-card census: 13 rank shares plus how much of the deck is still unknown. */
const UNSEEN_FEATURES = 14;

/** The per-spot lock mask (section 15.1), which belongs to whoever is to act. */
const LOCK_FEATURES = GRID_SIZE;

/** Center, pile, phase, held card, round-end state and the race summary. */
const GLOBAL_FEATURES = 25;

export const FEATURE_SIZE =
  OWN_GRID_FEATURES +
  COLUMN_BLOCK +
  SQUARE_BLOCK +
  SEAT_BLOCK +
  UNSEEN_FEATURES +
  LOCK_FEATURES +
  GLOBAL_FEATURES;

/**
 * Scratch buffers reused across calls. The encoder runs millions of times inside
 * search, so it allocates nothing per call; that makes it single-threaded and
 * non-reentrant, which is exactly how the search uses it.
 */
const viewScratch: (Rank | null)[] = new Array<Rank | null>(GRID_SIZE).fill(null);
const seatScratch: (Rank | null)[] = new Array<Rank | null>(GRID_SIZE).fill(null);
/** Ranks the viewer has face up somewhere, indexed by rank. Answers "can I wave this?". */
const viewerHasRank: boolean[] = new Array<boolean>(14).fill(false);
/** The same for whoever is to act, which is what the held card can actually wave onto. */
const moverHasRank: boolean[] = new Array<boolean>(14).fill(false);
const unseenCounts: number[] = new Array<number>(14).fill(0);

/** Keeps every written feature finite and bounded, whatever the arithmetic did. */
const clamp = (v: number): number => (v > 1 ? 1 : v < -1 ? -1 : v === v ? v : 0);

/** Masks the face-down cards out of a grid into a reused buffer. */
function fillView(grid: readonly Slot[], out: (Rank | null)[]): void {
  for (let i = 0; i < GRID_SIZE; i++) {
    const slot = grid[i];
    out[i] = slot.faceUp ? slot.card.rank : null;
  }
}

/**
 * Expected contribution of one column, averaging over a card still face down.
 *
 * This mirrors the private `expectedColumnScore` in heuristic.ts, built from the
 * two constants that file exports. It is duplicated rather than exported because
 * the network wants the term column by column, while the heuristic only ever
 * needs the sum, and widening that module's surface for a consumer in the nn
 * layer would be the wrong trade.
 */
function expectedColumn(top: Rank | null, bottom: Rank | null): number {
  if (top != null && bottom != null) {
    if (top === bottom && !SPECIAL_RANKS.has(top)) return 0;
    return cardValue(top) + cardValue(bottom);
  }
  if (top == null && bottom == null) return 2 * DEFAULT_HIDDEN_EV * (1 - DEFAULT_P_MATCH);
  const known = (top ?? bottom) as Rank;
  const cancelChance = SPECIAL_RANKS.has(known) ? 0 : DEFAULT_P_MATCH;
  return (1 - cancelChance) * (cardValue(known) + DEFAULT_HIDDEN_EV);
}

/**
 * The information state of `viewer` as a fixed-length vector.
 *
 * Pass `out` to fill an existing buffer; the search reuses one allocation across
 * every node it evaluates. The result is a pure function of the state and the
 * viewer: same input, same bits, always.
 */
export function encodeFeatures(s: GameState, viewer: number, out?: Float32Array): Float32Array {
  const f = out ?? new Float32Array(FEATURE_SIZE);
  if (f.length !== FEATURE_SIZE) {
    throw new Error(`feature buffer must hold ${FEATURE_SIZE} values, got ${f.length}`);
  }
  f.fill(0);

  const numPlayers = s.players.length;
  let at = 0;

  fillView(s.players[viewer].grid, viewScratch);

  viewerHasRank.fill(false);
  for (let i = 0; i < GRID_SIZE; i++) {
    const rank = viewScratch[i];
    if (rank != null) viewerHasRank[rank] = true;
  }
  moverHasRank.fill(false);
  if (s.current === viewer) {
    for (let r = 1; r <= 13; r++) moverHasRank[r] = viewerHasRank[r];
  } else {
    for (const slot of s.players[s.current].grid) {
      if (slot.faceUp) moverHasRank[slot.card.rank] = true;
    }
  }

  // --- The viewer's own grid, in full detail -------------------------------
  // Rank identity, not just value, decides whether a column cancels and whether
  // a 2x2 square forms, so this block is a one-hot rather than a scaled number:
  // the net has to be able to tell "another 4" from "a 5" without learning that
  // equality is a thing about numbers. A face-down slot writes only its flag.
  for (let i = 0; i < GRID_SIZE; i++) {
    const rank = viewScratch[i];
    if (rank == null) f[at + 13] = 1;
    else f[at + rank - 1] = 1;
    at += OWN_SLOT_FEATURES;
  }

  // --- Per column of the viewer's grid --------------------------------------
  // The scoring rules are stated per column (section 12), so the useful summary
  // is too: how much of the column is known, whether the pair has cancelled,
  // what it scores as it lies, and what it is worth once the unknown resolves.
  for (let col = 0; col < COLS; col++) {
    const top = viewScratch[col];
    const bottom = viewScratch[col + COLS];
    const known = (top == null ? 0 : 1) + (bottom == null ? 0 : 1);
    const bothUp = known === 2;
    const cancels = bothUp && top === bottom && !SPECIAL_RANKS.has(top as Rank);
    const settled = bothUp ? (cancels ? 0 : cardValue(top as Rank) + cardValue(bottom as Rank)) : 0;
    f[at] = known / 2;
    f[at + 1] = bothUp ? 1 : 0;
    f[at + 2] = cancels ? 1 : 0;
    // A live cancel chance: one card down, and the other is a rank that could match it.
    f[at + 3] = known === 1 && !SPECIAL_RANKS.has((top ?? bottom) as Rank) ? 1 : 0;
    f[at + 4] = clamp(settled / MAX_COLUMN_POINTS);
    f[at + 5] = clamp(expectedColumn(top, bottom) / MAX_COLUMN_POINTS);
    at += COLUMN_FEATURES;
  }

  // --- Candidate 2x2 squares ------------------------------------------------
  // A finished square is worth -10, far more than any single card, so the net
  // needs to see part-built ones as targets rather than infer them from ten
  // one-hots. `dead` is the other half of the signal: two different known ranks
  // in the square mean it can never be built and the columns are free for
  // ordinary play.
  for (let col = 0; col < COLS - 1; col++) {
    let rank: Rank | null = null;
    let matching = 0;
    let dead = false;
    for (let k = 0; k < 4; k++) {
      const cell = viewScratch[k < 2 ? col + k : col + (k - 2) + COLS];
      if (cell == null) continue;
      if (rank == null) {
        rank = cell;
        matching = 1;
      } else if (cell === rank) {
        matching += 1;
      } else {
        dead = true;
        break;
      }
    }
    f[at] = dead ? 0 : matching / 4;
    f[at + 1] = !dead && matching === 4 ? 1 : 0;
    f[at + 2] = dead ? 1 : 0;
    at += SQUARE_FEATURES;
  }

  // --- Per seat, rotated so the viewer is offset 0 --------------------------
  // Offset 0 restates the viewer at the same scale as everyone else, which costs
  // sixteen numbers and lets the net compare seats with one shared set of
  // weights. Empty seats stay zero and are marked by the occupancy flag.
  //
  // Face-up count is the race: going out ends the round (section 11) and every
  // turn the leader denies is a turn nobody else gets to improve in. Expected
  // score is what the round is actually decided on. The visible discard tops are
  // the only public draw sources besides the center, and the flag saying whether
  // the viewer can wave that rank is what turns a top card into an opportunity.
  const viewerExpected = expectedScore(viewScratch as GridView);
  let viewerFaceUp = 0;
  for (let i = 0; i < GRID_SIZE; i++) if (viewScratch[i] != null) viewerFaceUp += 1;
  let worstOpponentExpected = Number.POSITIVE_INFINITY;
  let leadFaceUp = 0;

  const seatBase = at;
  for (let offset = 0; offset < numPlayers; offset++) {
    const seat = toAbsoluteSeat(offset, viewer, numPlayers);
    const player = s.players[seat];
    let expected: number;
    let faceUp = 0;
    if (seat === viewer) {
      expected = viewerExpected;
      faceUp = viewerFaceUp;
    } else {
      fillView(player.grid, seatScratch);
      expected = expectedScore(seatScratch as GridView);
      for (let i = 0; i < GRID_SIZE; i++) if (seatScratch[i] != null) faceUp += 1;
      if (expected < worstOpponentExpected) worstOpponentExpected = expected;
      if (faceUp > leadFaceUp) leadFaceUp = faceUp;
    }

    const i = seatBase + offset * SEAT_FEATURES;
    f[i] = 1; // occupied
    f[i + 1] = clamp(expected / SCORE_SCALE);
    f[i + 2] = faceUp / GRID_SIZE;
    f[i + 3] = faceUp === GRID_SIZE ? 1 : 0;
    const len = player.discard.length;
    f[i + 4] = clamp(len / GRID_SIZE);

    // Only the top three cards of a pile are public (section 4); everything
    // below them is re-dealt by determinization and must not be read here. The
    // top card gets a special-rank flag as well, because it is the only one of
    // the three that can actually be drawn and so the only one whose scoring
    // value the viewer might act on this turn.
    const top = len > 0 ? player.discard[len - 1] : null;
    if (top != null) {
      f[i + 5] = 1;
      f[i + 6] = top.rank / 13;
      f[i + 7] = SPECIAL_RANKS.has(top.rank) ? 1 : 0;
    }
    if (len > 1) {
      f[i + 8] = 1;
      f[i + 9] = player.discard[len - 2].rank / 13;
    }
    if (len > 2) {
      f[i + 10] = 1;
      f[i + 11] = player.discard[len - 3].rank / 13;
    }
    // Whether the viewer could wave the top card, the one card here they may
    // draw. This is what turns a visible rank into an opportunity.
    f[i + 12] = top != null && seat !== viewer && viewerHasRank[top.rank] ? 1 : 0;

    // Round-end bookkeeping, per seat rather than as a bare count, because what
    // matters is which specific seats still get to act (sections 11 and 15.7).
    f[i + 13] = seat === s.current ? 1 : 0;
    f[i + 14] = seat === s.triggerPlayer ? 1 : 0;
    f[i + 15] = stillToActInFinalCycle(s, seat) ? 1 : 0;
  }
  at = seatBase + SEAT_BLOCK;

  // --- What is still unaccounted for ---------------------------------------
  // The shape of a blind draw. `knownCards` is the authoritative list of what
  // this viewer has seen, so subtracting it from the deck census gives exactly
  // the distribution they are entitled to reason about - and nothing more.
  unseenCounts.fill(0);
  for (let rank = 1; rank <= 12; rank++) unseenCounts[rank] = 12;
  unseenCounts[13] = 18;
  for (const card of knownCards(s, viewer)) unseenCounts[card.rank] -= 1;
  let unseenTotal = 0;
  for (let rank = 1; rank <= 13; rank++) {
    if (unseenCounts[rank] > 0) unseenTotal += unseenCounts[rank];
  }
  for (let rank = 1; rank <= 13; rank++) {
    const n = unseenCounts[rank] > 0 ? unseenCounts[rank] : 0;
    f[at + rank - 1] = unseenTotal > 0 ? clamp(n / unseenTotal) : 0;
  }
  f[at + 13] = clamp(unseenTotal / DECK_SIZE);
  at += UNSEEN_FEATURES;

  // --- The lock mask --------------------------------------------------------
  // A spot may be played into only once per turn (section 15.1), so the mask is
  // what makes a wave chain finite and is the difference between a legal and an
  // illegal placement. It belongs to whoever is to act; `viewerIsCurrent` below
  // says whether that is the viewer's own grid it refers to.
  for (let i = 0; i < GRID_SIZE; i++) f[at + i] = s.locked[i] ? 1 : 0;
  at += LOCK_FEATURES;

  // --- Table-wide state -----------------------------------------------------
  const center = s.centerCard;
  f[at] = center != null ? 1 : 0;
  f[at + 1] = center != null ? center.rank / 13 : 0;
  f[at + 2] = center != null && SPECIAL_RANKS.has(center.rank) ? 1 : 0;
  f[at + 3] = center != null && viewerHasRank[center.rank] ? 1 : 0;
  // Only the COUNT of the draw pile is public. Its contents are re-dealt by
  // determinization and reading any of them would be plain cheating.
  f[at + 4] = clamp(s.drawPile.length / DECK_SIZE);
  f[at + 5] = s.drawPile.length === 0 ? 1 : 0;

  f[at + 6] = s.phase === 'act' ? 1 : 0;
  f[at + 7] = s.current === viewer ? 1 : 0;
  f[at + 8] = clamp(s.placements / GRID_SIZE);
  f[at + 9] = s.placements > 0 ? 1 : 0;

  // The held card. Its rank is readable only when the viewer holds it or the
  // draw was public (section 15.14); a card lifted out of a face-down spot is
  // known to its owner alone, and `heldIsPublic` is the engine's record of that.
  const held = s.held;
  const heldVisible = held != null && (s.current === viewer || s.heldIsPublic);
  f[at + 10] = held != null ? 1 : 0;
  f[at + 11] = heldVisible ? 1 : 0;
  f[at + 12] = heldVisible ? (held as { rank: Rank }).rank / 13 : 0;
  f[at + 13] = heldVisible && SPECIAL_RANKS.has((held as { rank: Rank }).rank) ? 1 : 0;
  f[at + 14] = heldVisible && moverHasRank[(held as { rank: Rank }).rank] ? 1 : 0;

  // Round-end timing, encoded faithfully because the whole endgame turns on it:
  // the trigger fires only at the end of a completed turn (section 15.5), and
  // every other seat is then owed exactly one more turn (section 11).
  f[at + 15] = s.triggerPlayer != null ? 1 : 0;
  f[at + 16] = s.triggerPlayer === viewer ? 1 : 0;
  f[at + 17] = s.finalTurnsRemaining != null ? 1 : 0;
  f[at + 18] = s.finalTurnsRemaining != null ? clamp(s.finalTurnsRemaining / MAX_SEATS) : 0;
  f[at + 19] = s.terminal ? 1 : 0;

  f[at + 20] = clamp(s.turnCount / TURN_SCALE);
  f[at + 21] = numPlayers / MAX_SEATS;

  // The race and the score gap as single numbers, so the net does not have to
  // rediscover a comparison it will want at every node. Positive means the
  // viewer is behind.
  f[at + 22] = clamp((leadFaceUp - viewerFaceUp) / GRID_SIZE);
  f[at + 23] = clamp(leadFaceUp / GRID_SIZE);
  f[at + 24] = Number.isFinite(worstOpponentExpected)
    ? clamp((viewerExpected - worstOpponentExpected) / SCORE_SCALE)
    : 0;
  at += GLOBAL_FEATURES;

  if (at !== FEATURE_SIZE) {
    throw new Error(`encoder wrote ${at} features, expected ${FEATURE_SIZE}`);
  }
  return f;
}
