import { useCallback, useState } from 'react';
import { App } from './App';
import { TableSetup } from './TableSetup';
import { SettingsProvider } from './settings';
import { ProfilesProvider, useProfiles } from './ProfilesContext';
import { isMatchOver, newMatch, recordRound, roundLabel, type MatchState } from './match';
import { clearGame, loadGame, saveGame } from './persistence';
import type { GameState } from '../engine/types';

interface Table {
  seats: string[];
  /** A position restored from storage, resumed instead of dealt afresh. */
  resume?: GameState;
  /**
   * Seed for the deal. Chosen here rather than left to useGame's default,
   * which is a fixed 1 - without this every fresh load dealt the identical
   * hand.
   */
  seed: number;
  match: MatchState;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Chooses between the setup screen and the table, and owns the match.
 *
 * A match is bookkeeping around rounds, so it lives here rather than in the
 * engine: the engine stays a single-round rules implementation.
 *
 * The seed and round number are part of App's key, so every round is a
 * genuinely fresh game rather than a mutated one.
 */
export function Root() {
  return (
    <SettingsProvider>
      <ProfilesProvider>
        <Tables />
      </ProfilesProvider>
    </SettingsProvider>
  );
}

function Tables() {
  const { record } = useProfiles();
  // A saved game is picked up on first render, so a refresh resumes the round.
  const [table, setTable] = useState<Table | null>(() => {
    const saved = loadGame();
    if (!saved) return null;
    return { seats: saved.seats, seed: saved.seed, match: saved.match, resume: saved.game };
  });

  const start = (seats: string[], rounds: number) => {
    clearGame();
    setTable({ seats, seed: randomSeed(), match: newMatch(rounds, seats.length + 1) });
  };

  /** Records a finished round against whoever is playing, if anyone is. */
  const recordFinished = (scores: number[]) => {
    if (table == null) return;
    record({ at: new Date().toISOString(), seats: [...table.seats], scores: [...scores] });
  };

  /** Persists the live position, so a refresh does not lose the round. */
  const persist = useCallback(
    (game: GameState) => {
      if (table == null) return;
      if (game.terminal) {
        // A finished round is not worth resuming into; the scorecard is
        // already shown and the next action deals afresh.
        clearGame();
        return;
      }
      saveGame({ seats: table.seats, seed: table.seed, game, match: table.match });
    },
    [table],
  );

  /** A round finished: bank it, then deal the next unless the match is done. */
  const finishRound = (scores: number[]) => {
    recordFinished(scores);
    setTable((prev) => {
      if (prev == null) return prev;
      const banked = recordRound(prev.match, scores);
      clearGame();
      if (isMatchOver(banked)) {
        // The match is complete; start a fresh one on the same table.
        return {
          ...prev,
          seed: randomSeed(),
          resume: undefined,
          match: newMatch(prev.match.rounds, scores.length),
        };
      }
      return { ...prev, seed: randomSeed(), resume: undefined, match: banked };
    });
  };

  return (
    <>
      {table === null ? (
        <TableSetup onStart={start} />
      ) : (
        <App
          key={`${table.seed}-${table.match.played}-${table.seats.join('-')}`}
          seats={table.seats}
          seed={table.seed}
          initialState={table.resume}
          onStateChange={persist}
          onChangeTable={() => {
            clearGame();
            setTable(null);
          }}
          match={
            table.match.rounds === 1
              ? undefined
              : {
                  label: roundLabel(table.match),
                  totalsBefore: table.match.totals,
                  // This round is the last one when banking it completes the match.
                  isOver: table.match.played + 1 >= table.match.rounds,
                }
          }
          // Always set, so a single round is recorded too. The match prop
          // above is what decides whether match UI is shown.
          onRoundEnd={finishRound}
        />
      )}
    </>
  );
}
