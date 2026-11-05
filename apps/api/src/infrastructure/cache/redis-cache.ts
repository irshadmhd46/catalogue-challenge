import { Redis } from 'ioredis';
import type { Cache } from '../../domain/cache.js';
import { CacheError } from '../../domain/errors.js';
import type { Logger } from '../../domain/logger.js';

export const REDIS_KEY_PREFIX = 'catalogue:v1:';

const CONNECT_TIMEOUT_MS = 2000;
const COMMAND_TIMEOUT_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 2000;

/** The slice of an ioredis client this adapter uses, so tests can supply a fake. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  ping(): Promise<unknown>;
  connect(): Promise<void>;
  quit(): Promise<unknown>;
  disconnect(): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Commands fail at once while disconnected (no offline queue) and are bounded by a timeout, so a
 * Redis outage degrades the cache instead of hanging requests. Before the first successful
 * connection the retry strategy gives up, so a wrong URL fails startup instead of retrying forever.
 */
export function createRedisClient(url: string): RedisLike {
  let established = false;
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: CONNECT_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    retryStrategy: (attempt) =>
      established ? Math.min(attempt * 200, MAX_RECONNECT_DELAY_MS) : null,
  });
  client.once('ready', () => {
    established = true;
  });
  return client;
}

/** Host and port only: the URL may carry credentials. */
export function describeRedisUrl(url: string): string {
  return new URL(url).host;
}

/** Library messages can embed `scheme://user:pass@host`; never let credentials reach a log. */
function withoutCredentials(message: string): string {
  return message.replace(/\/\/[^/@\s]*@/g, '//***@');
}

export class RedisCache implements Cache {
  constructor(
    private readonly client: RedisLike,
    private readonly logger: Logger,
  ) {
    // An unhandled 'error' event would crash the process, and ioredis emits one per failed attempt.
    client.on('error', (error: Error) => {
      const code = (error as { code?: unknown }).code;
      this.logger.warn(
        {
          code: typeof code === 'string' ? code : undefined,
          reason: withoutCredentials(error.message),
        },
        'redis connection error',
      );
    });
  }

  /** Connects and answers a PING. Used at startup so a misconfigured Redis fails fast. */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
      await this.client.ping();
    } catch (cause) {
      this.client.disconnect();
      throw new CacheError({ cause });
    }
  }

  async get(key: string): Promise<unknown> {
    let raw: string | null;
    try {
      raw = await this.client.get(REDIS_KEY_PREFIX + key);
    } catch (cause) {
      throw new CacheError({ cause });
    }
    if (raw === null) {
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch (cause) {
      throw new CacheError({ cause });
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch (cause) {
      throw new CacheError({ cause });
    }
    if (json === undefined) {
      throw new CacheError({ cause: new TypeError('value is not JSON-serialisable') });
    }
    try {
      await this.client.set(REDIS_KEY_PREFIX + key, json, 'EX', Math.max(1, Math.ceil(ttlSeconds)));
    } catch (cause) {
      throw new CacheError({ cause });
    }
  }

  /** Graceful quit; falls back to dropping the socket if QUIT itself fails. */
  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch (cause) {
      this.client.disconnect();
      throw new CacheError({ cause });
    }
  }
}
