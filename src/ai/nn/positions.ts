import { GRID_SIZE, type Card, type Rank } from '../../engine/cards';
import type { GameState, Phase, PlayerState, Slot } from '../../engine/types';

/**
 * Compact binary serialisation of a position.
 *
 * Self-play stores POSITIONS rather than the feature vectors derived from
 * them. That is the decision that lets the feature encoding change without
 * regenerating a single game of self-play, which is the difference between a
 * one-hour and a twenty-hour iteration when the encoding turns out to be
 * wrong - and it will, at least once.
 *
 * It is also smaller. A position is about 400 bytes; the 343-float feature
 * vector it produces is 1,372.
 *
 * The format is exact, not lossy: card ids, pile order and rng state all
 * survive, so a decoded position can be searched, stepped, or determinized
 * exactly as the original was. Anything less would quietly change the training
 * distribution.
 */

export const POSITION_FORMAT_VERSION = 1;

/** Sentinel for a `number | null` field stored in one byte. */
const NONE = 0xff;

class Writer {
  private buf: Uint8Array;
  private at = 0;

  constructor(capacity = 1024) {
    this.buf = new Uint8Array(capacity);
  }

  private need(n: number): void {
    if (this.at + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.at + n) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buf);
    this.buf = grown;
  }

  u8(v: number): void {
    this.need(1);
    this.buf[this.at++] = v & 0xff;
  }

  u16(v: number): void {
    this.need(2);
    this.buf[this.at++] = v & 0xff;
    this.buf[this.at++] = (v >>> 8) & 0xff;
  }

  u32(v: number): void {
    this.need(4);
    this.buf[this.at++] = v & 0xff;
    this.buf[this.at++] = (v >>> 8) & 0xff;
    this.buf[this.at++] = (v >>> 16) & 0xff;
    this.buf[this.at++] = (v >>> 24) & 0xff;
  }

  /** Rank in one byte, id in the next. Ranks are 1-13 and ids 0-161. */
  card(c: Card): void {
    this.u8(c.rank);
    this.u8(c.id);
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.at);
  }
}

class Reader {
  private at = 0;

  constructor(private readonly buf: Uint8Array) {}

  private need(n: number): void {
    if (this.at + n > this.buf.length) {
      throw new Error(
        `position: ran off the end of the buffer at byte ${this.at} needing ${n}; ` +
          'the record is truncated',
      );
    }
  }

  u8(): number {
    this.need(1);
    return this.buf[this.at++];
  }

  u16(): number {
    this.need(2);
    return this.buf[this.at++] | (this.buf[this.at++] << 8);
  }

  u32(): number {
    this.need(4);
    return (
      (this.buf[this.at++] |
        (this.buf[this.at++] << 8) |
        (this.buf[this.at++] << 16) |
        (this.buf[this.at++] << 24)) >>>
      0
    );
  }

  card(): Card {
    const rank = this.u8() as Rank;
    const id = this.u8();
    return { rank, id };
  }

  get offset(): number {
    return this.at;
  }
}

/** Bit flags packed into one byte, so six booleans cost six bits. */
const F_HELD_PUBLIC = 1 << 0;
const F_TERMINAL = 1 << 1;
const F_HAS_HELD = 1 << 2;
const F_HAS_CENTER = 1 << 3;
const F_PHASE_ACT = 1 << 4;

