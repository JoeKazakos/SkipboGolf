import { useProfiles } from './ProfilesContext';
import { fitRating, nearestTier, ratingHistory, PROVISIONAL_GAMES } from './rating';
import { ROSTER, profileById } from '../ai/roster';

/** The span the measured opponents occupy, which is the useful part of the axis. */
const ROSTER_RANGE = ROSTER.map((p) => p.elo).filter((e): e is number => e != null);

/**
 * When a round was played, as date over time.
 *
 * Stacked rather than run together so the row stays narrow enough for a phone,
 * and rendered in the viewer's locale rather than a fixed format.
 */
function PlayedAt({ at }: { at: string }) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) {
    // A record written by a different version, or hand-edited storage.
    return <span className="record__date">unknown</span>;
  }
  return (
    <span className="record__date">
      <span>{when.toLocaleDateString()}</span>
      <small data-testid="record-time">
        {when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </small>
    </span>
  );
}

/** A short opponent name, tolerating a profile that no longer exists. */
function seatName(id: string): string {
  try {
    return profileById(id).name;
  } catch {
    return id;
  }
}

/**
 * Rating over time, with its uncertainty.
 *
 * The band matters as much as the line: a rating that moved forty points while
 * carrying a ninety-point error bar has not really moved, and a bare line would
 * imply that it had.
 */
/**
 * Error above which a point is too vague to plot.
 *
 * A fit from one or two rounds can carry thousands of Elo of uncertainty - a
 * record of all wins or all losses has no finite maximum and pegs to the
 * search bounds. Plotting those made the axis run from -3730 to 4500 and the
 * real movement invisible. They are not wrong, just useless to draw.
 */
const CHART_MAX_ERROR = 400;

