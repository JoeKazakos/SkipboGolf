import { useEffect, useRef, useState } from 'react';

/**
 * Reports which entries of a list changed since the last render, so the cards
 * that just moved can be animated while the rest stay still.
 *
 * This is deliberately not a FLIP animation. A FLIP needs stable card
 * identities to match an element before and after, and an Observation
 * deliberately carries no card ids - a face-down card must not be
 * distinguishable from any other. Flagging the positions that changed gets the
 * thing that actually matters, which is seeing a wave chain happen rather than
 * the board silently rearranging.
 *
 * Returns a set of indices that changed, cleared once the animation is done.
 */
export function useChangeFlash(values: readonly (number | null)[], durationMs = 320): Set<number> {
  const previous = useRef<readonly (number | null)[] | null>(null);
  const [changed, setChanged] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const before = previous.current;
    previous.current = values;

    // First render is not a change; the board arriving is not an event.
    if (before == null) return;
    if (before.length !== values.length) return;

    const next = new Set<number>();
    for (let i = 0; i < values.length; i++) {
      if (before[i] !== values[i]) next.add(i);
    }
    if (next.size === 0) return;

    setChanged(next);
    const timer = setTimeout(() => setChanged(new Set()), durationMs);
    return () => clearTimeout(timer);
    // Comparing by value: the array identity changes every render.
  }, [values.join('|'), durationMs]);

  return changed;
}
