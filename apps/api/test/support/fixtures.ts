import { readFileSync } from 'node:fs';

/** One product exactly as the Fake Store API returns it. Only fakestore adapter tests may use it. */
export interface UpstreamProductFixture {
  readonly id: number;
  readonly title: string;
  readonly price: number;
  readonly description: string;
  readonly category: string;
  readonly image: string;
  readonly rating: { readonly rate: number; readonly count: number };
}

export function upstreamProducts(): UpstreamProductFixture[] {
  const raw = readFileSync(new URL('../fixtures/fakestore-products.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as UpstreamProductFixture[];
}