export function encodePosition(s: GameState): Uint8Array {
  const w = new Writer();
  w.u8(POSITION_FORMAT_VERSION);
  w.u8(s.players.length);
  w.u8(s.current);

  let flags = 0;
  if (s.heldIsPublic) flags |= F_HELD_PUBLIC;
  if (s.terminal) flags |= F_TERMINAL;
  if (s.held != null) flags |= F_HAS_HELD;
  if (s.centerCard != null) flags |= F_HAS_CENTER;
  if (s.phase === 'act') flags |= F_PHASE_ACT;
  w.u8(flags);

  w.u8(s.placements);
  w.u8(s.triggerPlayer == null ? NONE : s.triggerPlayer);
  w.u8(s.finalTurnsRemaining == null ? NONE : s.finalTurnsRemaining);
  w.u32(s.rngState);
  w.u32(s.turnCount);

  // The lock mask is exactly GRID_SIZE booleans, so it fits in two bytes.
  let locked = 0;
  for (let i = 0; i < GRID_SIZE; i++) if (s.locked[i]) locked |= 1 << i;
  w.u16(locked);

  for (const p of s.players) {
    let faceUp = 0;
    for (let i = 0; i < GRID_SIZE; i++) if (p.grid[i].faceUp) faceUp |= 1 << i;
    w.u16(faceUp);
    for (let i = 0; i < GRID_SIZE; i++) w.card(p.grid[i].card);
    w.u16(p.discard.length);
    for (const c of p.discard) w.card(c);
  }

  w.u16(s.drawPile.length);
  for (const c of s.drawPile) w.card(c);
  if (s.centerCard != null) w.card(s.centerCard);
  if (s.held != null) w.card(s.held);

  return w.done();
}

export function decodePosition(bytes: Uint8Array): GameState {
  const r = new Reader(bytes);
  const version = r.u8();
  if (version !== POSITION_FORMAT_VERSION) {
    throw new Error(
      `position: format version ${version}, but this build writes ` +
        `${POSITION_FORMAT_VERSION}; regenerate the data or add a migration`,
    );
  }

  const numPlayers = r.u8();
  const current = r.u8();
  const flags = r.u8();
  const placements = r.u8();
  const triggerByte = r.u8();
  const finalByte = r.u8();
  const rngState = r.u32();
  const turnCount = r.u32();

  const lockedMask = r.u16();
  const locked: boolean[] = [];
  for (let i = 0; i < GRID_SIZE; i++) locked.push((lockedMask & (1 << i)) !== 0);

  const players: PlayerState[] = [];
  for (let p = 0; p < numPlayers; p++) {
    const faceUpMask = r.u16();
    const grid: Slot[] = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      grid.push({ card: r.card(), faceUp: (faceUpMask & (1 << i)) !== 0 });
    }
    const discardLen = r.u16();
    const discard: Card[] = [];
    for (let i = 0; i < discardLen; i++) discard.push(r.card());
    players.push({ grid, discard });
  }

  const drawLen = r.u16();
  const drawPile: Card[] = [];
  for (let i = 0; i < drawLen; i++) drawPile.push(r.card());

  const centerCard = (flags & F_HAS_CENTER) !== 0 ? r.card() : null;
  const held = (flags & F_HAS_HELD) !== 0 ? r.card() : null;

  return {
    players,
    drawPile,
    centerCard,
    current,
    held,
    heldIsPublic: (flags & F_HELD_PUBLIC) !== 0,
    phase: ((flags & F_PHASE_ACT) !== 0 ? 'act' : 'draw') as Phase,
    locked,
    placements,
    triggerPlayer: triggerByte === NONE ? null : triggerByte,
    finalTurnsRemaining: finalByte === NONE ? null : finalByte,
    terminal: (flags & F_TERMINAL) !== 0,
    rngState,
    turnCount,
  };
}

/**
 * Reads one position from a concatenated stream, returning it with the offset
 * of the next record. Shard files hold hundreds of thousands of these back to
 * back, and no reader should have to slice the whole file to walk them.
 */
export function decodePositionAt(
  bytes: Uint8Array,
  offset: number,
): { state: GameState; next: number } {
  const view = bytes.subarray(offset);
  const state = decodePosition(view);
  return { state, next: offset + encodedLength(state) };
}

/** Byte length this position occupies, without re-encoding it. */
export function encodedLength(s: GameState): number {
  let n = 1 + 1 + 1 + 1 + 1 + 1 + 1 + 4 + 4 + 2; // header through lock mask
  for (const p of s.players) n += 2 + GRID_SIZE * 2 + 2 + p.discard.length * 2;
  n += 2 + s.drawPile.length * 2;
  if (s.centerCard != null) n += 2;
  if (s.held != null) n += 2;
  return n;
}
