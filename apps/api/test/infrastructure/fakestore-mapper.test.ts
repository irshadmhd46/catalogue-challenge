import { productSchema } from '@catalogue/contracts';
import { describe, expect, it } from 'vitest';
import {
  upstreamProductListSchema,
  upstreamProductSchema,
} from '../../src/infrastructure/catalog/fakestore-mapper.js';
import { upstreamProducts, type UpstreamProductFixture } from '../support/fixtures.js';

const product1 = (): UpstreamProductFixture => {
  const found = upstreamProducts().find((p) => p.id === 1);
  if (!found) throw new Error('fixture product 1 missing');
  return found;
};

describe('upstreamProductSchema (Fake Store -> contract)', () => {
  it('maps product 1 field by field', () => {
    const upstream = product1();

    const mapped = upstreamProductSchema.parse(upstream);

    expect(mapped).toEqual({
      id: 1,
      title: upstream.title,
      description: upstream.description,
      price: 109.95,
      category: { slug: 'mens-clothing', name: "Men's Clothing" },
      imageUrl: upstream.image,
      rating: { average: 3.9, count: 120 },
    });
  });

  it('leaves no upstream-only property behind', () => {
    const mapped = upstreamProductSchema.parse(product1());

    expect(mapped).not.toHaveProperty('image');
    expect(mapped.rating).not.toHaveProperty('rate');
    expect(Object.keys(mapped).sort()).toEqual([
      'category',
      'description',
      'id',
      'imageUrl',
      'price',
      'rating',
      'title',
    ]);
  });

  it('strips unknown upstream fields instead of failing', () => {
    const mapped = upstreamProductSchema.parse({ ...product1(), warehouse: 'A7', sku: 'x' });

    expect(mapped).not.toHaveProperty('warehouse');
    expect(mapped).not.toHaveProperty('sku');
  });

  it.each([
    ["men's clothing", 'mens-clothing', "Men's Clothing"],
    ["women's clothing", 'womens-clothing', "Women's Clothing"],
    ['jewelery', 'jewelery', 'Jewelery'],
    ['electronics', 'electronics', 'Electronics'],
    ['Home & Garden', 'home-garden', 'Home & Garden'],
  ])('category %j -> slug %s, name %j', (raw, slug, name) => {
    const mapped = upstreamProductSchema.parse({ ...product1(), category: raw });

    expect(mapped.category).toEqual({ slug, name });
  });

  it.each([
    ['missing rating', (p: Record<string, unknown>) => delete p.rating],
    ['missing category', (p: Record<string, unknown>) => delete p.category],
    ['missing image', (p: Record<string, unknown>) => delete p.image],
    ['string price', (p: Record<string, unknown>) => (p.price = '10')],
    ['negative price', (p: Record<string, unknown>) => (p.price = -1)],
    ['non-URL image', (p: Record<string, unknown>) => (p.image = 'not a url')],
    ['javascript: image', (p: Record<string, unknown>) => (p.image = 'javascript:alert(1)')],
    [
      'rating above 5 (breaks our contract)',
      (p: Record<string, unknown>) => (p.rating = { rate: 6, count: 1 }),
    ],
    [
      'fractional rating count',
      (p: Record<string, unknown>) => (p.rating = { rate: 4, count: 1.5 }),
    ],
    ['non-integer id', (p: Record<string, unknown>) => (p.id = 1.5)],
    ['category that slugifies to nothing', (p: Record<string, unknown>) => (p.category = '!!!')],
    ['empty title', (p: Record<string, unknown>) => (p.title = '')],
  ])('rejects %s', (_label, break_) => {
    const broken: Record<string, unknown> = { ...product1() };
    break_(broken);

    expect(upstreamProductSchema.safeParse(broken).success).toBe(false);
  });
});

describe('upstreamProductListSchema', () => {
  it('maps all 20 recorded products to valid contract products', () => {
    const mapped = upstreamProductListSchema.parse(upstreamProducts());

    expect(mapped).toHaveLength(20);
    for (const product of mapped) {
      expect(productSchema.safeParse(product).success).toBe(true);
    }
  });

  it('keeps the upstream order', () => {
    const mapped = upstreamProductListSchema.parse(upstreamProducts());

    expect(mapped.map((p) => p.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('fails the whole list when one product is invalid', () => {
    const list: Record<string, unknown>[] = upstreamProducts().map((p) => ({ ...p }));
    delete list[7]?.rating;

    expect(upstreamProductListSchema.safeParse(list).success).toBe(false);
  });

  it('rejects an object where an array is expected', () => {
    expect(upstreamProductListSchema.safeParse({ products: [] }).success).toBe(false);
  });

  it('accepts an empty array', () => {
    expect(upstreamProductListSchema.parse([])).toEqual([]);
  });
});
