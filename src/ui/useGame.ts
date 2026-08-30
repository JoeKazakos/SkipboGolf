import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import type { Action, GameState } from '../engine/types';
import type { Agent } from '../ai/agent';
import { createHintAgent, createOpponentAgent } from './agents';
import { HUMAN, PLAYER_NAMES, describeAction, describeSuggestion, playerName, type SeatNames } from './format';
import { DEFAULT_OPPONENTS, DEFAULT_PRESET_ID, presetSeats, profileById } from '../ai/roster';

export interface LogEntry {
  id: number;
  player: number;
  text: string;
  kind: 'move' | 'event';
}

export interface Hint {
  action: Action;
  text: string;
  /** The move counter this hint was computed for; stale hints are discarded. */
  seq: number;
}

interface UiState {
  game: GameState;
  /** Seat names, fixed for the life of a game. Held here so the reducer,
   *  which builds the log text outside React, can name players. */
  names: SeatNames;
  log: LogEntry[];
  /**
   * Number of actions applied so far. Every dispatch carries the sequence it
   * expects, so a duplicated dispatch (React 18 StrictMode double-invoking an
   * effect, a stale timer) is ignored rather than applied twice.
   */
  seq: number;
  hint: Hint | null;
  nextLogId: number;
  /**
   * The position as it stood at the start of the human's current turn, kept so
   * the turn can be taken back.
   *
   * The engine is immutable, so undo is restore-a-snapshot rather than an
   * inverse operation. The log is snapshotted with it: restoring the game
   * alone would leave entries describing moves that no longer happened.
   *
   * `seq` is deliberately NOT restored. It only ever counts forward, and
   * guards against a stale dispatch being applied twice; rewinding it could
   * let an in-flight dispatch match again after an undo.
   */
  turnStart: { game: GameState; log: LogEntry[]; nextLogId: number } | null;
}

type UiAction =
  | { t: 'apply'; action: Action; expectSeq: number }
  | { t: 'hint'; hint: Hint }
  | { t: 'clearHint' }
  | { t: 'undo' }
  | { t: 'reset'; game: GameState };

function freshState(game: GameState, names: SeatNames): UiState {
  return {
    game,
    names,
    log: [
      {
        id: 0,
        player: -1,
        // A resumed game starts mid-round, so do not claim it was just dealt.
        // The log itself is commentary rather than game state and is not saved.
        text:
          game.turnCount > 0
            ? `Resumed your saved round. ${playerName(game.current, names)} to play.`
            : `New round dealt. ${playerName(game.current, names)} to play.`,
        kind: 'event',
      },
    ],
    seq: 0,
    hint: null,
    nextLogId: 1,
    turnStart: null,
  };
}

function reducer(s: UiState, a: UiAction): UiState {
  switch (a.t) {
    case 'reset':
      return freshState(a.game, s.names);

    case 'clearHint':
      return s.hint == null ? s : { ...s, hint: null };

    case 'hint':
      // Drop a hint that arrived after the position already moved on.
      return a.hint.seq === s.seq ? { ...s, hint: a.hint } : s;

    case 'undo': {
      if (s.turnStart == null) return s;
      return {
        ...s,
        game: s.turnStart.game,
        log: s.turnStart.log,
        nextLogId: s.turnStart.nextLogId,
        // seq keeps counting forward so any dispatch still in flight, which
        // expects the pre-undo value, is rejected rather than replayed.
        seq: s.seq + 1,
        hint: null,
        turnStart: null,
      };
    }

    case 'apply': {
      if (a.expectSeq !== s.seq) return s; // duplicate or stale dispatch
      if (s.game.terminal) return s;

      const pre = s.game;
      const actor = pre.current;
      const next = applyAction(pre, a.action);

      // Snapshot the position at the first action of the human's turn, and
      // drop it once the turn has passed on: undo is for the turn in hand.
      const startingHumanTurn = actor === HUMAN && pre.phase === 'draw';
      const turnStart = startingHumanTurn
        ? { game: pre, log: s.log, nextLogId: s.nextLogId }
        : s.turnStart;
      const stillHumanTurn = !next.terminal && next.current === HUMAN;

      const entries: LogEntry[] = [];
      let id = s.nextLogId;
      entries.push({
        id: id++,
        player: actor,
        text: describeAction(pre, a.action, s.names),
        kind: 'move',
      });

      if (pre.triggerPlayer === null && next.triggerPlayer !== null) {
        const name = playerName(next.triggerPlayer, s.names);
        const verb = next.triggerPlayer === HUMAN ? 'have' : 'has';
        entries.push({
          id: id++,
          player: next.triggerPlayer,
          text: `${name} ${verb} all ten cards face up. Everyone else gets one final turn.`,
          kind: 'event',
        });
      }
      if (!pre.terminal && next.terminal) {
        entries.push({
          id: id++,
          player: -1,
          text: 'Final turn complete. All hands are revealed and scored.',
          kind: 'event',
        });
      }

      return {
        game: next,
        names: s.names,
        log: [...s.log, ...entries],
        seq: s.seq + 1,
        hint: null,
        nextLogId: id,
        turnStart: stillHumanTurn ? turnStart : null,
      };
    }
  }
}

