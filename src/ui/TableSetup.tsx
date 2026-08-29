import { useState } from 'react';
import {
  DEFAULT_PRESET_ID,
  PRESETS,
  ROSTER,
  presetById,
  profileById,
  type OpponentProfile,
} from '../ai/roster';

/** Renders a profile's rating, or an honest placeholder when it has none. */
function EloTag({ profile }: { profile: OpponentProfile }) {
  if (profile.elo == null) return <span className="elo elo--unrated">unrated</span>;
  return (
    <span className="elo">
      {profile.elo}
      {profile.eloError != null && <span className="elo__err"> ±{profile.eloError}</span>}
    </span>
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
                        {p.name}
                        {p.elo == null ? '' : ` (${p.elo})`}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="seat-row__blurb">{profile.blurb}</span>
                <EloTag profile={profile} />
              </li>
            );
          })}
        </ul>
      </section>

      <button type="button" className="btn btn--start" onClick={() => onStart(seats)}>
        Deal the round
      </button>

      <p className="setup__note">
        Ratings come from self-play: every opponent plays a ladder against the others and the
        results are fitted to an Elo scale. They are only comparable to each other, not to a
        human rating.
      </p>
    </div>
  );
}
