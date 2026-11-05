import { describe, expect, it } from 'vitest';
import { categorySchema, productSchema, type Product } from '../src/index.js';

const validProduct: Product = {
  id: 1,
  title: 'Backpack',
  description: 'Fits a laptop',
  price: 109.95,
  category: { slug: 'mens-clothing', name: "Men's Clothing" },
  imageUrl: 'https://img.test/1.png',
  rating: { average: 3.9, count: 120 },
};

describe('productSchema', () => {
  it('parses a well-formed product and returns an equal value', () => {
    expect(productSchema.parse(validProduct)).toEqual(validProduct);
  });

  it.each([
    ['rating average above 5', { rating: { average: 5.1, count: 1 } }],
    ['rating average below 0', { rating: { average: -0.1, count: 1 } }],
    ['fractional rating count', { rating: { average: 4, count: 1.5 } }],
    ['negative price', { price: -1 }],
    ['infinite price', { price: Number.POSITIVE_INFINITY }],
    ['id 0', { id: 0 }],
    ['fractional id', { id: 1.5 }],
    ['empty title', { title: '' }],
    ['non-URL image', { imageUrl: 'not a url' }],
    ['javascript: image', { imageUrl: 'javascript:alert(1)' }],
    ['ftp image', { imageUrl: 'ftp://img.test/1.png' }],
    ['empty category slug', { category: { slug: '', name: 'X' } }],
  ])('rejects %s', (_label, override) => {
    expect(productSchema.safeParse({ ...validProduct, ...override }).success).toBe(false);
  });

  it('accepts a price of 0 and an http image', () => {
    const result = productSchema.safeParse({
      ...validProduct,
      price: 0,
      imageUrl: 'http://img.test/1.png',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an upstream-shaped extra property', () => {
    const upstreamShaped = { ...validProduct, image: 'https://img.test/1.png' };

    expect(productSchema.safeParse(upstreamShaped).success).toBe(false);
  });

  it('rejects an upstream-shaped rating', () => {
    const upstreamRating = { ...validProduct, rating: { rate: 3.9, count: 120 } };

    expect(productSchema.safeParse(upstreamRating).success).toBe(false);
  });

  it('rejects a missing field', () => {
    const withoutRating = Object.fromEntries(
      Object.entries(validProduct).filter(([key]) => key !== 'rating'),
    );

    expect(productSchema.safeParse(withoutRating).success).toBe(false);
  });
});

describe('categorySchema', () => {
  it('parses slug and name', () => {
    expect(categorySchema.parse({ slug: 'electronics', name: 'Electronics' })).toEqual({
      slug: 'electronics',
      name: 'Electronics',
    });
  });

  it('rejects an extra property', () => {
    expect(categorySchema.safeParse({ slug: 'a', name: 'A', id: 1 }).success).toBe(false);
  });
});
