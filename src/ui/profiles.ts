import type { PlayedGame } from './rating';

/**
 * Named local players, so several people sharing one browser do not pollute
 * each other's rating.
 *
 * Deliberately as light as possible: a name, and nothing else. No passwords,
 * no accounts. The id is generated and the name is only a label, so two people
 * may pick the same name without one overwriting the other.
 */

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProfileStore {
  profiles: Profile[];
  /** Id of the profile currently playing, if any. */
  activeId: string | null;
  /** Finished rounds, keyed by profile id. */
  games: Record<string, PlayedGame[]>;
}

const STORAGE_KEY = 'skipbo-golf.profiles.v1';

export const EMPTY_STORE: ProfileStore = { profiles: [], activeId: null, games: {} };

function newId(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Reads the store, tolerating anything unexpected rather than throwing. */
export function loadProfiles(): ProfileStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STORE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_STORE;
    const v = parsed as Partial<ProfileStore>;
    const profiles = Array.isArray(v.profiles)
      ? v.profiles.filter(
          (p): p is Profile =>
            typeof p?.id === 'string' && typeof p?.name === 'string',
        )
      : [];
    const games: Record<string, PlayedGame[]> = {};
    if (typeof v.games === 'object' && v.games !== null) {
      for (const [id, list] of Object.entries(v.games)) {
        if (!Array.isArray(list)) continue;
        games[id] = list.filter(
          (g): g is PlayedGame =>
            Array.isArray(g?.seats) && Array.isArray(g?.scores) && typeof g?.at === 'string',
        );
      }
    }
    const activeId =
      typeof v.activeId === 'string' && profiles.some((p) => p.id === v.activeId)
        ? v.activeId
        : null;
    return { profiles, activeId, games };
  } catch {
    return EMPTY_STORE;
  }
}

export function saveProfiles(store: ProfileStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable; play continues, nothing is recorded.
  }
}

export function addProfile(store: ProfileStore, name: string): ProfileStore {
  const trimmed = name.trim();
  if (!trimmed) return store;
  const profile: Profile = { id: newId(), name: trimmed, createdAt: new Date().toISOString() };
  return {
    ...store,
    profiles: [...store.profiles, profile],
    activeId: profile.id,
    games: { ...store.games, [profile.id]: [] },
  };
}

export function renameProfile(store: ProfileStore, id: string, name: string): ProfileStore {
  const trimmed = name.trim();
  if (!trimmed) return store;
  return {
    ...store,
    profiles: store.profiles.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
  };
}

/** Removes a profile and everything recorded against it. */
export function deleteProfile(store: ProfileStore, id: string): ProfileStore {
  const games = { ...store.games };
  delete games[id];
  const profiles = store.profiles.filter((p) => p.id !== id);
  return {
    profiles,
    games,
    activeId: store.activeId === id ? (profiles[0]?.id ?? null) : store.activeId,
  };
}

export function setActive(store: ProfileStore, id: string | null): ProfileStore {
  if (id !== null && !store.profiles.some((p) => p.id === id)) return store;
  return { ...store, activeId: id };
}

/**
 * Records a finished round against a profile.
 *
 * Raw results are stored, never a computed rating: re-measuring the roster
 * moves the anchors, and a stored rating would then disagree with the current
 * one. The whole curve is refitted from these whenever it is displayed.
 */
export function recordGame(store: ProfileStore, id: string, game: PlayedGame): ProfileStore {
  if (!store.profiles.some((p) => p.id === id)) return store;
  return { ...store, games: { ...store.games, [id]: [...(store.games[id] ?? []), game] } };
}

export function gamesFor(store: ProfileStore, id: string | null): PlayedGame[] {
  if (id == null) return [];
  return store.games[id] ?? [];
}

export function activeProfile(store: ProfileStore): Profile | null {
  return store.profiles.find((p) => p.id === store.activeId) ?? null;
}
