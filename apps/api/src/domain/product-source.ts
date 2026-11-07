import type { Product } from './catalog.js';

/**
 * Where product data comes from. Implementations signal failure by throwing a typed error
 * (`UpstreamError`, `UpstreamTimeoutError`); they never return an empty result to hide one.
 */
export interface ProductSource {
  listProducts(): Promise<readonly Product[]>;
  /** Resolves to `undefined` when the product does not exist. */
  findProduct(id: number): Promise<Product | undefined>;
}
