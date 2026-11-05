import type { Product } from '@catalogue/contracts';
import { upstreamProducts } from './fixtures.js';

// Written out by hand on purpose: tests must not depend on the production slug/name rules.
const CATEGORIES: Readonly<Record<string, { slug: string; name: string }>> = {
  electronics: { slug: 'electronics', name: 'Electronics' },
  jewelery: { slug: 'jewelery', name: 'Jewelery' },
  "men's clothing": { slug: 'mens-clothing', name: "Men's Clothing" },
  "women's clothing": { slug: 'womens-clothing', name: "Women's Clothing" },
};

/** The 20 recorded products in our contract shape, in upstream order. */
export function catalogProducts(): Product[] {
  return upstreamProducts().map((upstream) => {
    const category = CATEGORIES[upstream.category];
    if (category === undefined) {
      throw new Error(`fixture category not mapped: ${upstream.category}`);
    }
    return {
      id: upstream.id,
      title: upstream.title,
      description: upstream.description,
      price: upstream.price,
      category: { ...category },
      imageUrl: upstream.image,
      rating: { average: upstream.rating.rate, count: upstream.rating.count },
    };
  });
}

export function productWith(overrides: Partial<Product> & { id: number }): Product {
  return {
    title: `Product ${String(overrides.id)}`,
    description: 'A product',
    price: 10,
    category: { slug: 'misc', name: 'Misc' },
    imageUrl: 'https://img.test/p.png',
    rating: { average: 3, count: 10 },
    ...overrides,
  };
}
