/**
 * A key-value cache for JSON-serialisable values. Adapters throw `CacheError` on failure;
 * callers treat a failing cache as a miss.
 */
export interface Cache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}
