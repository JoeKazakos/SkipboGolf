import { GRID_SIZE } from '../engine/cards';
import { returns } from '../engine/state';
import type { GameState } from '../engine/types';
import { CardFace } from './CardFace';
import { HUMAN, playerName, rankLabel, type SeatNames } from './format';
import { scoreBreakdown } from '../engine/scoring';
import { useSettings } from './settings';

/**
 * The end-of-round scorecard. Every hand is face up at this point (section 15.6)
 * so all ten cards of every player are shown.
 */
export function GameOver({
  state,
  names,
  onNewGame,
  match,
}: {
  state: GameState;
  names: SeatNames;
  onNewGame: () => void;
  /** Present only in a multi-round match; absent for a single-round game. */
  match?: {
    label: string | null;
    /**
     * Totals BEFORE this round. The round just played is added here, so the
     * standings include it without the match state having advanced yet.
     */
    totalsBefore: readonly number[];
    /** True when this round is the last one of the match. */
    isOver: boolean;
  };
}) {
  const scores = returns(state);
  const best = Math.min(...scores);
  const winners = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
  const humanWon = winners.includes(HUMAN);
  const { settings, set } = useSettings();

  const ranking = scores
    .map((score, player) => ({ score, player }))
    .sort((a, b) => a.score - b.score || a.player - b.player);

  const winnerText =
    winners.length === 1
      ? `${playerName(winners[0], names)} ${winners[0] === HUMAN ? 'win' : 'wins'} with ${best}.`
      : `${winners.map((w) => playerName(w, names)).join(' and ')} tie for the lowest score, ${best}.`;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Round over">
      <div className="scorecard">
        <h2 className="scorecard__title">
          {match?.isOver ? 'Match over' : 'Round over'}
        </h2>
        {match?.label && !match.isOver && (
          <p className="scorecard__round" data-testid="round-label">
            {match.label} complete
          </p>
        )}
        <p className="scorecard__winner" data-testid="winner">
          {humanWon ? 'You win! ' : ''}
          {winnerText}
        </p>
        <p className="scorecard__sub">
          Lowest score wins.{' '}
          <button
            type="button"
            className="linkbtn"
            aria-pressed={settings.showScoreBreakdown}
            onClick={() => set('showScoreBreakdown', !settings.showScoreBreakdown)}
          >
            {settings.showScoreBreakdown ? 'Hide working' : 'Show working'}
          </button>
        </p>

        <ol className="scorecard__list">
          {ranking.map(({ score, player }, place) => (
            <li
              key={player}
              className={`scoreline ${score === best ? 'scoreline--winner' : ''} ${
                player === HUMAN ? 'scoreline--mine' : ''
              }`}
              data-testid="final-score"
              data-player={player}
              data-score={score}
            >
              <span className="scoreline__place">{place + 1}</span>
              <span className="scoreline__name">{playerName(player, names)}</span>
              <span className="scoreline__grid" aria-hidden="true">
                {Array.from({ length: GRID_SIZE }, (_, i) => (
                  <CardFace key={i} rank={state.players[player].grid[i].card.rank} size="xs" />
                ))}
              </span>
              <span className="scoreline__score">{score}</span>
              {settings.showScoreBreakdown && (
                <ScoreWorking ranks={state.players[player].grid.map((g) => g.card.rank)} />
              )}
            </li>
          ))}
        </ol>

        {match && (
          <div className="standings" data-testid="standings">
            <h3 className="standings__title">
              {match.isOver ? 'Final match standings' : 'Match standings'}
            </h3>
            <ol className="standings__list">
              {match.totalsBefore
                .map((before, player) => ({ total: before + scores[player], player }))
                .sort((a, b) => a.total - b.total || a.player - b.player)
                .map(({ total, player }) => (
                  <li key={player} data-testid="standing" data-player={player} data-total={total}>
                    <span>{playerName(player, names)}</span>
                    <strong>{total}</strong>
                  </li>
                ))}
            </ol>
          </div>
        )}

        <button type="button" className="btn btn--primary" onClick={onNewGame}>
          {match ? (match.isOver ? 'New match' : 'Next round') : 'Deal a new round'}
        </button>
      </div>
    </div>
  );
}

/**
 * How a hand reached its score.
 *
 * Derived from scoreBreakdown, which is the same code path that awards the
 * score, so this can never explain a total the player was not given.
 */
function ScoreWorking({ ranks }: { ranks: number[] }) {
  const b = scoreBreakdown(ranks as Parameters<typeof scoreBreakdown>[0]);
  if (!b.valid) return null;

  return (
    <div className="working" data-testid="score-working">
      <ul className="working__cols">
        {b.columns.map((c) => (
          <li key={c.col} className={c.cancelled ? 'working__col working__col--zero' : 'working__col'}>
            <span className="working__label">Col {c.col + 1}</span>
            <span className="working__detail">
              {c.cancelled
                ? `${rankLabel(c.top)} pair cancels`
                : [
                    c.topIsZero ? `${rankLabel(c.top)} counts 0` : `${c.top}`,
                    c.bottomIsZero ? `${rankLabel(c.bottom)} counts 0` : `${c.bottom}`,
                  ].join(' + ')}
            </span>
            <span className="working__points">{c.points}</span>
          </li>
        ))}
      </ul>
      <p className="working__totals">
        Columns add to <strong>{b.base}</strong>
        {b.squares.length > 0 && (
          <>
            {'; '}
            {b.squares.length === 1 ? 'a square' : `${b.squares.length} squares`} of{' '}
            {b.squares.map((sq) => rankLabel(sq.rank)).join(' and ')} take off{' '}
            <strong>{-b.squareBonus}</strong>
          </>
        )}
        {'. Total '}
        <strong>{b.total}</strong>.
      </p>
    </div>
  );
}
