import { useState } from 'react';
import { App } from './App';
import { TableSetup } from './TableSetup';
import { SettingsProvider } from './settings';
import { isMatchOver, newMatch, recordRound, roundLabel, type MatchState } from './match';

interface Table {
  seats: string[];
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
  const [table, setTable] = useState<Table | null>(null);

  const start = (seats: string[], rounds: number) => {
    setTable({ seats, seed: randomSeed(), match: newMatch(rounds, seats.length + 1) });
  };

  /** A round finished: bank it, then deal the next unless the match is done. */
  const finishRound = (scores: number[]) => {
    setTable((prev) => {
      if (prev == null) return prev;
      const banked = recordRound(prev.match, scores);
      if (isMatchOver(banked)) {
        // The match is complete; start a fresh one on the same table.
        return { ...prev, seed: randomSeed(), match: newMatch(prev.match.rounds, scores.length) };
      }
      return { ...prev, seed: randomSeed(), match: banked };
    });
  };

  return (
    <SettingsProvider>
      {table === null ? (
        <TableSetup onStart={start} />
      ) : (
        <App
          key={`${table.seed}-${table.match.played}-${table.seats.join('-')}`}
          seats={table.seats}
          seed={table.seed}
          onChangeTable={() => setTable(null)}
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
          onRoundEnd={table.match.rounds === 1 ? undefined : finishRound}
        />
      )}
    </SettingsProvider>
  );
}
