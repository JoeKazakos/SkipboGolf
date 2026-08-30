import { CardFace } from './CardFace';

/**
 * A short, player-facing explanation of how to play.
 *
 * Deliberately not the whole of game-description.md, which is the canonical
 * reference and includes a clarifications section written for implementers.
 * This covers what someone needs at the table: the turn, the wave, and how
 * scoring works. Keep it short enough that drift from the rules document is
 * obvious on sight; game-description.md notes that this exists.
 */
export function RulesPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="How to play"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-card panel-card--wide" data-testid="rules-panel">
        <h2 className="panel-card__title">How to play</h2>

        <p className="rules__lede">
          You have ten cards in five columns of two. Three start face up. The lowest score
          wins, so you want matching columns and low cards.
        </p>

        <section className="rules__section">
          <h3>Your turn</h3>
          <ol className="rules__steps">
            <li>
              <strong>Take a card</strong> from the centre card, the face-down draw pile, or
              the top of another player&rsquo;s discard pile. Never your own.
            </li>
            <li>
              <strong>Place it</strong> into any spot in your grid, if you want to. Whatever
              was there comes into your hand, and that spot is locked for the rest of the
              turn.
            </li>
            <li>
              <strong>Wave</strong> as many times as you like, then{' '}
              <strong>discard</strong> to end your turn.
            </li>
          </ol>
        </section>

        <section className="rules__section">
          <h3>The wave</h3>
          <p>
            After your first placement, every further placement must be a wave. You may only
            wave a card into the spot <em>opposite a visible card of the same rank</em>, in
            that same column.
          </p>
          <div className="rules__example" aria-hidden="true">
            <div className="rules__col">
              <CardFace rank={3} size="sm" />
              <CardFace rank={null} size="sm" />
              <span className="rules__caption">a visible 3, hidden below</span>
            </div>
            <span className="rules__arrow">→</span>
            <div className="rules__col">
              <CardFace rank={3} size="sm" />
              <CardFace rank={3} size="sm" />
              <span className="rules__caption">wave a 3 in underneath</span>
            </div>
            <span className="rules__arrow">→</span>
            <div className="rules__col rules__col--single">
              <CardFace rank={7} size="sm" />
              <span className="rules__caption">the card it displaced is now in your hand</span>
            </div>
          </div>
          <p>
            If that displaced card matches another visible card, you may wave again, and keep
            chaining. A spot can only be played into <strong>once per turn</strong>, so a
            chain always ends.
          </p>
        </section>

        <section className="rules__section">
          <h3>Scoring</h3>
          <ul className="rules__list">
            <li>Add up your ten cards. Lowest total wins.</li>
            <li>
              A column whose two cards <strong>match</strong> scores <strong>0</strong>.
            </li>
            <li>
              <strong>7, 11 and Skip-Bo</strong> always count as <strong>0</strong>.
            </li>
            <li>
              Four of the same rank in a <strong>2&times;2 square</strong> takes off{' '}
              <strong>10</strong>. Squares are counted left to right and a column can only be
              used once.
            </li>
          </ul>
        </section>

        <section className="rules__section">
          <h3>Ending the round</h3>
          <p>
            The round ends when someone has all ten cards face up. Everyone else gets one
            final turn, then every hand is revealed and scored.
          </p>
        </section>

        <button type="button" className="btn btn--start" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