function RatingChart({ points: all }: { points: { rating: number; error: number }[] }) {
  const points = all.filter((p) => p.error <= CHART_MAX_ERROR);
  if (points.length < 2) return null;

  const width = 520;
  const height = 150;
  const pad = { left: 40, right: 10, top: 10, bottom: 20 };

  const lows = points.map((p) => p.rating - p.error);
  const highs = points.map((p) => p.rating + p.error);
  // Keep the axis inside the range the ratings actually live in, so a wide
  // early band cannot flatten everything that follows into a straight line.
  const floor = Math.min(...ROSTER_RANGE) - 200;
  const ceiling = Math.max(...ROSTER_RANGE) + 200;
  const min = Math.max(floor, Math.min(...lows));
  const max = Math.min(ceiling, Math.max(...highs));
  const span = Math.max(1, max - min);

  const x = (i: number) =>
    pad.left + (i / (points.length - 1)) * (width - pad.left - pad.right);
  // Clamped, so a band wider than the axis is drawn to the edge rather than
  // off the canvas.
  const y = (v: number) => {
    const clamped = Math.max(min, Math.min(max, v));
    return pad.top + (1 - (clamped - min) / span) * (height - pad.top - pad.bottom);
  };

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.rating)}`).join(' ');

  /**
   * The opponents, drawn as reference lines.
   *
   * A rating means nothing on its own; what a player wants to know is "am I
   * past Nel yet?". Only rated profiles inside the visible band are drawn, and
   * near-identical tiers are collapsed so their labels do not overlap.
   */
  const refs: { elo: number; label: string }[] = [];
  for (const profile of ROSTER) {
    const elo = profile.elo;
    if (elo == null || elo < min || elo > max) continue;
    const near = refs.find((r) => Math.abs(r.elo - elo) < span * 0.07);
    if (near) near.label += `, ${profile.name}`;
    else refs.push({ elo, label: profile.name });
  }
  const upper = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.rating + p.error)}`);
  const lower = [];
  for (let i = points.length - 1; i >= 0; i--) {
    lower.push(`L${x(i)},${y(points[i].rating - points[i].error)}`);
  }
  const band = `${upper.join(' ')} ${lower.join(' ')} Z`;

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={
        `Rating over ${points.length} games, currently ${points[points.length - 1].rating} ` +
        `give or take ${points[points.length - 1].error}. ` +
        (refs.length
          ? `Shown against ${refs.map((r) => `${r.label} at ${r.elo}`).join(', ')}.`
          : '')
      }
      data-testid="rating-chart"
    >
      <path className="chart__band" d={band} />
      {refs.map((r) => (
        <g key={r.label} className="chart__ref">
          <line x1={pad.left} x2={width - pad.right} y1={y(r.elo)} y2={y(r.elo)} />
          <text x={width - pad.right} y={y(r.elo) - 3} textAnchor="end">
            {r.label}
          </text>
        </g>
      ))}
      <path className="chart__line" d={line} />
      <text className="chart__tick" x={4} y={y(max) + 4}>
        {Math.round(max)}
      </text>
      <text className="chart__tick" x={4} y={y(min) + 4}>
        {Math.round(min)}
      </text>
    </svg>
  );
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { active, games } = useProfiles();
  const current = fitRating(games);
  const history = ratingHistory(games).filter(
    (r): r is typeof r & { rating: number; error: number } =>
      r.rating != null && r.error != null,
  );

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Your record"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-card panel-card--wide" data-testid="history-panel">
        <h2 className="panel-card__title">{active ? `${active.name}'s record` : 'Your record'}</h2>

        {games.length === 0 ? (
          <p className="rules__lede">
            No games recorded yet. Pick or create a player on the setup screen, and finished
            rounds will be tracked here.
          </p>
        ) : (
          <>
            <div className="record" data-testid="record-summary">
              <div className="record__cell">
                <span className="record__label">Rating</span>
                {current.rating == null ? (
                  <strong className="record__value">—</strong>
                ) : current.provisional ? (
                  <strong className="record__value" data-testid="rating-value">
                    ~{nearestTier(current.rating)}
                    <small> (provisional)</small>
                  </strong>
                ) : (
                  <strong className="record__value" data-testid="rating-value">
                    {current.rating}
                    <small> ±{current.error}</small>
                  </strong>
                )}
              </div>
              <div className="record__cell">
                <span className="record__label">Rounds</span>
                <strong className="record__value">{current.games}</strong>
              </div>
              <div className="record__cell">
                <span className="record__label">Comparisons</span>
                <strong className="record__value">{current.comparisons}</strong>
              </div>
            </div>

            {current.provisional && (
              <p className="record__note">
                Still settling. A rating is quoted as a number after{' '}
                {PROVISIONAL_GAMES} rounds; until then it is shown as the opponent you are
                closest to. A six-player round counts as five comparisons, so this comes
                round faster than it sounds.
              </p>
            )}

            <RatingChart points={history} />
            {history.length >= 2 &&
              history.filter((h) => h.error <= CHART_MAX_ERROR).length < 2 && (
                <p className="record__note" data-testid="chart-pending">
                  Not enough rounds yet to draw a useful curve. The early fits carry
                  hundreds of points of uncertainty, so the chart appears once they settle.
                </p>
              )}

            <h3 className="standings__title">Every round</h3>
            <ol className="record__list" data-testid="game-list">
              {games
                .map((g, i) => ({ g, i }))
                .reverse()
                .map(({ g, i }) => {
                  const mine = g.scores[0];
                  const place =
                    g.scores.filter((s) => s < mine).length + 1;
                  const before = i > 0 ? history[i - 1] : null;
                  const now = history[i];
                  const delta =
                    before && now ? Math.round(now.rating - before.rating) : null;
                  return (
                    <li key={i} className="record__row" data-testid="game-row">
                      <PlayedAt at={g.at} />
                      <span className="record__vs">
                        vs {g.seats.map(seatName).join(', ')}
                      </span>
                      <span className="record__score">
                        {mine} · {place}
                        {place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'}
                      </span>
                      <span
                        className={`record__delta ${
                          delta == null ? '' : delta < 0 ? 'record__delta--down' : 'record__delta--up'
                        }`}
                      >
                        {delta == null ? '—' : delta > 0 ? `+${delta}` : delta}
                      </span>
                    </li>
                  );
                })}
            </ol>
          </>
        )}

        <button type="button" className="btn btn--start" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
