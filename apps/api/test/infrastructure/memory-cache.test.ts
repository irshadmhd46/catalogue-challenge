import { describe, expect, it } from 'vitest';
import { CacheError } from '../../src/domain/errors.js';
import { MemoryCache } from '../../src/infrastructure/cache/memory-cache.js';
import { describeCacheContract } from './cache-contract.js';

describeCacheContract('MemoryCache', () => {
  let now = 1_000_000;
  return {
    cache: new MemoryCache(() => now),
    advanceSeconds: (seconds) => {
      now += seconds * 1000;
      return Promise.resolve();
    },
  };
});

describe('MemoryCache', () => {
  it('uses the injected clock: present at 9 s, absent at 11 s for a 10 s TTL', async () => {
    let now = 0;
    const cache = new MemoryCache(() => now);
    await cache.set('k', 'v', 10);

    now = 9000;
    expect(await cache.get('k')).toBe('v');
    now = 11_000;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('expires exactly at the TTL boundary', async () => {
    let now = 0;
    const cache = new MemoryCache(() => now);
    await cache.set('k', 'v', 10);

    now = 9999;
    expect(await cache.get('k')).toBe('v');
    now = 10_000;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('refreshes the TTL on overwrite', async () => {
    let now = 0;
    const cache = new MemoryCache(() => now);
    await cache.set('k', 'old', 10);
    now = 8000;
    await cache.set('k', 'new', 10);

    now = 15_000;
    expect(await cache.get('k')).toBe('new');
  });

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
  ])('rejects %s with a CacheError', async (_label, value) => {
    const cache = new MemoryCache();

    await expect(cache.set('k', value, 10)).rejects.toBeInstanceOf(CacheError);
  });

  it('rejects a circular structure and a bigint with a CacheError carrying the cause', async () => {
    const cache = new MemoryCache();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const failure = await cache.set('k', circular, 10).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CacheError);
    expect((failure as CacheError).cause).toBeInstanceOf(TypeError);
    await expect(cache.set('k', 10n, 10)).rejects.toBeInstanceOf(CacheError);
  });

  it('does not store anything when set is rejected', async () => {
    const cache = new MemoryCache();
    await cache.set('k', 'kept', 10);

    await cache.set('k', undefined, 10).catch(() => undefined);

    expect(await cache.get('k')).toBe('kept');
  });
});
