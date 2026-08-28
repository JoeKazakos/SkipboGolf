import type { Card } from '../engine/cards';
import { CardFace, CardSlotEmpty } from './CardFace';
import { rankLabel } from './format';

interface Props {
  centerCard: Card | null;
  drawPileCount: number;
  canDrawCenter: boolean;
  canDrawPile: boolean;
  hintedSource: 'center' | 'pile' | null;
  onDrawCenter: () => void;
  onDrawPile: () => void;
}

/**
 * The two shared draw sources. The centre card exists only once per round and is
 * never replaced once taken (section 15.10), so its slot goes empty afterwards.
 */
export function DrawSources({
  centerCard,
  drawPileCount,
  canDrawCenter,
  canDrawPile,
  hintedSource,
  onDrawCenter,
  onDrawPile,
}: Props) {
  return (
    <div className="draw-sources" aria-label="Shared draw sources">
      <div className="draw-source">
        <span className="mini-label mini-label--center">Centre card</span>
        {centerCard == null ? (
          <CardSlotEmpty size="md" label="taken" />
        ) : canDrawCenter ? (
          <button
            type="button"
            className={`pile-btn ${hintedSource === 'center' ? 'pile-btn--hint' : ''}`}
            onClick={onDrawCenter}
            aria-label={`Draw the centre card, ${rankLabel(centerCard.rank)}`}
          >
            <CardFace rank={centerCard.rank} size="md" />
            <span className="pile-btn__cta">take</span>
          </button>
        ) : (
          <div className="pile-static">
            <CardFace rank={centerCard.rank} size="md" />
          </div>
        )}
      </div>

      <div className="draw-source">
        <span className="mini-label mini-label--center">Draw pile</span>
        {canDrawPile ? (
          <button
            type="button"
            className={`pile-btn ${hintedSource === 'pile' ? 'pile-btn--hint' : ''}`}
            onClick={onDrawPile}
            aria-label="Draw from the face-down draw pile"
          >
            <span className="deck">
              <CardFace rank={null} size="md" />
            </span>
            <span className="pile-btn__cta">draw</span>
          </button>
        ) : (
          <div className="pile-static">
            <span className="deck">
              <CardFace rank={null} size="md" />
            </span>
          </div>
        )}
        <span className="pile-count">{drawPileCount} left</span>
      </div>
    </div>
  );
}
