import { GRID_SIZE } from '../engine/cards';
import type { Card } from '../engine/cards';
import { CardFace, CardSlotEmpty } from './CardFace';
import { DiscardFan } from './HumanArea';
import { spotName, visibleRanks, type ObservedGrid } from './format';

interface Props {
  player: number;
  /** Display name of the opponent seated here, chosen from the roster. */
  name: string;
  /** One-line description of how this opponent plays. */
  blurb?: string;
  /** One-word strength label, e.g. "Steady". Exact ratings live in setup. */
  tier?: string;
  /**
   * What this opponent is holding right now, as the human may see it.
   * `null` when they hold nothing; `{ card: null }` when they hold something
   * drawn blind, whose rank nobody else is entitled to know.
   */
  held?: { card: Card | null } | null;
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
  name,
  blurb,
  tier,
  held,
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
      aria-label={`${name}'s play area`}
    >
      <header className="seat__head">
        <h3 className="seat__name">
          {name}
          {tier && (
            <span className="badge badge--tier" title={blurb}>
              {tier}
            </span>
          )}
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

      {held && (
        <div className="seat__held" data-testid="opponent-held">
          <span className="mini-label">in hand</span>
          {/* A null rank renders a back and keeps the rank out of the DOM
              entirely, which is exactly what a blind pile draw needs. */}
          <CardFace rank={held.card?.rank ?? null} size="sm" />
        </div>
      )}
      <div className="grid grid--sm" role="group" aria-label={`${name}'s ten cards`}>
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
            aria-label={`Draw the ${top.rank === 13 ? 'Skip-Bo' : top.rank} from ${name}'s discard pile`}
          >
            <DiscardFan cards={discardTop3} />
            <span className="pile-btn__cta">take</span>
          </button>
        ) : discardTop3.length > 0 ? (
          <div className="pile-static">
            <DiscardFan cards={discardTop3} />
          </div>
        ) : (
          // Kept short: the caption below already reads "Discard (0)", and a
          // longer word does not fit inside the small placeholder.
          <CardSlotEmpty size="sm" label="none" />
        )}
        <span className="mini-label mini-label--center">discard ({discardCount})</span>
      </div>
    </section>
  );
}
