import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useProfiles } from './ProfilesContext';
import { HistoryPanel } from './HistoryPanel';
import type { ReactNode } from 'react';

/**
 * Player preferences.
 *
 * One home for every toggle, rather than switches accumulating in the top bar.
 * Stored per browser; nothing here affects the rules or the engine.
 */
export interface Settings {
  /** Show how a hand scored on the round-over card. */
  showScoreBreakdown: boolean;
  /** Animate cards moving between the piles, the hand and the grid. */
  animateCards: boolean;
  /**
   * Shrink everything so the whole table fits one screen without scrolling.
   *
   * On a phone the board is taller than the viewport, so following the round
   * means scrolling between your own hand and the opponents you are racing.
   * This trades card size for seeing all of it at once, which is the trade
   * worth having while a round is actually being played.
   */
  compactBoard: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  // Off by default: most people know how to score, and the working is a wall
  // of text on a card they mostly want to glance at. It is one tap away on
  // the scorecard itself for anyone who wants it.
  showScoreBreakdown: false,
  animateCards: true,
  // Off by default: on a desktop there is room for the full-size board, and
  // shrinking it there would only make the cards harder to read for no gain.
  compactBoard: false,
};

const STORAGE_KEY = 'skipbo-golf.settings.v1';

/**
 * Reads stored settings, falling back to defaults on anything unexpected.
 *
 * Storage can be unavailable (private windows, blocked site data) and can hold
 * a blob written by an older version, so every read is defensive: an unknown
 * or malformed value must never stop the game loading.
 */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;
    const got = parsed as Partial<Record<keyof Settings, unknown>>;
    return {
      showScoreBreakdown:
        typeof got.showScoreBreakdown === 'boolean'
          ? got.showScoreBreakdown
          : DEFAULT_SETTINGS.showScoreBreakdown,
      compactBoard:
        typeof got.compactBoard === 'boolean' ? got.compactBoard : DEFAULT_SETTINGS.compactBoard,
      animateCards:
        typeof got.animateCards === 'boolean'
          ? got.animateCards
          : DEFAULT_SETTINGS.animateCards,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage being unavailable is not worth interrupting a game over.
  }
}

interface SettingsContextValue {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  set: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  }, []);

  // Expose the animation preference to CSS, so stylesheets can respond without
  // every component threading the flag down.
  useEffect(() => {
    document.documentElement.dataset.animate = settings.animateCards ? 'on' : 'off';
  }, [settings.animateCards]);

  const value = useMemo(() => ({ settings, set }), [settings, set]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

/**
 * Optional record-keeping.
 *
 * It lives here rather than in the setup flow deliberately. Nobody wants to
 * name themselves before their first game; this is something you go looking
 * for once you have played a few and want to know whether you are improving.
 */
function PlayerRecord() {
  const { store, active, add, choose, remove } = useProfiles();
  const [newName, setNewName] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const submit = () => {
    if (!newName.trim()) return;
    add(newName);
    setNewName('');
  };

  return (
    <details className="setting-group" data-testid="player-record">
      <summary className="setting-group__summary">Track your record</summary>
      <div className="setting-group__body">
        <p className="setting-group__note">
          Optional. Give yourself a name and finished rounds are recorded against it, with
          a rating measured on the same scale as the opponents. Nothing is recorded while
          nobody is selected.
        </p>
        <div className="player-row">
          <label className="visually-hidden" htmlFor="player-select">
            Player
          </label>
          <select
            id="player-select"
            value={active?.id ?? ''}
            onChange={(e) => choose(e.target.value || null)}
          >
            <option value="">Not tracked</option>
            {store.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            className="player-new"
            type="text"
            placeholder="Add a player"
            value={newName}
            aria-label="New player name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <button type="button" className="btn btn--ghost" disabled={!newName.trim()} onClick={submit}>
            Add
          </button>
          {active && (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setShowHistory(true)}>
                Record
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => remove(active.id)}
                aria-label={`Delete ${active.name}`}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}
    </details>
  );
}

/** The settings panel itself, shown as a dialog from the top bar. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, set } = useSettings();

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-card">
        <h2 className="panel-card__title">Settings</h2>

        <label className="setting">
          <input
            type="checkbox"
            checked={settings.showScoreBreakdown}
            onChange={(e) => set('showScoreBreakdown', e.target.checked)}
          />
          <span>
            <strong>Explain the final score</strong>
            <small>Show how each hand scored on the round-over card.</small>
          </span>
        </label>

        <label className="setting">
          <input
            type="checkbox"
            checked={settings.compactBoard}
            onChange={(e) => set('compactBoard', e.target.checked)}
          />
          <span>
            <strong>Fit the whole table on one screen</strong>
            <small>
              Smaller cards, everything visible at once without scrolling. Best on a phone,
              and better still turned sideways.
            </small>
          </span>
        </label>

        <label className="setting">
          <input
            type="checkbox"
            checked={settings.animateCards}
            onChange={(e) => set('animateCards', e.target.checked)}
          />
          <span>
            <strong>Animate cards</strong>
            <small>Move cards between the piles and the grid instead of jumping.</small>
          </span>
        </label>

        <PlayerRecord />

        <button type="button" className="btn btn--start" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
