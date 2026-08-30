import { GRID_SIZE, createDeck, oppositeOf, type Card, type Rank } from './cards';
import { makeRng, shuffle } from './rng';
import { scoreGrid } from './scoring';
import type { Action, GameState, Observation, PlayerState, Slot } from './types';

export const NUM_PLAYERS = 6;

/** Face-up at deal: bottom-left, bottom-middle, bottom-right (row 2, cols 1/3/5). */
const INITIAL_FACE_UP = [5, 7, 9];

export function createInitialState(seed: number, numPlayers = NUM_PLAYERS): GameState {
  const rng = makeRng(seed);
  const deck = shuffle(createDeck(), rng);
  let cursor = 0;

  const players: PlayerState[] = [];
  for (let p = 0; p < numPlayers; p++) {
    const grid: Slot[] = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      grid.push({ card: deck[cursor++], faceUp: INITIAL_FACE_UP.includes(i) });
    }
    players.push({ grid, discard: [] });
  }

  const centerCard = deck[cursor++];
  const drawPile = deck.slice(cursor);

  return {
    players,
    drawPile,
    centerCard,
    current: 0,
    held: null,
    heldIsPublic: false,
    phase: 'draw',
    locked: new Array(GRID_SIZE).fill(false),
    placements: 0,
    triggerPlayer: null,
    finalTurnsRemaining: null,
    terminal: false,
    rngState: rng.state,
    turnCount: 0,
  };
}

export function clone(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({
      grid: p.grid.map((slot) => ({ ...slot })),
      discard: [...p.discard],
    })),
    drawPile: [...s.drawPile],
    locked: [...s.locked],
  };
}

/**
 * Rebuilds the draw pile from the discard piles, leaving each player their own
 * top card (section 15.8). Mutates the passed state.
 */
function reshuffleDiscards(s: GameState): void {
  const gathered: Card[] = [];
  for (const p of s.players) {
    if (p.discard.length > 1) {
      gathered.push(...p.discard.slice(0, -1));
      p.discard = p.discard.slice(-1);
    }
  }
  if (gathered.length === 0) return;
  const rng = makeRng(s.rngState);
  s.drawPile = shuffle(gathered, rng);
  s.rngState = rng.state;
}

/** True when the held card may legally be waved into the given spot. */
export function isWaveLegal(s: GameState, spot: number): boolean {
  if (s.held == null) return false;
  if (s.locked[spot]) return false;
  const opposite = s.players[s.current].grid[oppositeOf(spot)];
  return opposite.faceUp && opposite.card.rank === s.held.rank;
}

export function legalActions(s: GameState): Action[] {
  if (s.terminal) return [];
  const actions: Action[] = [];

  if (s.phase === 'draw') {
    if (s.centerCard != null) actions.push({ type: 'draw', source: { kind: 'center' } });
    // A pile draw stays legal while a reshuffle could still refill it.
    const canReshuffle = s.players.some((p) => p.discard.length > 1);
    if (s.drawPile.length > 0 || canReshuffle) {
      actions.push({ type: 'draw', source: { kind: 'pile' } });
    }
    for (let p = 0; p < s.players.length; p++) {
      if (p === s.current) continue; // never your own pile
      if (s.players[p].discard.length > 0) {
        actions.push({ type: 'draw', source: { kind: 'discard', player: p } });
      }
    }
    return actions;
  }

  // Holding a card. Discarding is always available (section 15.3).
  actions.push({ type: 'discard' });
  if (s.placements === 0) {
    // The first placement of a turn may target any spot (section 6).
    for (let i = 0; i < GRID_SIZE; i++) actions.push({ type: 'place', spot: i });
  } else {
    for (let i = 0; i < GRID_SIZE; i++) {
      if (isWaveLegal(s, i)) actions.push({ type: 'place', spot: i });
    }
  }
  return actions;
}

function endTurn(s: GameState): void {
  const player = s.players[s.current];
  const allFaceUp = player.grid.every((slot) => slot.faceUp);

  // The round-end check runs only on a completed turn (section 15.5).
  if (allFaceUp && s.triggerPlayer === null) {
    s.triggerPlayer = s.current;
    s.finalTurnsRemaining = s.players.length - 1;
  } else if (s.finalTurnsRemaining !== null) {
    s.finalTurnsRemaining -= 1;
  }

  if (s.finalTurnsRemaining !== null && s.finalTurnsRemaining <= 0) {
    s.terminal = true;
    // All hands are revealed for scoring (section 15.6).
    for (const p of s.players) for (const slot of p.grid) slot.faceUp = true;
    return;
  }

  s.current = (s.current + 1) % s.players.length;
  s.phase = 'draw';
  s.held = null;
  s.locked = new Array(GRID_SIZE).fill(false);
  s.placements = 0;
  s.turnCount += 1;
}

