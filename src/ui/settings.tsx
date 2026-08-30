import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
}

export const DEFAULT_SETTINGS: Settings = {
  showScoreBreakdown: true,
  animateCards: true,
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
            checked={settings.animateCards}
            onChange={(e) => set('animateCards', e.target.checked)}
          />
          <span>
            <strong>Animate cards</strong>
            <small>Move cards between the piles and the grid instead of jumping.</small>
          </span>
        </label>

        <button type="button" className="btn btn--start" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
