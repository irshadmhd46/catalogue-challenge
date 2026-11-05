import { EventEmitter } from 'node:events';
import type { RedisLike } from '../../src/infrastructure/cache/redis-cache.js';

export class FakeRedis extends EventEmitter implements RedisLike {
  readonly store = new Map<string, string>();
  readonly calls: string[] = [];
  readonly sets: { key: string; value: string; mode: string; seconds: number }[] = [];
  failWith: Error | undefined;
  disconnected = false;

  get(key: string): Promise<string | null> {
    this.calls.push(`get ${key}`);
    return this.failWith
      ? Promise.reject(this.failWith)
      : Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown> {
    this.calls.push(`set ${key}`);
    if (this.failWith) return Promise.reject(this.failWith);
    this.sets.push({ key, value, mode, seconds });
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  ping(): Promise<unknown> {
    this.calls.push('ping');
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve('PONG');
  }

  connect(): Promise<void> {
    this.calls.push('connect');
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve();
  }

  quit(): Promise<unknown> {
    this.calls.push('quit');
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve('OK');
  }

  disconnect(): void {
    this.calls.push('disconnect');
    this.disconnected = true;
  }
}
