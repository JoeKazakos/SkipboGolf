import { useState } from 'react';
import { App } from './App';
import { TableSetup } from './TableSetup';
import { SettingsProvider } from './settings';

interface Table {
  seats: string[];
  /**
   * Seed for the deal. Chosen here rather than left to useGame's default,
   * which is a fixed 1 - without this every fresh load dealt the identical
   * hand.
   */
  seed: number;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Chooses between the setup screen and the table.
 *
 * The table identity is passed to `App` as a key as well as props, so picking
 * a new table starts a genuinely fresh game rather than swapping agents
 * underneath a round already in progress.
 */
export function Root() {
  const [table, setTable] = useState<Table | null>(null);

  return (
    <SettingsProvider>
      {table === null ? (
        <TableSetup onStart={(seats) => setTable({ seats, seed: randomSeed() })} />
      ) : (
        <App
          key={`${table.seed}-${table.seats.join('-')}`}
          seats={table.seats}
          seed={table.seed}
          onChangeTable={() => setTable(null)}
        />
      )}
    </SettingsProvider>
  );
}
