import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Cache } from '../../src/domain/cache.js';

export interface CacheUnderTest {
  readonly cache: Cache;
  /** Moves time forward: a fake clock for memory, a real wait for Redis. */
  readonly advanceSeconds: (seconds: number) => Promise<void>;
  readonly cleanup?: () => Promise<void>;
}

/** The behaviour every Cache adapter must share. */
export function describeCacheContract(
  name: string,
  create: () => Promise<CacheUnderTest> | CacheUnderTest,
  options: { skip?: boolean } = {},
): void {
  describe.skipIf(options.skip === true)(`Cache contract: ${name}`, () => {
    async function withCache(run: (subject: CacheUnderTest) => Promise<void>): Promise<void> {
      const subject = await create();
      try {
        await run(subject);
      } finally {
        await subject.cleanup?.();
      }
    }

    // Fixed once per suite run so a key is stable within a test, and unique so a shared Redis
    // never leaks state between tests or runs.
    const prefix = `contract:${randomUUID()}`;
    const key = (suffix: string) => `${prefix}:${suffix}`;

    it('resolves to undefined on a miss', () =>
      withCache(async ({ cache }) => {
        expect(await cache.get(key('never-set'))).toBeUndefined();
      }));

    it('round-trips a nested object', () =>
      withCache(async ({ cache }) => {
        const value = { id: 1, tags: ['a', 'b'], nested: { ok: true, n: 1.5 } };
        await cache.set(key('object'), value, 60);

        expect(await cache.get(key('object'))).toEqual(value);
      }));

    it.each([
      ['null', null],
      ['zero', 0],
      ['false', false],
      ['empty string', ''],
      ['empty array', []],
    ])('round-trips %s without confusing it with a miss', (_label, value) =>
      withCache(async ({ cache }) => {
        await cache.set(key('falsy'), value, 60);

        expect(await cache.get(key('falsy'))).toEqual(value);
      }),
    );

    it('returns the second value after an overwrite', () =>
      withCache(async ({ cache }) => {
        await cache.set(key('overwrite'), { v: 1 }, 60);
        await cache.set(key('overwrite'), { v: 2 }, 60);

        expect(await cache.get(key('overwrite'))).toEqual({ v: 2 });
      }));

    it('keeps keys independent', () =>
      withCache(async ({ cache }) => {
        await cache.set(key('a'), 'first', 60);
        await cache.set(key('b'), 'second', 60);

        expect(await cache.get(key('a'))).toBe('first');
        expect(await cache.get(key('b'))).toBe('second');
      }));

    it('is isolated from later mutation of the stored object', () =>
      withCache(async ({ cache }) => {
        const original = { list: [1, 2, 3] };
        await cache.set(key('iso-in'), original, 60);
        original.list.push(4);

        expect(await cache.get(key('iso-in'))).toEqual({ list: [1, 2, 3] });
      }));

    it('is isolated from mutation of a returned object', () =>
      withCache(async ({ cache }) => {
        await cache.set(key('iso-out'), { list: [1, 2, 3] }, 60);
        const first = (await cache.get(key('iso-out'))) as { list: number[] };
        first.list.push(99);

        expect(await cache.get(key('iso-out'))).toEqual({ list: [1, 2, 3] });
      }));

    it('expires an entry once its TTL has elapsed, and not before', () =>
      withCache(async ({ cache, advanceSeconds }) => {
        await cache.set(key('ttl'), 'value', 1);

        expect(await cache.get(key('ttl'))).toBe('value');
        await advanceSeconds(1.3);

        expect(await cache.get(key('ttl'))).toBeUndefined();
      }));
  });
}
