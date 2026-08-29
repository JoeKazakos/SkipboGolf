import { useState } from 'react';
import { App } from './App';
import { TableSetup } from './TableSetup';

/**
 * Chooses between the setup screen and the table.
 *
 * The seating is passed to `App` as a key as well as a prop, so picking a new
 * table starts a genuinely fresh game rather than swapping agents underneath a
 * round already in progress.
 */
export function Root() {
  const [seats, setSeats] = useState<string[] | null>(null);

  if (seats === null) {
    return <TableSetup onStart={setSeats} />;
  }

  return (
    <App
      key={seats.join('-')}
      seats={seats}
      onChangeTable={() => setSeats(null)}
    />
  );
}
