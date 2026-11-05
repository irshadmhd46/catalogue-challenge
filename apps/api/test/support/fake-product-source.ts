import type { Product } from '../../src/domain/catalog.js';
import type { ProductSource } from '../../src/domain/product-source.js';
import { catalogProducts } from './catalog-fixture.js';

/** Hands out the same array every time so tests can prove callers never mutate it. */
export class FakeProductSource implements ProductSource {
  listCalls = 0;
  readonly findCalls: number[] = [];
  failure: Error | undefined;

  constructor(readonly products: Product[] = catalogProducts()) {}

  listProducts(): Promise<readonly Product[]> {
    this.listCalls += 1;
    return this.failure ? Promise.reject(this.failure) : Promise.resolve(this.products);
  }

  findProduct(id: number): Promise<Product | undefined> {
    this.findCalls.push(id);
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    return Promise.resolve(this.products.find((product) => product.id === id));
  }
}
