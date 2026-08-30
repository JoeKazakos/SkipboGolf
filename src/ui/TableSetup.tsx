import { useState } from 'react';
import { RulesPanel } from './RulesPanel';
import { SettingsPanel } from './settings';
import { DEFAULT_ROUNDS, ROUND_OPTIONS } from './match';
import {
  DEFAULT_OPPONENTS,
  DEFAULT_PRESET_ID,
  MAX_OPPONENTS,
  MIN_OPPONENTS,
  PRESETS,
  ROSTER,
  presetSeats,
  profileById,
  type OpponentProfile,
} from '../ai/roster';

/**
 * Strength as five pips plus a word.
 *
 * This is what the setup screen shows: an ordering is what a player actually
 * needs, and the exact ratings live in the details panel for anyone who wants
 * them.
 */
function StrengthMeter({ profile }: { profile: OpponentProfile }) {
  return (
    <span
      className="strength"
      title={`${profile.tier} — strength ${profile.strength} of 5`}
      aria-label={`${profile.tier}, strength ${profile.strength} of 5`}
    >
      <span className="strength__pips" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`pip ${n <= profile.strength ? 'pip--on' : ''}`} />
        ))}
      </span>
      <span className="strength__tier">{profile.tier}</span>
    </span>
  );
}

/** The measured ladder, tucked behind a disclosure for anyone who wants it. */
function RatingDetails() {
  return (
    <details className="details">
      <summary className="details__summary">How these opponents were rated</summary>
      <div className="details__body">
        <p>
          Every opponent played a self-play ladder against the others (120 games, about 103
          each) and the finishing order was fitted to an Elo scale. Lower mean score is
          better. These ratings are only comparable to each other, not to a human rating.
        </p>
        <table className="ladder">
          <thead>
            <tr>
              <th scope="col">Opponent</th>
              <th scope="col">Elo</th>
              <th scope="col">Mean score</th>
              <th scope="col">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {[...ROSTER].reverse().map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.name}</th>
                <td>
                  {p.elo == null ? (
                    'unrated'
                  ) : (
                    <>
                      {p.elo}
                      {p.eloError != null && <span className="ladder__err"> ±{p.eloError}</span>}
                    </>
                  )}
                </td>
                <td>{p.meanScore == null ? '—' : p.meanScore.toFixed(2)}</td>
                <td>{p.winRate == null ? '—' : `${Math.round(p.winRate * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="details__caveat">
          Read the error bars before trusting a gap. The four searching opponents sit within
          about 90 Elo of each other with error bars near 30, so Rook and Ada are not really
          distinguishable — they share a strength band here for that reason. The clear steps
          are the ones below Nel.
        </p>
      </div>
    </details>
  );
}

export interface TableSetupProps {
  /** Called with one profile id per opponent seat, and the match length. */
  onStart: (seats: string[], rounds: number) => void;
  initialSeats?: readonly string[];
}

export function TableSetup({ onStart, initialSeats }: TableSetupProps) {
  const [seats, setSeats] = useState<string[]>(() =>
    initialSeats ? [...initialSeats] : presetSeats(DEFAULT_PRESET_ID, DEFAULT_OPPONENTS),
  );
  const [presetId, setPresetId] = useState<string | null>(DEFAULT_PRESET_ID);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rounds, setRounds] = useState<number>(DEFAULT_ROUNDS);

  const applyPreset = (id: string) => {
    setPresetId(id);
    setSeats(presetSeats(id, seats.length));
  };

  /**
   * Changing the table size keeps the seats you already chose and only adds or
   * removes from the end, so setting a count after picking opponents does not
   * throw that choice away.
   */
  const setCount = (count: number) => {
    setSeats((prev) => {
      if (count <= prev.length) return prev.slice(0, count);
      const filler = presetSeats(presetId ?? DEFAULT_PRESET_ID, count);
      return [...prev, ...filler.slice(prev.length, count)];
    });
  };

  const setSeat = (index: number, profileId: string) => {
    setSeats((prev) => {
      const next = [...prev];
      next[index] = profileId;
      return next;
    });
    setPresetId(null); // no longer a pristine preset
  };

  return (
    <div className="setup">
      <header className="setup__head">
        <h1 className="setup__title">Skip-Bo Golf</h1>
        <p className="setup__sub">Choose who you are playing against.</p>
        <button type="button" className="btn btn--ghost" onClick={() => setShowRules(true)}>
          How to play
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </header>

      {showRules && <RulesPanel onClose={() => setShowRules(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <section className="setup__section" aria-labelledby="count-heading">
        <h2 className="setup__heading" id="count-heading">
          How many opponents
        </h2>
        <div className="count-row" role="group" aria-label="Number of opponents">
          {Array.from({ length: MAX_OPPONENTS - MIN_OPPONENTS + 1 }, (_, i) => i + MIN_OPPONENTS).map(
            (n) => (
              <button
                key={n}
                type="button"
                className={`count-btn ${seats.length === n ? 'count-btn--on' : ''}`}
                aria-pressed={seats.length === n}
                aria-label={`${n} opponent${n === 1 ? '' : 's'}`}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ),
          )}
          <span className="count-note">
            {seats.length + 1} players at the table, including you
          </span>
        </div>
      </section>

      <section className="setup__section" aria-labelledby="rounds-heading">
        <h2 className="setup__heading" id="rounds-heading">
          How many rounds
        </h2>
        <div className="count-row" role="group" aria-label="Number of rounds">
          {ROUND_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={`count-btn ${rounds === n ? 'count-btn--on' : ''}`}
              aria-pressed={rounds === n}
              aria-label={`${n} round${n === 1 ? '' : 's'}`}
              onClick={() => setRounds(n)}
            >
              {n}
            </button>
          ))}
          <span className="count-note">
            {rounds === 1
              ? 'One round, exactly as the rules describe'
              : `Lowest total across ${rounds} rounds wins`}
          </span>
        </div>
      </section>

      <section className="setup__section" aria-labelledby="preset-heading">
        <h2 className="setup__heading" id="preset-heading">
          Pick a table
        </h2>
        <div className="preset-row">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`preset ${presetId === preset.id ? 'preset--on' : ''}`}
              onClick={() => applyPreset(preset.id)}
            >
              <span className="preset__name">{preset.name}</span>
              <span className="preset__desc">{preset.description(seats.length)}</span>
            </button>
          ))}
        </div>
      </section>

      <button type="button" className="btn btn--start" onClick={() => onStart(seats, rounds)}>
        {rounds === 1 ? 'Deal the round' : 'Start the match'}
      </button>

      <details className="setup__more">
        <summary className="setup__more-summary">Set each seat yourself</summary>
        <section className="setup__section" aria-labelledby="seats-heading">
          <h2 className="setup__heading" id="seats-heading">
            Or set each seat
          </h2>
          <ul className="seat-list">
            {seats.map((profileId, i) => {
              const profile = profileById(profileId);
              return (
                <li className="seat-row" key={i}>
                  <span className="seat-row__index">Seat {i + 1}</span>
                  <label className="seat-row__pick">
                    <span className="visually-hidden">Opponent in seat {i + 1}</span>
                    <select
                      value={profileId}
                      onChange={(e) => setSeat(i, e.target.value)}
                      aria-label={`Opponent in seat ${i + 1}`}
                    >
                      {ROSTER.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {p.tier}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="seat-row__blurb">{profile.blurb}</span>
                  <StrengthMeter profile={profile} />
                </li>
              );
            })}
          </ul>
        </section>

      </details>

      <RatingDetails />
    </div>
  );
}
