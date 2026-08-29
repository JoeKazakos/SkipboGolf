import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import type { Action, GameState } from '../engine/types';
import type { Agent } from '../ai/agent';
import { createHintAgent, createOpponentAgent } from './agents';
import { HUMAN, describeAction, describeSuggestion, playerName } from './format';

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
  log: LogEntry[];
  /**
   * Number of actions applied so far. Every dispatch carries the sequence it
   * expects, so a duplicated dispatch (React 18 StrictMode double-invoking an
   * effect, a stale timer) is ignored rather than applied twice.
   */
  seq: number;
  hint: Hint | null;
  nextLogId: number;
}

type UiAction =
  | { t: 'apply'; action: Action; expectSeq: number }
  | { t: 'hint'; hint: Hint }
  | { t: 'clearHint' }
  | { t: 'reset'; game: GameState };

function freshState(game: GameState): UiState {
  return {
    game,
    log: [
      {
        id: 0,
        player: -1,
        text: `New round dealt. ${playerName(game.current)} to play.`,
        kind: 'event',
      },
    ],
    seq: 0,
    hint: null,
    nextLogId: 1,
  };
}

function reducer(s: UiState, a: UiAction): UiState {
  switch (a.t) {
    case 'reset':
      return freshState(a.game);

    case 'clearHint':
      return s.hint == null ? s : { ...s, hint: null };

    case 'hint':
      // Drop a hint that arrived after the position already moved on.
      return a.hint.seq === s.seq ? { ...s, hint: a.hint } : s;

    case 'apply': {
      if (a.expectSeq !== s.seq) return s; // duplicate or stale dispatch
      if (s.game.terminal) return s;

      const pre = s.game;
      const actor = pre.current;
      const next = applyAction(pre, a.action);

      const entries: LogEntry[] = [];
      let id = s.nextLogId;
      entries.push({ id: id++, player: actor, text: describeAction(pre, a.action), kind: 'move' });

      if (pre.triggerPlayer === null && next.triggerPlayer !== null) {
        const name = playerName(next.triggerPlayer);
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
        log: [...s.log, ...entries],
        seq: s.seq + 1,
        hint: null,
        nextLogId: id,
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
  /** Injected so tests can run an instant, deterministic opponent. */
  agent?: Agent;
  hintAgent?: Agent;
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

  const agent = useMemo(() => options.agent ?? createOpponentAgent(), [options.agent]);
  const hintAgent = useMemo(
    () => options.hintAgent ?? options.agent ?? createHintAgent(),
    [options.hintAgent, options.agent],
  );

  const [ui, dispatch] = useReducer(reducer, null, () =>
    freshState(initialState ?? createInitialState(seed)),
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

  const newGame = useCallback((nextSeed?: number) => {
    dispatch({
      t: 'reset',
      game: createInitialState(nextSeed ?? Math.floor(Math.random() * 2 ** 31)),
    });
  }, []);

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
          const action = await agent.chooseAction(game, actor, {
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
  }, [game, seq, agent, aiDelayMs]);

  // ---- Hint ----------------------------------------------------------------
  const requestHint = useCallback(() => {
    if (game.terminal || game.current !== HUMAN) return;
    const mySeq = seq;
    setHintPending(true);
    void (async () => {
      try {
        const action = await hintAgent.chooseAction(game, HUMAN, { budgetMs: 1000 });
        dispatch({ t: 'hint', hint: { action, text: describeSuggestion(game, action), seq: mySeq } });
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
