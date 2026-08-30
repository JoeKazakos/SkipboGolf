import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  activeProfile,
  addProfile,
  deleteProfile,
  gamesFor,
  loadProfiles,
  recordGame,
  renameProfile,
  saveProfiles,
  setActive,
  type Profile,
  type ProfileStore,
} from './profiles';
import type { PlayedGame } from './rating';

interface ProfilesValue {
  store: ProfileStore;
  active: Profile | null;
  games: PlayedGame[];
  add: (name: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  choose: (id: string | null) => void;
  record: (game: PlayedGame) => void;
}

const ProfilesContext = createContext<ProfilesValue | null>(null);

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<ProfileStore>(() => loadProfiles());

  const update = useCallback((next: ProfileStore) => {
    saveProfiles(next);
    setStore(next);
  }, []);

  const value = useMemo<ProfilesValue>(
    () => ({
      store,
      active: activeProfile(store),
      games: gamesFor(store, store.activeId),
      add: (name) => update(addProfile(store, name)),
      rename: (id, name) => update(renameProfile(store, id, name)),
      remove: (id) => update(deleteProfile(store, id)),
      choose: (id) => update(setActive(store, id)),
      record: (game) => {
        // No active profile means nobody asked to be tracked; play is not
        // recorded rather than being attributed to someone at random.
        if (store.activeId == null) return;
        update(recordGame(store, store.activeId, game));
      },
    }),
    [store, update],
  );

  return <ProfilesContext.Provider value={value}>{children}</ProfilesContext.Provider>;
}

export function useProfiles(): ProfilesValue {
  const ctx = useContext(ProfilesContext);
  if (ctx == null) throw new Error('useProfiles used outside ProfilesProvider');
  return ctx;
}
