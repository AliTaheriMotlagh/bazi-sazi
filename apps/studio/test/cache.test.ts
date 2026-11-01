import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlMemo, kvGet, kvSet } from '../src/store/kv';

describe('TtlMemo', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns values until they expire', () => {
    const memo = new TtlMemo<number>(1000);
    memo.set('a', 1);
    expect(memo.get('a')).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(memo.get('a')).toBeUndefined();
  });

  it('evicts the oldest entry beyond its capacity and refreshes re-set keys', () => {
    const memo = new TtlMemo<number>(10_000, 2);
    memo.set('a', 1);
    memo.set('b', 2);
    memo.set('a', 10); // a is now the newest
    memo.set('c', 3);
    expect(memo.get('b')).toBeUndefined();
    expect(memo.get('a')).toBe(10);
    expect(memo.get('c')).toBe(3);
  });
});

describe('kv (IndexedDB cache)', () => {
  it('is a harmless empty cache when IndexedDB is unavailable', async () => {
    // Node has no indexedDB: reads miss, writes are ignored, nothing throws.
    await expect(kvSet('k', { a: 1 })).resolves.toBeUndefined();
    await expect(kvGet('k')).resolves.toBeUndefined();
  });
});