/**
 * A round is roughly 220 actions long, so the pause before each opponent action
 * has to stay short or the human spends minutes watching. Picking a card up is
 * the beat worth seeing, so placements and waves run at a fraction of it.
 */
export const DEFAULT_AI_DELAY_MS = 420;
const ACT_PAUSE_RATIO = 0.45;

export interface UseGameOptions {
  seed?: number;
  /** Pre-built state, used by tests to start from a specific position. */
  initialState?: GameState;
  /** Injected so tests can run an instant, deterministic opponent. When set,
   *  it drives every opponent seat and the roster seating is ignored. */
  agent?: Agent;
  hintAgent?: Agent;
  /** Roster profile id per opponent seat, for players 1..5. */
  seats?: readonly string[];
  /** Pause between opponent actions so a human can follow along. */
  aiDelayMs?: number;
}

export interface Legality {
  canDrawCenter: boolean;
  canDrawPile: boolean;
  drawableDiscards: ReadonlySet<number>;
  placeSpots: ReadonlySet<number>;
  canDiscard: boolean;
}

const NO_SPOTS: ReadonlySet<number> = new Set<number>();

const EMPTY_LEGALITY: Legality = {
  canDrawCenter: false,
  canDrawPile: false,
  drawableDiscards: NO_SPOTS,
  placeSpots: NO_SPOTS,
  canDiscard: false,
};

