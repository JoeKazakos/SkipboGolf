import { GRID_SIZE } from '../engine/cards';
import { returns } from '../engine/state';
import type { GameState } from '../engine/types';
import { CardFace } from './CardFace';
import { HUMAN, playerName, type SeatNames } from './format';

/**
 * The end-of-round scorecard. Every hand is face up at this point (section 15.6)
 * so all ten cards of every player are shown.
 */
export function GameOver({
  state,
  names,
  onNewGame,
}: {
  state: GameState;
  names: SeatNames;
  onNewGame: () => void;
}) {
  const scores = returns(state);
  const best = Math.min(...scores);
  const winners = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
  const humanWon = winners.includes(HUMAN);

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
        <h2 className="scorecard__title">Round over</h2>
        <p className="scorecard__winner" data-testid="winner">
          {humanWon ? 'You win! ' : ''}
          {winnerText}
        </p>
        <p className="scorecard__sub">Lowest score wins.</p>

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
              <span className="scoreline__name">{playerName(player)}</span>
              <span className="scoreline__grid" aria-hidden="true">
                {Array.from({ length: GRID_SIZE }, (_, i) => (
                  <CardFace key={i} rank={state.players[player].grid[i].card.rank} size="xs" />
                ))}
              </span>
              <span className="scoreline__score">{score}</span>
            </li>
          ))}
        </ol>

        <button type="button" className="btn btn--primary" onClick={onNewGame}>
          Deal a new round
        </button>
      </div>
    </div>
  );
}
