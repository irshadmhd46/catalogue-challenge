import { describe, expect, it } from 'vitest';
import {
  MAX_TRACKED_KEYS,
  MemoryRateLimiter,
} from '../../src/infrastructure/rate-limit/memory-rate-limiter.js';
import { describeRateLimiterContract } from './rate-limiter-contract.js';

describeRateLimiterContract('MemoryRateLimiter', () => {
  const clock = { ms: 1_000_000 };
  return {
    limiter: new MemoryRateLimiter(() => clock.ms),
    advanceSeconds: (seconds) => {
      clock.ms += seconds * 1000;
      return Promise.resolve();
    },
  };
});

function setup(maxKeys?: number) {
  const clock = { ms: 5_000_000 };
  const limiter = new MemoryRateLimiter(() => clock.ms, maxKeys);
  return { clock, limiter };
}

describe('MemoryRateLimiter windows', () => {
  it('reports the whole seconds left, rounded up and at least 1', async () => {
    const { clock, limiter } = setup();
    await limiter.consume('k', 1, 60);

    clock.ms += 59_500;
    const nearEnd = await limiter.consume('k', 1, 60);
    expect(nearEnd.retryAfterSeconds).toBe(1);

    clock.ms -= 59_500 - 10_000;
    const mid = await limiter.consume('k', 1, 60);
    expect(mid.retryAfterSeconds).toBe(50);
  });

  it('rounds the seconds left up, not down', async () => {
    const { clock, limiter } = setup();
    await limiter.consume('k', 1, 60);

    clock.ms += 10_500;

    expect((await limiter.consume('k', 1, 60)).retryAfterSeconds).toBe(50);
  });

  it('opens a new window exactly at the end of the old one', async () => {
    const { clock, limiter } = setup();
    await limiter.consume('k', 1, 60);

    clock.ms += 59_999;
    expect((await limiter.consume('k', 1, 60)).allowed).toBe(false);
    clock.ms += 1;
    expect((await limiter.consume('k', 1, 60)).allowed).toBe(true);
  });

  it('starts the window at the first hit, not at a clock boundary', async () => {
    const { clock, limiter } = setup();
    clock.ms += 37_000;
    const first = await limiter.consume('k', 5, 60);

    expect(first.retryAfterSeconds).toBe(60);
  });

  it('echoes the limit it was given on every result', async () => {
    const { limiter } = setup();

    expect((await limiter.consume('k', 7, 60)).limit).toBe(7);
  });
});

describe('MemoryRateLimiter memory bounds', () => {
  it('holds at most the maximum number of keys under a flood of distinct keys', async () => {
    const { limiter } = setup(MAX_TRACKED_KEYS);

    for (let i = 0; i < 20_000; i += 1) {
      await limiter.consume(`flood-${String(i)}`, 5, 60);
    }

    expect(limiter.size).toBe(MAX_TRACKED_KEYS);
  });

  it('still limits the newest keys correctly after evicting the oldest', async () => {
    const { limiter } = setup(100);
    for (let i = 0; i < 500; i += 1) {
      await limiter.consume(`flood-${String(i)}`, 1, 60);
    }

    expect((await limiter.consume('flood-499', 1, 60)).allowed).toBe(false);
  });

  it('evicts the oldest window first, so an evicted key starts again', async () => {
    const { limiter } = setup(3);
    await limiter.consume('a', 1, 60);
    await limiter.consume('b', 1, 60);
    await limiter.consume('c', 1, 60);
    await limiter.consume('d', 1, 60); // evicts 'a'

    expect((await limiter.consume('b', 1, 60)).allowed).toBe(false);
    expect((await limiter.consume('a', 1, 60)).allowed).toBe(true);
  });

  it('purges expired entries when the limiter is used again', async () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 5; i += 1) await limiter.consume(`k${String(i)}`, 1, 60);
    expect(limiter.size).toBe(5);

    clock.ms += 61_000;
    await limiter.consume('fresh', 1, 60);

    expect(limiter.size).toBe(1);
  });

  it('purges at most once a second, so a flood of calls does not rescan the map each time', async () => {
    const { clock, limiter } = setup();
    await limiter.consume('short-lived', 1, 0.5);
    clock.ms += 700; // 'short-lived' has expired, but the last purge was only 700 ms ago

    await limiter.consume('other', 1, 60);

    expect(limiter.size).toBe(2);
    clock.ms += 400; // now more than a second since the last purge
    await limiter.consume('another', 1, 60);
    expect(limiter.size).toBe(2);
  });

  it('keeps counting a key correctly across a purge of other keys', async () => {
    const { clock, limiter } = setup();
    await limiter.consume('keep', 2, 600);
    await limiter.consume('gone', 1, 1);
    clock.ms += 2000;

    const second = await limiter.consume('keep', 2, 600);

    expect(second.remaining).toBe(0);
    expect((await limiter.consume('keep', 2, 600)).allowed).toBe(false);
  });
});