export function useGame(options: UseGameOptions = {}) {
  const { seed = 1, initialState, aiDelayMs = DEFAULT_AI_DELAY_MS } = options;

  const seatIds = useMemo(
    () => options.seats ?? presetSeats(DEFAULT_PRESET_ID, DEFAULT_OPPONENTS),
    [options.seats],
  );

  /** The human plus one seat per opponent. */
  const numPlayers = seatIds.length + 1;

  const names: SeatNames = useMemo(() => {
    // An injected agent means a test harness, which expects the stock names.
    if (options.agent) return PLAYER_NAMES;
    return ['You', ...seatIds.map((id) => profileById(id).name)];
  }, [options.agent, seatIds]);

  /**
   * One agent per opponent seat. An injected `agent` overrides every seat so
   * tests keep a single deterministic opponent.
   */
  const seatAgents = useMemo(() => {
    if (options.agent) return null;
    return seatIds.map((id, i) => createOpponentAgent(profileById(id), 1 + i * 31));
  }, [options.agent, seatIds]);

  const hintAgent = useMemo(
    () => options.hintAgent ?? options.agent ?? createHintAgent(),
    [options.hintAgent, options.agent],
  );

  const [ui, dispatch] = useReducer(reducer, null, () =>
    freshState(initialState ?? createInitialState(seed, numPlayers), names),
  );
  const [hintPending, setHintPending] = useState(false);

  const { game, seq } = ui;
  const isHumanTurn = !game.terminal && game.current === HUMAN;

  const legal: Legality = useMemo(() => {
    if (!isHumanTurn) return EMPTY_LEGALITY;
    const actions = legalActions(game);
    const drawableDiscards = new Set<number>();
    const placeSpots = new Set<number>();
    let canDrawCenter = false;
    let canDrawPile = false;
    let canDiscard = false;
    for (const a of actions) {
      if (a.type === 'draw') {
        if (a.source.kind === 'center') canDrawCenter = true;
        else if (a.source.kind === 'pile') canDrawPile = true;
        else drawableDiscards.add(a.source.player);
      } else if (a.type === 'place') {
        placeSpots.add(a.spot);
      } else {
        canDiscard = true;
      }
    }
    return { canDrawCenter, canDrawPile, drawableDiscards, placeSpots, canDiscard };
  }, [game, isHumanTurn]);

  /** Applies a human action. Silently ignores anything not currently legal. */
  const play = useCallback(
    (action: Action) => {
      if (game.terminal || game.current !== HUMAN) return;
      const ok = legalActions(game).some((a) => sameAction(a, action));
      if (!ok) return;
      dispatch({ t: 'apply', action, expectSeq: seq });
    },
    [game, seq],
  );

  /**
   * Takes back everything done this turn. Only offered on the human's own
   * turn, and never once the turn has ended: a discard commits it.
   */
  const canUndo = isHumanTurn && ui.turnStart != null;
  const undo = useCallback(() => {
    dispatch({ t: 'undo' });
  }, []);

  const newGame = useCallback(
    (nextSeed?: number) => {
      dispatch({
        t: 'reset',
        game: createInitialState(nextSeed ?? Math.floor(Math.random() * 2 ** 31), numPlayers),
      });
    },
    [numPlayers],
  );

  // ---- Opponent driver -----------------------------------------------------
  // One action is scheduled per render in which an opponent is to move. The
  // cleanup cancels anything in flight, and the sequence guard in the reducer
  // makes a duplicated dispatch a no-op, so the loop cannot run ahead of itself
  // or freeze the UI: every action goes through a timer and a re-render.
  const [thinkingFor, setThinkingFor] = useState<number | null>(null);

  useEffect(() => {
    if (game.terminal || game.current === HUMAN) {
      setThinkingFor(null);
      return;
    }
    const actor = game.current;
    const mySeq = seq;
    let cancelled = false;
    const controller = new AbortController();
    setThinkingFor(actor);

    const pause =
      game.phase === 'draw' ? aiDelayMs : Math.round(aiDelayMs * ACT_PAUSE_RATIO);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          // No budgetMs here: aiDelayMs is the pacing delay that makes the
          // opponents watchable, not a thinking budget. Passing it would cap
          // the search at a fraction of a second. The agent carries its own.
          const actingAgent = options.agent ?? seatAgents?.[actor - 1];
          if (!actingAgent) throw new Error(`no agent seated for player ${actor}`);
          const action = await actingAgent.chooseAction(game, actor, {
            signal: controller.signal,
          });
          if (cancelled) return;
          dispatch({ t: 'apply', action, expectSeq: mySeq });
        } catch {
          if (!cancelled) setThinkingFor(null);
        }
      })();
    }, pause);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [game, seq, seatAgents, options.agent, aiDelayMs]);

  // ---- Hint ----------------------------------------------------------------
  const requestHint = useCallback(() => {
    if (game.terminal || game.current !== HUMAN) return;
    const mySeq = seq;
    setHintPending(true);
    void (async () => {
      try {
        const action = await hintAgent.chooseAction(game, HUMAN, { budgetMs: 1000 });
        dispatch({
          t: 'hint',
          hint: { action, text: describeSuggestion(game, action, names), seq: mySeq },
        });
      } catch {
        /* a hint is advisory; a failure just leaves the panel empty */
      } finally {
        setHintPending(false);
      }
    })();
  }, [game, seq, hintAgent]);

  const clearHint = useCallback(() => dispatch({ t: 'clearHint' }), []);

  return {
    game,
    names,
    canUndo,
    undo,
    log: ui.log,
    hint: ui.hint,
    hintPending,
    isHumanTurn,
    thinkingFor,
    legal,
    play,
    newGame,
    requestHint,
    clearHint,
  };
}

function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'place' && b.type === 'place') return a.spot === b.spot;
  if (a.type === 'draw' && b.type === 'draw') {
    if (a.source.kind !== b.source.kind) return false;
    if (a.source.kind === 'discard' && b.source.kind === 'discard') {
      return a.source.player === b.source.player;
    }
    return true;
  }
  return true;
}