export function applyAction(state: GameState, action: Action): GameState {
  const s = clone(state);

  switch (action.type) {
    case 'draw': {
      if (s.phase !== 'draw') throw new Error('draw is only legal in the draw phase');
      const src = action.source;
      if (src.kind === 'center') {
        if (s.centerCard == null) throw new Error('no centre card remains');
        s.held = s.centerCard;
        s.heldIsPublic = true; // everyone could see the centre card
        s.centerCard = null; // never replaced (section 15.10)
      } else if (src.kind === 'pile') {
        if (s.drawPile.length === 0) reshuffleDiscards(s);
        const card = s.drawPile.pop();
        if (card == null) throw new Error('draw pile is empty and cannot be rebuilt');
        s.held = card;
        // Turned face up as it is taken (section 15.14). The card that was
        // drawn becomes public; the rest of the pile stays unknown to
        // everyone, so nobody learns what is coming next.
        s.heldIsPublic = true;
      } else {
        if (src.player === s.current) throw new Error('cannot draw from your own pile');
        const pile = s.players[src.player].discard;
        const card = pile.pop();
        if (card == null) throw new Error('that discard pile is empty');
        s.held = card;
        s.heldIsPublic = true; // a discard top is visible to everyone
      }
      s.phase = 'act';
      return s;
    }

    case 'place': {
      if (s.phase !== 'act' || s.held == null) throw new Error('nothing held to place');
      if (s.locked[action.spot]) throw new Error('that spot was already played this turn');
      if (s.placements > 0 && !isWaveLegal(s, action.spot)) {
        throw new Error('placement after the first must be a legal wave');
      }
      const slot = s.players[s.current].grid[action.spot];
      const displaced = slot.card;
      // A card lifted out of a face-up spot was on show; one lifted out of a
      // face-down spot is revealed only to the player who picked it up.
      const displacedWasVisible = slot.faceUp;
      slot.card = s.held;
      slot.faceUp = true; // every placed card is face up (section 15.4)
      s.held = displaced;
      s.heldIsPublic = displacedWasVisible;
      s.locked[action.spot] = true;
      s.placements += 1;
      return s;
    }

    case 'discard': {
      if (s.phase !== 'act' || s.held == null) throw new Error('nothing held to discard');
      s.players[s.current].discard.push(s.held);
      s.held = null;
      endTurn(s);
      return s;
    }
  }
}

export const isTerminal = (s: GameState): boolean => s.terminal;

/** Final scores, one per player. Lower is better. */
export function returns(s: GameState): number[] {
  return s.players.map((p) => scoreGrid(p.grid.map((slot) => slot.card.rank as Rank)));
}

export function observationFor(s: GameState, viewer: number): Observation {
  return {
    viewer,
    players: s.players.map((p) => ({
      grid: p.grid.map((slot) =>
        slot.faceUp
          ? { rank: slot.card.rank, faceUp: true as const }
          : { faceUp: false as const },
      ),
      discardTop3: p.discard.slice(-3),
      discardCount: p.discard.length,
    })),
    centerCard: s.centerCard,
    drawPileCount: s.drawPile.length,
    current: s.current,
    held: s.current === viewer ? s.held : null,
    heldByCurrent:
      s.held == null
        ? null
        : { card: s.current === viewer || s.heldIsPublic ? s.held : null },
    phase: s.phase,
    locked: s.locked,
    placements: s.placements,
    triggerPlayer: s.triggerPlayer,
    terminal: s.terminal,
  };
}

/**
 * Whether `player` still has a turn owed in the final cycle.
 *
 * `finalTurnsRemaining` counts the turns owed to the WHOLE table, which is the
 * number the round-end logic needs but not a number any single player cares
 * about: each player gets exactly one final turn (section 11). Turn order runs
 * from `current`, so a player is still owed a turn when their seat falls inside
 * the next `finalTurnsRemaining` seats.
 */
export function stillToActInFinalCycle(s: GameState, player: number): boolean {
  if (s.terminal || s.finalTurnsRemaining == null) return false;
  const n = s.players.length;
  const offset = (player - s.current + n) % n;
  return offset < s.finalTurnsRemaining;
}

/** Compact key identifying one player's information set, for search transposition. */
export function informationStateKey(s: GameState, viewer: number): string {
  const obs = observationFor(s, viewer);
  const grids = obs.players
    .map((p) => p.grid.map((g) => ('rank' in g ? g.rank : 'x')).join(','))
    .join('|');
  const tops = obs.players.map((p) => p.discardTop3.map((c) => c.rank).join('.')).join('|');
  return [
    grids,
    tops,
    obs.centerCard?.rank ?? '-',
    obs.drawPileCount,
    obs.current,
    obs.held?.rank ?? '-',
    obs.phase,
    obs.locked.map((l) => (l ? 1 : 0)).join(''),
  ].join('#');
}

/** Every card visible to a viewer, used by the AI to narrow determinizations. */
export function knownCards(s: GameState, viewer: number): Card[] {
  const known: Card[] = [];
  for (let p = 0; p < s.players.length; p++) {
    for (const slot of s.players[p].grid) if (slot.faceUp) known.push(slot.card);
    known.push(...s.players[p].discard.slice(-3));
  }
  if (s.centerCard) known.push(s.centerCard);
  if (s.held && (s.current === viewer || s.heldIsPublic)) known.push(s.held);
  return known;
}
