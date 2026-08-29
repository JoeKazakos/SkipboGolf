import { useEffect, useRef } from 'react';
import type { LogEntry } from './useGame';
import { playerName, PLAYER_NAMES, type SeatNames } from './format';

/**
 * A running commentary of every action taken. It only ever prints information
 * that the action made public, so reading the log cannot reveal a hidden card.
 */
export function ActionLog({
  entries,
  names = PLAYER_NAMES,
}: {
  entries: readonly LogEntry[];
  names?: SeatNames;
}) {
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    // Scroll the list itself rather than calling scrollIntoView, which walks
    // every ancestor scroll container. On a narrow screen the sidebar sits
    // below the table, so scrollIntoView dragged the whole page down and away
    // from the game on every logged action.
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const recent = entries.slice(-60);

  return (
    <section className="panel panel--log" aria-label="Action log">
      <h2 className="panel__title">What just happened</h2>
      <ol className="log" data-testid="action-log" ref={listRef}>
        {recent.map((e) => (
          <li
            key={e.id}
            className={`log__row log__row--${e.kind} ${e.player === 0 ? 'log__row--mine' : ''}`}
          >
            {e.player >= 0 && <span className="log__who">{playerName(e.player, names)}</span>}
            <span className="log__text">{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
