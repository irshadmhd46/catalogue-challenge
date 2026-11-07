import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../src/domain/rate-limiter.js';

export interface RateLimiterUnderTest {
  readonly limiter: RateLimiter;
  /** Moves time forward: a fake clock for memory, a real wait for Redis. */
  readonly advanceSeconds: (seconds: number) => Promise<void>;
  readonly cleanup?: () => Promise<void>;
}

/** The behaviour every RateLimiter adapter must share. */
export function describeRateLimiterContract(
  name: string,
  create: () => Promise<RateLimiterUnderTest> | RateLimiterUnderTest,
  options: { skip?: boolean } = {},
): void {
  describe.skipIf(options.skip === true)(`RateLimiter contract: ${name}`, () => {
    async function withLimiter(run: (subject: RateLimiterUnderTest) => Promise<void>) {
      const subject = await create();
      try {
        await run(subject);
      } finally {
        await subject.cleanup?.();
      }
    }

    // Fixed once per suite run: stable within a test, unique across runs on a shared Redis.
    const prefix = `contract:${randomUUID()}`;
    const key = (suffix: string) => `${prefix}:${suffix}`;

    it('allows hits up to the limit and counts remaining down to zero', () =>
      withLimiter(async ({ limiter }) => {
        const results = [];
        for (let i = 0; i < 3; i += 1) {
          results.push(await limiter.consume(key('count'), 3, 60));
        }

        expect(results.map((r) => r.allowed)).toEqual([true, true, true]);
        expect(results.map((r) => r.remaining)).toEqual([2, 1, 0]);
        expect(results.every((r) => r.limit === 3)).toBe(true);
      }));

    it('denies the hit after the limit with remaining 0 and a retry time inside the window', () =>
      withLimiter(async ({ limiter }) => {
        for (let i = 0; i < 3; i += 1) await limiter.consume(key('over'), 3, 60);

        const denied = await limiter.consume(key('over'), 3, 60);

        expect(denied.allowed).toBe(false);
        expect(denied.remaining).toBe(0);
        expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
      }));

    it('keeps denying for the rest of the window', () =>
      withLimiter(async ({ limiter }) => {
        await limiter.consume(key('stay'), 1, 60);

        for (let i = 0; i < 5; i += 1) {
          expect((await limiter.consume(key('stay'), 1, 60)).allowed).toBe(false);
        }
      }));

    it('treats a limit of one as one hit per window', () =>
      withLimiter(async ({ limiter }) => {
        expect((await limiter.consume(key('one'), 1, 60)).allowed).toBe(true);
        expect((await limiter.consume(key('one'), 1, 60)).allowed).toBe(false);
      }));

    it('keeps keys independent', () =>
      withLimiter(async ({ limiter }) => {
        await limiter.consume(key('a'), 1, 60);
        await limiter.consume(key('a'), 1, 60);

        expect((await limiter.consume(key('a'), 1, 60)).allowed).toBe(false);
        expect((await limiter.consume(key('b'), 1, 60)).allowed).toBe(true);
      }));

    it('allows again, with a full allowance, once the window has elapsed', () =>
      withLimiter(async ({ limiter, advanceSeconds }) => {
        await limiter.consume(key('expiry'), 2, 1);
        await limiter.consume(key('expiry'), 2, 1);
        expect((await limiter.consume(key('expiry'), 2, 1)).allowed).toBe(false);

        await advanceSeconds(1.3);

        const fresh = await limiter.consume(key('expiry'), 2, 1);
        expect(fresh.allowed).toBe(true);
        expect(fresh.remaining).toBe(1);
      }));

    it('does not extend the window when hits are denied', () =>
      withLimiter(async ({ limiter, advanceSeconds }) => {
        await limiter.consume(key('fixed'), 1, 2);
        await advanceSeconds(1.1);
        expect((await limiter.consume(key('fixed'), 1, 2)).allowed).toBe(false);
        await advanceSeconds(1.1);

        expect((await limiter.consume(key('fixed'), 1, 2)).allowed).toBe(true);
      }));
  });
}
