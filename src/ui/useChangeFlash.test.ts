import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChangeFlash } from './useChangeFlash';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useChangeFlash', () => {
  it('reports nothing on the first render', () => {
    const { result } = renderHook(({ v }) => useChangeFlash(v), {
      initialProps: { v: [1, 2, 3] as (number | null)[] },
    });
    expect([...result.current]).toEqual([]);
  });

  it('reports only the entries that changed', () => {
    const { result, rerender } = renderHook(({ v }) => useChangeFlash(v), {
      initialProps: { v: [1, 2, 3] as (number | null)[] },
    });
    rerender({ v: [1, 9, 3] as (number | null)[] });
    expect([...result.current]).toEqual([1]);
  });

  it('treats a card being revealed as a change', () => {
    const { result, rerender } = renderHook(({ v }) => useChangeFlash(v), {
      initialProps: { v: [null, 2] as (number | null)[] },
    });
    rerender({ v: [7, 2] as (number | null)[] });
    expect([...result.current]).toEqual([0]);
  });

  it('clears itself once the animation is over', () => {
    const { result, rerender } = renderHook(({ v }) => useChangeFlash(v, 300), {
      initialProps: { v: [1, 2] as (number | null)[] },
    });
    rerender({ v: [5, 2] as (number | null)[] });
    expect(result.current.size).toBe(1);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.size).toBe(0);
  });

  it('reports nothing when nothing moved', () => {
    const { result, rerender } = renderHook(({ v }) => useChangeFlash(v), {
      initialProps: { v: [1, 2] as (number | null)[] },
    });
    rerender({ v: [1, 2] as (number | null)[] });
    expect(result.current.size).toBe(0);
  });
});
