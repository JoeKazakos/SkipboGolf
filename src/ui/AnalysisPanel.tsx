import { useMemo, useState } from 'react';
import { analysePosition, type Analysis } from '../ai/analysis';
import { deckRankCounts } from '../ai/heuristic';
import { GRID_SIZE, type Rank } from '../engine/cards';
import { clone } from '../engine/state';
import type { GameState } from '../engine/types';
import { CardFace } from './CardFace';
import { describeSuggestion, rankLabel, spotLabel, type SeatNames } from './format';

const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as Rank[];

/**
 * How many of each rank the position uses, against how many the deck holds.
 *
 * This is the real work of a position editor. The engine holds genuine
 * invariants, and determinize throws the moment the unseen multiset does not
 * add up, so an edited position has to be checked before it is searched.
 */
function census(state: GameState): { rank: Rank; used: number; total: number }[] {
  const totals = deckRankCounts();
  const used = new Array(14).fill(0);
  for (const p of state.players) {
    for (const slot of p.grid) used[slot.card.rank] += 1;
    for (const c of p.discard) used[c.rank] += 1;
  }
  for (const c of state.drawPile) used[c.rank] += 1;
  if (state.centerCard) used[state.centerCard.rank] += 1;
  if (state.held) used[state.held.rank] += 1;
  return RANKS.map((r) => ({ rank: r, used: used[r], total: totals[r] }));
}

function overspent(state: GameState): { rank: Rank; used: number; total: number }[] {
  return census(state).filter((c) => c.used > c.total);
}

/**
 * Edits one of the human's grid cards.
 *
 * Editing swaps the chosen rank with a card of that rank taken from the draw
 * pile, so the deck census stays intact by construction. If the pile holds no
 * such card the edit is refused, which is the honest outcome: every copy of
 * that rank is already somewhere visible.
 */
function setGridRank(state: GameState, spot: number, rank: Rank): GameState | null {
  const next = clone(state);
  const slot = next.players[0].grid[spot];
  if (slot.card.rank === rank) return next;

  const idx = next.drawPile.findIndex((c) => c.rank === rank);
  if (idx < 0) return null;

  const fromPile = next.drawPile[idx];
  next.drawPile[idx] = slot.card;
  next.players[0].grid[spot] = { card: fromPile, faceUp: true };
  return next;
}

export function AnalysisPanel({
  state,
  names,
  onClose,
}: {
  state: GameState;
  names: SeatNames;
  onClose: () => void;
}) {
  const [position, setPosition] = useState<GameState>(() => clone(state));
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [thinking, setThinking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const problems = useMemo(() => overspent(position), [position]);
  const canAnalyse = problems.length === 0 && position.players.length > 1;

  const run = () => {
    setThinking(true);
    setAnalysis(null);
    // Yield first so the button paints its thinking state before the search
    // blocks the thread. Analysis is on demand, so blocking briefly is fine.
    setTimeout(() => {
      try {
        setAnalysis(analysePosition(position, position.current, { budgetMs: 1500 }));
      } finally {
        setThinking(false);
      }
    }, 20);
  };

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Analyse this position"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-card panel-card--wide" data-testid="analysis-panel">
        <h2 className="panel-card__title">Analyse this position</h2>
        <p className="rules__lede">
          Change your own cards if you want to try something out, then ask what the engine
          would play.
        </p>

        <div className="analysis__grid" data-testid="analysis-grid">
          {Array.from({ length: GRID_SIZE }, (_, i) => {
            const slot = position.players[0].grid[i];
            return (
              <label key={i} className="analysis__spot">
                <CardFace rank={slot.card.rank} size="sm" />
                <span className="visually-hidden">{spotLabel(i)}</span>
                <select
                  aria-label={`Card at ${spotLabel(i)}`}
                  value={slot.card.rank}
                  onChange={(e) => {
                    const next = setGridRank(position, i, Number(e.target.value) as Rank);
                    if (next == null) {
                      setRefused(
                        `No ${rankLabel(Number(e.target.value))} left in the deck to place there.`,
                      );
                      return;
                    }
                    setRefused(null);
                    setAnalysis(null);
                    setPosition(next);
                  }}
                >
                  {RANKS.map((r) => (
                    <option key={r} value={r}>
                      {rankLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>

        {refused && (
          <p className="analysis__warn" data-testid="analysis-refused">
            {refused}
          </p>
        )}
        {problems.length > 0 && (
          <p className="analysis__warn" data-testid="analysis-invalid">
            This position uses more cards than the deck holds:{' '}
            {problems.map((p) => `${p.used} of ${rankLabel(p.rank)} (deck has ${p.total})`).join(', ')}.
          </p>
        )}

        <button
          type="button"
          className="btn btn--start"
          disabled={!canAnalyse || thinking}
          onClick={run}
        >
          {thinking ? 'Thinking…' : 'What should I play?'}
        </button>

        {analysis && (
          <div className="analysis__result" data-testid="analysis-result">
            {analysis.forced ? (
              <p>Only one move is legal here.</p>
            ) : (
              <>
                <p className="analysis__best">
                  Play: <strong>{describeSuggestion(position, analysis.candidates[0].action, names)}</strong>
                </p>
                <table className="ladder">
                  <thead>
                    <tr>
                      <th scope="col">Move</th>
                      <th scope="col">Search</th>
                      <th scope="col">Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.candidates.slice(0, 6).map((c, i) => (
                      <tr key={i} data-testid="candidate">
                        <th scope="row">{describeSuggestion(position, c.action, names)}</th>
                        <td>{Math.round(c.share * 100)}%</td>
                        <td>{c.mean.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="details__caveat">
                  &ldquo;Search&rdquo; is the share of the engine&rsquo;s {analysis.iterations}{' '}
                  simulations spent on each move, which is what it actually used to decide.
                  &ldquo;Outcome&rdquo; is the mean result it saw, higher being better.
                </p>
              </>
            )}
          </div>
        )}

        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
