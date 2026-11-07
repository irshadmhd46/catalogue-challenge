import type { Cache } from '../../domain/cache.js';
import type { Product } from '../../domain/catalog.js';
import type { Logger } from '../../domain/logger.js';
import type { ProductSource } from '../../domain/product-source.js';

const LIST_KEY = 'products:all';
const productKey = (id: number) => `product:${String(id)}`;

interface Entry<T> {
  readonly storedAt: number;
  readonly value: T;
}

export interface CachedProductSourceOptions {
  readonly inner: ProductSource;
  readonly cache: Cache;
  readonly logger: Logger;
  readonly freshSeconds: number;
  readonly staleSeconds: number;
  readonly now?: () => number;
}

function isEntry(candidate: unknown): candidate is Entry<unknown> {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'storedAt' in candidate &&
    typeof candidate.storedAt === 'number' &&
    'value' in candidate
  );
}

/**
 * Wraps any ProductSource. A cache is an optimisation, never a dependency: cache failures are
 * logged and treated as misses, and stale data is served when the wrapped source fails.
 */
export class CachedProductSource implements ProductSource {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly now: () => number;

  constructor(private readonly options: CachedProductSourceOptions) {
    this.now = options.now ?? Date.now;
  }

  listProducts(): Promise<readonly Product[]> {
    return this.through<readonly Product[]>(LIST_KEY, () => this.options.inner.listProducts());
  }

  findProduct(id: number): Promise<Product | undefined> {
    return this.through<Product | undefined>(productKey(id), () =>
      this.options.inner.findProduct(id),
    );
  }

  private async through<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = await this.read<T>(key);
    if (entry !== undefined && this.isFresh(entry)) {
      this.options.logger.debug({ key }, 'cache hit');
      return entry.value;
    }

    try {
      return await this.refresh(key, load);
    } catch (error) {
      if (entry === undefined) {
        throw error;
      }
      this.options.logger.warn(
        { key, ageSeconds: Math.round(this.ageMs(entry) / 1000) },
        'upstream failed, serving stale cache entry',
      );
      return entry.value;
    }
  }

  /** Concurrent refreshes of one key share a single call to the wrapped source. */
  private async refresh<T>(key: string, load: () => Promise<T>): Promise<T> {
    const shared =
      (this.inflight.get(key) as Promise<T> | undefined) ?? this.startRefresh(key, load);
    const value = await shared;
    // Every caller gets its own copy: nobody can mutate what another caller holds.
    return value === undefined ? value : structuredClone(value);
  }

  private startRefresh<T>(key: string, load: () => Promise<T>): Promise<T> {
    // Starting from a resolved promise turns a synchronous throw from `load` into a rejection,
    // so the in-flight entry below is always cleared by `finally`.
    const promise = Promise.resolve()
      .then(load)
      .then(async (value) => {
        if (value !== undefined) {
          await this.write(key, value);
        }
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  private ageMs(entry: Entry<unknown>): number {
    return this.now() - entry.storedAt;
  }

  /** Only called for usable entries, so the age is already known to be non-negative. */
  private isFresh(entry: Entry<unknown>): boolean {
    return this.ageMs(entry) < this.options.freshSeconds * 1000;
  }

  private isUsable(entry: Entry<unknown>): boolean {
    const age = this.ageMs(entry);
    return age >= 0 && age < (this.options.freshSeconds + this.options.staleSeconds) * 1000;
  }

  private async read<T>(key: string): Promise<Entry<T> | undefined> {
    let stored: unknown;
    try {
      stored = await this.options.cache.get(key);
    } catch (err) {
      this.options.logger.warn({ key, err }, 'cache read failed, treating as a miss');
      return undefined;
    }
    if (stored === undefined) {
      return undefined;
    }
    if (!isEntry(stored)) {
      this.options.logger.warn({ key }, 'ignoring malformed cache entry');
      return undefined;
    }
    return this.isUsable(stored) ? (stored as Entry<T>) : undefined;
  }

  private async write(key: string, value: unknown): Promise<void> {
    const ttlSeconds = this.options.freshSeconds + this.options.staleSeconds;
    try {
      await this.options.cache.set(key, { storedAt: this.now(), value }, ttlSeconds);
    } catch (err) {
      this.options.logger.warn({ key, err }, 'cache write failed, continuing without caching');
    }
  }
}
