import { SPECIAL_RANKS, type Rank } from '../engine/cards';
import { rankAriaLabel, rankLabel } from './format';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

interface Props {
  /** null renders a face-down back; the rank is deliberately not in the DOM. */
  rank: number | null;
  size?: CardSize;
  /** Extra classes for state (legal / locked / selected). */
  className?: string;
}

/**
 * One card. A face-down card renders a patterned back and carries no rank text
 * or rank attribute anywhere in the DOM, so hidden information cannot leak
 * through the markup.
 */
export function CardFace({ rank, size = 'md', className = '' }: Props) {
  if (rank == null) {
    return (
      <div
        className={`card card--${size} card--back ${className}`}
        data-facedown="true"
        role="img"
        aria-label="Face-down card"
      >
        <span className="card__pattern" aria-hidden="true" />
      </div>
    );
  }

  const special = SPECIAL_RANKS.has(rank as Rank);
  const label = rankLabel(rank);

  return (
    <div
      className={`card card--${size} card--face ${special ? 'card--special' : ''} ${className}`}
      data-facedown="false"
      data-rank={rank}
      role="img"
      aria-label={rankAriaLabel(rank)}
    >
      <span className="card__corner card__corner--tl" aria-hidden="true">
        {label}
      </span>
      <span className="card__pip">{label}</span>
      <span className="card__corner card__corner--br" aria-hidden="true">
        {label}
      </span>
      {special && (
        <span className="card__zero" aria-hidden="true" title="Counts as 0 when scoring">
          0
        </span>
      )}
    </div>
  );
}

/** An empty outline where a card could be but is not. */
export function CardSlotEmpty({ size = 'md', label }: { size?: CardSize; label?: string }) {
  return (
    <div className={`card card--${size} card--empty`} role="img" aria-label={label ?? 'Empty'}>
      {label && <span className="card__empty-label">{label}</span>}
    </div>
  );
}
