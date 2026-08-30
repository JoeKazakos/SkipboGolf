import { describe, expect, it, beforeEach } from 'vitest';
import {
  EMPTY_STORE,
  activeProfile,
  addProfile,
  deleteProfile,
  gamesFor,
  loadProfiles,
  recordGame,
  renameProfile,
  saveProfiles,
  setActive,
} from './profiles';
import type { PlayedGame } from './rating';

const g: PlayedGame = { at: '2026-08-30T00:00:00.000Z', seats: ['nel'], scores: [5, 9] };

beforeEach(() => localStorage.clear());

describe('profiles', () => {
  it('adds a profile and makes it active', () => {
    const s = addProfile(EMPTY_STORE, 'Joe');
    expect(s.profiles).toHaveLength(1);
    expect(activeProfile(s)?.name).toBe('Joe');
  });

  it('lets two people share a name without sharing a record', () => {
    let s = addProfile(EMPTY_STORE, 'Sam');
    s = addProfile(s, 'Sam');
    expect(s.profiles).toHaveLength(2);
    expect(s.profiles[0].id).not.toBe(s.profiles[1].id);

    s = recordGame(s, s.profiles[0].id, g);
    expect(gamesFor(s, s.profiles[0].id)).toHaveLength(1);
    expect(gamesFor(s, s.profiles[1].id)).toHaveLength(0);
  });

  it('ignores a blank name', () => {
    expect(addProfile(EMPTY_STORE, '   ').profiles).toHaveLength(0);
  });

  it('renames without touching the record', () => {
    let s = addProfile(EMPTY_STORE, 'Old');
    const id = s.profiles[0].id;
    s = recordGame(s, id, g);
    s = renameProfile(s, id, 'New');
    expect(s.profiles[0].name).toBe('New');
    expect(gamesFor(s, id)).toHaveLength(1);
  });

  it('deletes a profile and its games, and moves the active pointer', () => {
    let s = addProfile(EMPTY_STORE, 'A');
    s = addProfile(s, 'B');
    const bId = s.profiles[1].id;
    s = recordGame(s, bId, g);
    s = deleteProfile(s, bId);
    expect(s.profiles.map((p) => p.name)).toEqual(['A']);
    expect(gamesFor(s, bId)).toHaveLength(0);
    expect(s.activeId).toBe(s.profiles[0].id);
  });

  it('refuses to activate a profile that does not exist', () => {
    const s = addProfile(EMPTY_STORE, 'A');
    expect(setActive(s, 'nope').activeId).toBe(s.activeId);
  });

  it('will not record against an unknown profile', () => {
    const s = recordGame(EMPTY_STORE, 'ghost', g);
    expect(gamesFor(s, 'ghost')).toHaveLength(0);
  });

  it('round-trips through storage', () => {
    let s = addProfile(EMPTY_STORE, 'Joe');
    s = recordGame(s, s.profiles[0].id, g);
    saveProfiles(s);
    const back = loadProfiles();
    expect(back.profiles[0].name).toBe('Joe');
    expect(gamesFor(back, back.profiles[0].id)).toEqual([g]);
  });

  it('survives a corrupt store rather than throwing', () => {
    localStorage.setItem('skipbo-golf.profiles.v1', '{oops');
    expect(loadProfiles()).toEqual(EMPTY_STORE);
    localStorage.setItem('skipbo-golf.profiles.v1', JSON.stringify({ profiles: 'nope' }));
    expect(loadProfiles().profiles).toEqual([]);
  });

  it('drops an active pointer to a profile that is gone', () => {
    localStorage.setItem(
      'skipbo-golf.profiles.v1',
      JSON.stringify({ profiles: [], activeId: 'missing', games: {} }),
    );
    expect(loadProfiles().activeId).toBeNull();
  });
});
