import { describe, expect, it } from 'vitest';
import {
  categoriesResponseSchema,
  categoryPageResponseSchema,
  featuredResponseSchema,
  productResponseSchema,
  searchResponseSchema,
  type Product,
} from '../src/index.js';

const product: Product = {
  id: 7,
  title: 'Ring',
  description: 'Gold',
  price: 10,
  category: { slug: 'jewelery', name: 'Jewelery' },
  imageUrl: 'https://img.test/7.png',
  rating: { average: 4.6, count: 400 },
};
const category = { slug: 'jewelery', name: 'Jewelery' };

describe('response schemas', () => {
  it.each([
    ['featured', featuredResponseSchema, { products: [product] }],
    ['categories', categoriesResponseSchema, { categories: [category] }],
    ['category page', categoryPageResponseSchema, { category, topRated: [product], more: [] }],
    ['search', searchResponseSchema, { query: 'ring', products: [product] }],
    ['product', productResponseSchema, { product }],
  ])('%s accepts its body and returns it unchanged', (_name, schema, body) => {
    expect(schema.parse(body)).toEqual(body);
  });

  it('accepts empty lists', () => {
    expect(searchResponseSchema.safeParse({ query: 'zzz', products: [] }).success).toBe(true);
  });

  it('rejects a bare array as the featured response', () => {
    expect(featuredResponseSchema.safeParse([product]).success).toBe(false);
  });

  it('rejects an invalid product inside a response', () => {
    const broken = { ...product, price: -1 };

    expect(featuredResponseSchema.safeParse({ products: [broken] }).success).toBe(false);
  });

  it('rejects unknown top-level properties', () => {
    expect(featuredResponseSchema.safeParse({ products: [], total: 0 }).success).toBe(false);
  });

  it('rejects a category page missing the "more" list', () => {
    expect(categoryPageResponseSchema.safeParse({ category, topRated: [] }).success).toBe(false);
  });
});
