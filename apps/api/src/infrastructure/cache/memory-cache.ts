import type { Cache } from '../../domain/cache.js';
import { CacheError } from '../../domain/errors.js';

interface Entry {
  readonly json: string;
  readonly expiresAt: number;
}

/**
 * Stores a JSON copy so callers can never share or mutate cached objects, and so behaviour matches
 * a future shared (e.g. Redis) adapter. Only found products are cached, so the key count is bounded by the catalogue.
 */
export class MemoryCache implements Cache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): Promise<unknown> {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return Promise.resolve(undefined);
    }
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(JSON.parse(entry.json));
  }

  set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch (cause) {
      return Promise.reject(new CacheError({ cause }));
    }
    if (json === undefined) {
      return Promise.reject(
        new CacheError({ cause: new TypeError('value is not JSON-serialisable') }),
      );
    }
    this.entries.set(key, { json, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }
}
