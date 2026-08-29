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
  const endRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [entries.length]);

  const recent = entries.slice(-60);

  return (
    <section className="panel panel--log" aria-label="Action log">
      <h2 className="panel__title">What just happened</h2>
      <ol className="log" data-testid="action-log">
        {recent.map((e, i) => (
          <li
            key={e.id}
            ref={i === recent.length - 1 ? endRef : undefined}
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
