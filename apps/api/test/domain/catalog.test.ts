import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TOP_COUNT,
  FEATURED_COUNT,
  categoryFromName,
  rankProducts,
  slugify,
} from '../../src/domain/catalog.js';
import { catalogProducts, productWith } from '../support/catalog-fixture.js';

describe('slugify', () => {
  it.each([
    ["men's clothing", 'mens-clothing'],
    ["women's clothing", 'womens-clothing'],
    ['jewelery', 'jewelery'],
    ['electronics', 'electronics'],
    ['Home & Garden', 'home-garden'],
    ['  Padded   Jackets  ', 'padded-jackets'],
    ['a---b', 'a-b'],
    ['Kids’ Toys', 'kids-toys'],
    ['---', ''],
  ])('%j -> %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('categoryFromName', () => {
  it.each([
    ["men's clothing", { slug: 'mens-clothing', name: "Men's Clothing" }],
    ['jewelery', { slug: 'jewelery', name: 'Jewelery' }],
    ['  home   garden ', { slug: 'home-garden', name: 'Home Garden' }],
    ["McDonald's", { slug: 'mcdonalds', name: "McDonald's" }],
  ])('%j -> %j', (input, expected) => {
    expect(categoryFromName(input)).toEqual(expected);
  });
});

describe('rankProducts', () => {
  it('orders the fixture by rating, then count, then id: 12, 11, 3, 18 lead', () => {
    const ids = rankProducts(catalogProducts()).map((product) => product.id);

    expect(ids.slice(0, 6)).toEqual([12, 11, 3, 18, 5, 19]);
  });

  it('breaks an equal rating by the higher count', () => {
    const low = productWith({ id: 1, rating: { average: 4, count: 10 } });
    const high = productWith({ id: 2, rating: { average: 4, count: 99 } });

    expect(rankProducts([low, high]).map((p) => p.id)).toEqual([2, 1]);
  });

  it('breaks an equal rating and count by the lower id', () => {
    const a = productWith({ id: 9, rating: { average: 4, count: 10 } });
    const b = productWith({ id: 3, rating: { average: 4, count: 10 } });

    expect(rankProducts([a, b]).map((p) => p.id)).toEqual([3, 9]);
  });

  it('returns a new array and leaves the input order alone', () => {
    const input = catalogProducts();
    const before = input.map((p) => p.id);

    const ranked = rankProducts(input);

    expect(ranked).not.toBe(input);
    expect(input.map((p) => p.id)).toEqual(before);
  });

  it('returns an empty array for no products', () => {
    expect(rankProducts([])).toEqual([]);
  });
});

describe('catalogue constants', () => {
  it('shows 5 featured products and a top 3 per category', () => {
    expect(FEATURED_COUNT).toBe(5);
    expect(CATEGORY_TOP_COUNT).toBe(3);
  });
});
