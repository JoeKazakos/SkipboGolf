import { GRID_SIZE } from '../engine/cards';
import type { Card } from '../engine/cards';
import { CardFace, CardSlotEmpty } from './CardFace';
import { DiscardFan } from './HumanArea';
import { playerName, spotName, visibleRanks, type ObservedGrid } from './format';

interface Props {
  player: number;
  grid: ObservedGrid;
  discardTop3: readonly Card[];
  discardCount: number;
  isCurrent: boolean;
  isThinking: boolean;
  triggered: boolean;
  /** True when the human may take this pile's top card right now. */
  drawable: boolean;
  hinted: boolean;
  onDraw: (player: number) => void;
}

export function OpponentSeat({
  player,
  grid,
  discardTop3,
  discardCount,
  isCurrent,
  isThinking,
  triggered,
  drawable,
  hinted,
  onDraw,
}: Props) {
  const ranks = visibleRanks(grid);
  const faceUp = ranks.filter((r) => r != null).length;
  const top = discardTop3[discardTop3.length - 1];

  return (
    <section
      className={`seat seat--opponent ${isCurrent ? 'seat--active' : ''}`}
      aria-label={`${playerName(player)}'s play area`}
    >
      <header className="seat__head">
        <h3 className="seat__name">
          {playerName(player)}
          {triggered && (
            <span className="badge badge--trigger" title="Triggered the end of the round">
              closed
            </span>
          )}
        </h3>
        <span className="seat__meta">
          {isThinking ? <span className="thinking">thinking…</span> : `${faceUp}/10 up`}
        </span>
      </header>

      <div className="grid grid--sm" role="group" aria-label={`${playerName(player)}'s ten cards`}>
        {Array.from({ length: GRID_SIZE }, (_, i) => (
          <div key={i} className="spot spot--static" role="img" aria-label={spotName(i)}>
            <CardFace rank={ranks[i]} size="sm" />
          </div>
        ))}
      </div>

      <div className="seat__discard">
        {drawable && top ? (
          <button
            type="button"
            className={`pile-btn ${hinted ? 'pile-btn--hint' : ''}`}
            onClick={() => onDraw(player)}
            aria-label={`Draw the ${top.rank === 13 ? 'Skip-Bo' : top.rank} from ${playerName(player)}'s discard pile`}
          >
            <DiscardFan cards={discardTop3} />
            <span className="pile-btn__cta">take</span>
          </button>
        ) : discardTop3.length > 0 ? (
          <div className="pile-static">
            <DiscardFan cards={discardTop3} />
          </div>
        ) : (
          <CardSlotEmpty size="sm" label="no discards" />
        )}
        <span className="mini-label mini-label--center">discard ({discardCount})</span>
      </div>
    </section>
  );
}
