import { useState } from 'react';
import {
  DEFAULT_PRESET_ID,
  PRESETS,
  ROSTER,
  presetById,
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
  /** Called with five profile ids, one per opponent seat. */
  onStart: (seats: string[]) => void;
  initialSeats?: readonly string[];
}

export function TableSetup({ onStart, initialSeats }: TableSetupProps) {
  const [seats, setSeats] = useState<string[]>(() =>
    initialSeats ? [...initialSeats] : [...presetById(DEFAULT_PRESET_ID).seats],
  );
  const [presetId, setPresetId] = useState<string | null>(DEFAULT_PRESET_ID);

  const applyPreset = (id: string) => {
    setPresetId(id);
    setSeats([...presetById(id).seats]);
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
      </header>

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
              <span className="preset__desc">{preset.description}</span>
            </button>
          ))}
        </div>
      </section>

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

      <button type="button" className="btn btn--start" onClick={() => onStart(seats)}>
        Deal the round
      </button>

      <RatingDetails />
    </div>
  );
}
