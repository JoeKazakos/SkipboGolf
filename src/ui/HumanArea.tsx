import { GRID_SIZE } from '../engine/cards';
import type { Card } from '../engine/cards';
import { CardFace, CardSlotEmpty } from './CardFace';
import { useChangeFlash } from './useChangeFlash';
import {
  playerName,
  rankLabel,
  runningScore,
  spotLabel,
  spotName,
  visibleRanks,
  type ObservedGrid,
} from './format';

interface Props {
  grid: ObservedGrid;
  discardTop3: readonly Card[];
  discardCount: number;
  held: Card | null;
  phase: 'draw' | 'act';
  isMyTurn: boolean;
  locked: readonly boolean[];
  legalSpots: ReadonlySet<number>;
  canDiscard: boolean;
  /** True when there is something to take back this turn. */
  canUndo?: boolean;
  onUndo?: () => void;
  hintSpot: number | null;
  onPlace: (spot: number) => void;
  onDiscard: () => void;
}

function spotStateLabel(
  i: number,
  rank: number | null,
  locked: boolean,
  legal: boolean,
  interactive: boolean,
): string {
  const where = spotName(i);
  const what = rank == null ? 'face down' : `rank ${rankLabel(rank)}`;
  if (!interactive) return `${where}, ${what}`;
  if (locked) return `${where}, ${what}, locked — already played this turn`;
  if (legal) return `${where}, ${what}, play here`;
  return `${where}, ${what}, not a legal wave`;
}

export function HumanArea({
  grid,
  discardTop3,
  discardCount,
  held,
  phase,
  isMyTurn,
  locked,
  legalSpots,
  canDiscard,
  canUndo,
  hintSpot,
  onPlace,
  onDiscard,
  onUndo,
}: Props) {
  const ranks = visibleRanks(grid);
  const moved = useChangeFlash(ranks);
  const { score, hiddenColumns } = runningScore(ranks);
  const interactive = isMyTurn && phase === 'act';

  return (
    <section
      className={`seat seat--human ${isMyTurn ? 'seat--active' : ''}`}
      aria-label="Your play area"
    >
      <header className="seat__head">
        <h2 className="seat__name">{playerName(0)}</h2>
        <p className="seat__score" data-testid="running-score">
          Score so far <strong>{score}</strong>
          {hiddenColumns > 0 && (
            <span className="seat__score-note">
              {' '}
              ({hiddenColumns} column{hiddenColumns === 1 ? '' : 's'} still hidden)
            </span>
          )}
        </p>
      </header>

      <div className="human-body">
        <div className="grid grid--lg" role="group" aria-label="Your ten cards">
          {Array.from({ length: GRID_SIZE }, (_, i) => {
            const rank = ranks[i];
            const isLocked = interactive && locked[i];
            const isLegal = interactive && legalSpots.has(i);
            const isHint = hintSpot === i;
            const classes = [
              'spot',
              isLocked ? 'spot--locked' : '',
              isLegal ? 'spot--legal' : '',
              interactive && !isLegal && !isLocked ? 'spot--illegal' : '',
              isHint ? 'spot--hint' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const label = spotStateLabel(i, rank, !!isLocked, isLegal, interactive);

            if (!interactive) {
              return (
                <div key={i} className={classes} aria-label={label} role="img">
                  <CardFace
                  rank={rank}
                  size="lg"
                  className={moved.has(i) ? 'card--moved' : ''}
                />
                  <span className="spot__coord" aria-hidden="true">
                    {spotLabel(i)}
                  </span>
                </div>
              );
            }

            return (
              <button
                key={i}
                type="button"
                className={classes}
                aria-label={label}
                disabled={!isLegal}
                data-locked={isLocked ? 'true' : 'false'}
                data-legal={isLegal ? 'true' : 'false'}
                onClick={() => onPlace(i)}
              >
                <CardFace
                  rank={rank}
                  size="lg"
                  className={moved.has(i) ? 'card--moved' : ''}
                />
                <span className="spot__coord" aria-hidden="true">
                  {spotLabel(i)}
                </span>
                {isLocked && (
                  <span className="spot__lock" aria-hidden="true">
                    locked
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <aside className="human-side">
          <div className="held" aria-live="polite">
            <span className="mini-label">Holding</span>
            {held ? (
              <CardFace rank={held.rank} size="lg" className="card--held" />
            ) : (
              <CardSlotEmpty size="lg" label="—" />
            )}
          </div>
          <button
            type="button"
            className="btn btn--discard"
            disabled={!canDiscard}
            onClick={onDiscard}
          >
            Discard &amp; end turn
          </button>
          {onUndo && (
            <button
              type="button"
              className="btn btn--undo"
              disabled={!canUndo}
              onClick={onUndo}
              title="Take back everything you have done this turn"
            >
              Undo turn
            </button>
          )}
          <div className="own-discard">
            <span className="mini-label">Your discard ({discardCount})</span>
            <DiscardFan cards={discardTop3} />
          </div>
        </aside>
      </div>
    </section>
  );
}

export function DiscardFan({ cards, size = 'sm' }: { cards: readonly Card[]; size?: 'sm' | 'md' }) {
  if (cards.length === 0) {
    return <CardSlotEmpty size={size} label="empty" />;
  }
  // `cards` is bottom-to-top; render so the top card sits in front.
  return (
    <div className="fan">
      {cards.map((c, i) => (
        <CardFace
          key={c.id}
          rank={c.rank}
          size={size}
          className={i === cards.length - 1 ? 'fan__top' : 'fan__under'}
        />
      ))}
    </div>
  );
}
