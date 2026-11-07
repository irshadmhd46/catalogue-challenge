import { setTimeout as sleepFor } from 'node:timers/promises';
import type { Product } from '../../domain/catalog.js';
import { UpstreamError, UpstreamTimeoutError } from '../../domain/errors.js';
import type { Logger } from '../../domain/logger.js';
import type { ProductSource } from '../../domain/product-source.js';
import { upstreamProductListSchema, upstreamProductSchema } from './fakestore-mapper.js';

const MAX_BODY_BYTES = 1024 * 1024;
// A short fixed pause before the single retry: enough to ride out a blip, not a retry strategy.
const RETRY_DELAY_MS = 200;

export interface FakeStoreOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger: Logger;
  /** Everything below defaults to the real thing; tests replace it to stay deterministic. */
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly timeoutSignal?: (ms: number) => AbortSignal;
}

interface Failure {
  readonly retryable: boolean;
  readonly timedOut: boolean;
  readonly reason: string;
  readonly cause: unknown;
  readonly status?: number;
}

type Attempt<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

interface Reply {
  readonly status: number;
  readonly body: string;
}

class BodyTooLargeError extends Error {
  constructor() {
    super('upstream body exceeds the size limit');
    this.name = 'BodyTooLargeError';
  }
}

export class FakeStoreProductSource implements ProductSource {
  private readonly base: URL;
  private readonly host: string;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutSignal: (ms: number) => AbortSignal;

  constructor(private readonly options: FakeStoreOptions) {
    const base = new URL(options.baseUrl);
    // A trailing slash keeps a path prefix (https://host/api) when resolving relative paths.
    this.base = new URL(base.pathname.endsWith('/') ? base.href : `${base.href}/`);
    this.host = base.host;
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => sleepFor(ms));
    this.now = options.now ?? Date.now;
    this.timeoutSignal = options.timeoutSignal ?? ((ms) => AbortSignal.timeout(ms));
  }

  listProducts(): Promise<readonly Product[]> {
    return this.get('products', (reply) => this.parseList(reply));
  }

  findProduct(id: number): Promise<Product | undefined> {
    if (!Number.isSafeInteger(id) || id < 1) {
      return Promise.reject(new RangeError('product id must be a positive integer'));
    }
    return this.get(`products/${encodeURIComponent(String(id))}`, (reply) =>
      this.parseOne(reply, id),
    );
  }

  private parseList(reply: Reply): Attempt<readonly Product[]> {
    return this.parseJson(reply.body, upstreamProductListSchema);
  }

  private parseOne(reply: Reply, id: number): Attempt<Product | undefined> {
    if (reply.status === 404 || reply.body.trim() === '') {
      // The Fake Store answers 200 with an empty body for ids it does not have.
      return { ok: true, value: undefined };
    }
    const parsed = this.parseJson(reply.body, upstreamProductSchema);
    if (parsed.ok && parsed.value.id !== id) {
      return invalid(new Error('upstream returned a different product id'));
    }
    return parsed;
  }

  private parseJson<T>(
    body: string,
    schema: {
      safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
    },
  ): Attempt<T> {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (error) {
      return invalid(error);
    }
    const result = schema.safeParse(json);
    return result.success ? { ok: true, value: result.data } : invalid(result.error);
  }

  private async get<T>(path: string, parse: (reply: Reply) => Attempt<T>): Promise<T> {
    const url = new URL(path, this.base);
    const maxAttempts = this.options.maxRetries + 1;
    let last: Failure | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await this.attemptOnce(url, attempt, parse);
      if (result.ok) {
        return result.value;
      }
      last = result.failure;

      if (!last.retryable || attempt === maxAttempts) {
        break;
      }
      this.options.logger.warn(
        { target: this.host, attempt, reason: last.reason, delayMs: RETRY_DELAY_MS },
        'retrying upstream call',
      );
      await this.sleep(RETRY_DELAY_MS);
    }

    throw last?.timedOut
      ? new UpstreamTimeoutError({ cause: last.cause })
      : new UpstreamError({ cause: last?.cause });
  }

  private async attemptOnce<T>(
    url: URL,
    attempt: number,
    parse: (reply: Reply) => Attempt<T>,
  ): Promise<Attempt<T>> {
    const signal = this.timeoutSignal(this.options.timeoutMs);
    const startedAt = this.now();
    let status: number | undefined;

    try {
      const response = await this.doFetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { accept: 'application/json' },
        signal,
      });
      status = response.status;

      if (status >= 500 || status === 429) {
        await response.body?.cancel();
        return fail({
          retryable: true,
          reason: `http_${String(status)}`,
          cause: new Error(`upstream responded ${String(status)}`),
          status,
        });
      }
      if (status === 404) {
        await response.body?.cancel();
        return parse({ status, body: '' });
      }
      if (status < 200 || status > 299) {
        await response.body?.cancel();
        return fail({
          retryable: false,
          reason: `http_${String(status)}`,
          cause: new Error(`upstream responded ${String(status)}`),
          status,
        });
      }

      const body = await readBody(response);
      return parse({ status, body });
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return invalid(error);
      }
      const timedOut = signal.aborted;
      return fail({
        retryable: true,
        timedOut,
        reason: timedOut ? 'timeout' : 'network_error',
        cause: error,
      });
    } finally {
      this.options.logger.debug(
        { target: this.host, attempt, status, durationMs: this.now() - startedAt },
        'upstream call',
      );
    }
  }
}

function fail(partial: Omit<Failure, 'timedOut'> & { timedOut?: boolean }): {
  ok: false;
  failure: Failure;
} {
  return { ok: false, failure: { timedOut: false, ...partial } };
}

/** A payload we cannot trust: not retried, because asking again returns the same thing. */
function invalid(cause: unknown): { ok: false; failure: Failure } {
  return fail({ retryable: false, reason: 'invalid_payload', cause });
}

async function readBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new BodyTooLargeError();
  }
  if (response.body === null) {
    return '';
  }

  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
